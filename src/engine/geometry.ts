/**
 * Map geometry for the changes: stops as points (a moved stop as both points
 * and an A to B line), shapes as lines (a changed shape as both lines), and
 * for trips or routes without shapes, their stop lists as lines. Built per
 * scope on request, coloured by status on the page.
 */

import type { Row } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { Feature, LineString, Point } from 'geojson';
import type { EntityReader, Ids } from './entities';
import { metres } from './geo';
import type { FeedPair, SideData } from './pair';
import type { Renames } from './renames';
import type { TableResult } from './rows';
import type { ShapesResult } from './shapes';
import type {
  EntityStatus,
  MapFeatureProps,
  MapGeometry,
  MapScope,
  MapStatus,
  RowChangeKind,
  Side,
} from './types';

type MapFeature = Feature<Point | LineString, MapFeatureProps>;
/** Feature props before the page's focus rule sets `focus`. */
type DrawProps = Omit<MapFeatureProps, 'focus'>;

/** Overview lines are simplified to about this many metres. */
const OVERVIEW_SIMPLIFY_M = 2;
const DEG_M = 111_320;

function mapStatus(s: EntityStatus | RowChangeKind): MapStatus {
  return s === 'added' || s === 'removed' || s === 'changed' ? s : 'unchanged';
}

/** A stop's position, or null when it has none (generic nodes, bad values). */
function position(r: Row | null): [number, number] | null {
  if (!r || r.stop_lon === '' || r.stop_lat === '') {
    return null;
  }
  const lon = Number(r.stop_lon);
  const lat = Number(r.stop_lat);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function toLine(coords: Float64Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    out.push([coords[i], coords[i + 1]]);
  }
  return out;
}

/** Douglas-Peucker on [lon, lat] points, tolerance in metres. */
function simplify(
  points: [number, number][],
  toleranceM: number
): [number, number][] {
  if (points.length < 3) {
    return points;
  }
  const kx = Math.cos((points[0][1] * Math.PI) / 180);
  const tol2 = (toleranceM / DEG_M) ** 2;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const ax = points[first][0] * kx;
    const ay = points[first][1];
    const dx = points[last][0] * kx - ax;
    const dy = points[last][1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = 0;
    let at = -1;
    for (let i = first + 1; i < last; i++) {
      const px = points[i][0] * kx - ax;
      const py = points[i][1] - ay;
      const t =
        len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (at >= 0 && worst > tol2) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function sameLine(x: [number, number][], y: [number, number][]): boolean {
  return (
    x.length === y.length &&
    x.every((p, i) => p[0] === y[i][0] && p[1] === y[i][1])
  );
}

class Builder {
  readonly features: MapFeature[] = [];
  /** Which features are the page's focus; the rest is dimmed context. */
  focus: (props: DrawProps) => boolean = () => true;
  private west = Infinity;
  private south = Infinity;
  private east = -Infinity;
  private north = -Infinity;

  private extend(points: [number, number][]): void {
    for (const [lon, lat] of points) {
      this.west = Math.min(this.west, lon);
      this.east = Math.max(this.east, lon);
      this.south = Math.min(this.south, lat);
      this.north = Math.max(this.north, lat);
    }
  }

  point(at: [number, number], props: DrawProps): void {
    this.extend([at]);
    this.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: at },
      properties: { ...props, focus: this.focus(props) },
    });
  }

  line(points: [number, number][], props: DrawProps): void {
    if (points.length < 2) {
      return;
    }
    this.extend(points);
    this.features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points },
      properties: { ...props, focus: this.focus(props) },
    });
  }

  done(): MapGeometry {
    // Nothing in focus (a route with no changes): show it all undimmed.
    if (!this.features.some((f) => f.properties.focus)) {
      for (const f of this.features) {
        f.properties.focus = true;
      }
    }
    return {
      features: this.features,
      bounds:
        this.west <= this.east
          ? [this.west, this.south, this.east, this.north]
          : null,
    };
  }
}

export class GeometryReader {
  constructor(
    private pair: FeedPair,
    private renames: Renames,
    private reader: EntityReader,
    private stops: TableResult | null,
    private shapes: ShapesResult | null
  ) {}

  read(scope: MapScope): MapGeometry {
    const out = new Builder();
    switch (scope.type) {
      case 'overview':
        if (scope.layer !== 'shapes') {
          this.overviewStops(out, scope.layer === 'moved');
        }
        if (scope.layer === undefined || scope.layer === 'shapes') {
          this.overviewShapes(out);
          this.overviewShapeSwaps(out);
        }
        break;
      case 'stop':
        this.stopPage(out, scope.id);
        break;
      case 'shape': {
        const ids = this.reader.resolveShape(scope.id);
        this.shape(out, ids, mapStatus(this.reader.shapeStatus(ids)), 0);
        break;
      }
      case 'trip':
        this.tripPage(out, scope.id);
        break;
      case 'route':
        this.routePage(out, scope.id);
        break;
    }
    return out.done();
  }

  // ---------- pieces ----------

  private stopRow(s: SideData, id: string | null): Row | null {
    return this.reader.row(s, 'stops', 'stop_id', id);
  }

  /**
   * A stop on each side: one point when it did not move, else both points
   * and the A to B line. `movedOnly` skips stops that did not move.
   */
  private stop(
    out: Builder,
    ids: Ids,
    status: MapStatus,
    ra = this.stopRow(this.pair.a, ids.a),
    rb = this.stopRow(this.pair.b, ids.b),
    movedOnly = false
  ): void {
    const pa = position(ra);
    const pb = position(rb);
    const id = ids.b ?? ids.a ?? '';
    const props = (
      kind: DrawProps['kind'],
      side: DrawProps['side']
    ): DrawProps => ({ kind, status, side, page: 'stop', id });
    const moved =
      pa !== null &&
      pb !== null &&
      (pa[0] !== pb[0] || pa[1] !== pb[1]) &&
      metres(pa[0], pa[1], pb[0], pb[1]) > this.pair.options.coordToleranceM;
    if (moved) {
      out.line([pa, pb], props('move', 'both'));
      out.point(pa, props('stop', 'a'));
      out.point(pb, props('stop', 'b'));
      return;
    }
    if (movedOnly) {
      return;
    }
    if (pb) {
      out.point(pb, props('stop', pa ? 'both' : 'b'));
    } else if (pa) {
      out.point(pa, props('stop', 'a'));
    }
  }

  /** A shape on each side: one line when the points are equal, else both. */
  private shape(
    out: Builder,
    ids: Ids,
    status: MapStatus,
    simplifyM: number
  ): void {
    const line = (s: SideData, id: string | null): [number, number][] => {
      if (id === null) {
        return [];
      }
      const pts = toLine(s.store.shapeCoords(id));
      return simplifyM > 0 ? simplify(pts, simplifyM) : pts;
    };
    this.lines(out, line(this.pair.a, ids.a), line(this.pair.b, ids.b), {
      status,
      page: 'shape',
      id: ids.b ?? ids.a ?? '',
    });
  }

  private lines(
    out: Builder,
    la: [number, number][],
    lb: [number, number][],
    props: Pick<DrawProps, 'status' | 'page' | 'id'>
  ): void {
    if (la.length > 0 && lb.length > 0 && sameLine(la, lb)) {
      out.line(lb, { ...props, kind: 'line', side: 'both' });
      return;
    }
    out.line(la, { ...props, kind: 'line', side: 'a' });
    out.line(lb, { ...props, kind: 'line', side: 'b' });
  }

  // ---------- overview ----------

  private overviewStops(out: Builder, movedOnly: boolean): void {
    const log = this.stops?.log;
    if (!log) {
      return;
    }
    const { a, b } = this.pair;
    for (let i = 0; i < log.size; i++) {
      const kind = log.kinds[i];
      if (kind !== 'added' && kind !== 'removed' && kind !== 'changed') {
        continue;
      }
      if (movedOnly && kind !== 'changed') {
        continue;
      }
      const ra = log.a[i] >= 0 ? a.store.row('stops', log.a[i]) : null;
      const rb = log.b[i] >= 0 ? b.store.row('stops', log.b[i]) : null;
      this.stop(
        out,
        { a: ra?.stop_id ?? null, b: rb?.stop_id ?? null },
        kind,
        ra,
        rb,
        movedOnly
      );
    }
  }

  private overviewShapes(out: Builder): void {
    for (const c of this.shapes?.shapes ?? []) {
      if (c.kind === 'added' || c.kind === 'removed' || c.kind === 'changed') {
        this.shape(out, { a: c.a, b: c.b }, c.kind, OVERVIEW_SIMPLIFY_M);
      }
    }
  }

  /**
   * Stop lists of trips that gained a shape (A list, red) or lost one (B
   * list, green), once per stop list.
   */
  private overviewShapeSwaps(out: Builder): void {
    for (const side of ['a', 'b'] as const) {
      const s = this.pair[side];
      if (!s.store.hasTable('trips')) {
        continue;
      }
      s.store.forEachStopList((stops, tripIds) => {
        let swap: string | null = null;
        for (const t of tripIds) {
          swap = this.shapeSwap(side, t);
          if (swap !== null) {
            break;
          }
        }
        if (swap === null) {
          return;
        }
        out.line(
          this.stopListLine(
            s,
            stops.map((x) => x.stop_id)
          ),
          {
            kind: 'line',
            status: side === 'a' ? 'removed' : 'added',
            side,
            page: 'trip',
            id: swap,
          }
        );
      });
    }
  }

  // ---------- pages ----------

  private stopPage(out: Builder, id: string): void {
    const ids = this.reader.resolveRow('stop', id);
    // The stop and its move line; its child stops are context.
    const own = ids.b ?? ids.a ?? '';
    out.focus = (p) => p.id === own;
    const children = (s: SideData, stopId: string | null): string[] =>
      stopId === null || !s.store.hasTable('stops')
        ? []
        : s.store
            .find('stops', 'parent_station', stopId)
            .map((r) => r.row.stop_id);
    for (const c of this.reader.union(
      'stop_id',
      children(this.pair.a, ids.a),
      children(this.pair.b, ids.b)
    )) {
      this.stop(out, c, mapStatus(this.reader.rowStatus('stop', c)));
    }
    this.stop(out, ids, mapStatus(this.reader.rowStatus('stop', ids)));
  }

  /**
   * Stops served on each side, A ids mapped through renames: on one side
   * only is added or removed, on both is the stop's own status.
   */
  private servedStops(
    out: Builder,
    idsA: Set<string>,
    idsB: Set<string>
  ): void {
    for (const s of this.reader.union('stop_id', idsA, idsB)) {
      const status: MapStatus =
        s.a === null
          ? 'added'
          : s.b === null
            ? 'removed'
            : mapStatus(this.reader.rowStatus('stop', s));
      this.stop(out, s, status);
    }
  }

  /** A stop list as a line through its stops' positions. */
  private stopListLine(s: SideData, stopIds: string[]): [number, number][] {
    const pts: [number, number][] = [];
    for (const id of stopIds) {
      const p = position(this.stopRow(s, id));
      if (p) {
        pts.push(p);
      }
    }
    return pts;
  }

  /**
   * The B trip id when `tripId` on `side` has no shape and its trip on the
   * other side has one, else null.
   */
  private shapeSwap(side: Side, tripId: string): string | null {
    const ids = this.reader.resolveRow('trip', tripId);
    const ra = this.reader.row(this.pair.a, 'trips', 'trip_id', ids.a);
    const rb = this.reader.row(this.pair.b, 'trips', 'trip_id', ids.b);
    if (!ra || !rb) {
      return null;
    }
    const [own, other] = side === 'a' ? [ra, rb] : [rb, ra];
    return !own.shape_id && other.shape_id ? ids.b : null;
  }

  /** A's stop ids as B names them, for comparing stop lists. */
  private mappedStops(ids: string[]): string {
    const map = this.renames.maps.stop_id;
    return ids.map((id) => map.get(id) ?? id).join('\u0000');
  }

  private tripPage(out: Builder, id: string): void {
    const ids = this.reader.resolveRow('trip', id);
    // The trip's lines and its changed stops; unchanged stops are context.
    out.focus = (p) => p.kind !== 'stop' || p.status !== 'unchanged';
    const { a, b } = this.pair;
    const ra = this.reader.row(a, 'trips', 'trip_id', ids.a);
    const rb = this.reader.row(b, 'trips', 'trip_id', ids.b);
    const stopsOf = (s: SideData, tripId: string | null): string[] =>
      tripId === null ? [] : s.store.tripStops(tripId).map((x) => x.stop_id);
    const sa = stopsOf(a, ids.a);
    const sb = stopsOf(b, ids.b);
    const shapeA = ra?.shape_id || null;
    const shapeB = rb?.shape_id || null;
    if (shapeA || shapeB) {
      const pairsUp =
        shapeA !== null &&
        shapeB !== null &&
        (this.renames.maps.shape_id.get(shapeA) ?? shapeA) === shapeB;
      if (pairsUp) {
        const sh = { a: shapeA, b: shapeB };
        this.shape(out, sh, mapStatus(this.reader.shapeStatus(sh)), 0);
      } else {
        const status: MapStatus =
          shapeA && shapeB ? 'changed' : shapeA ? 'removed' : 'added';
        this.shape(out, { a: shapeA, b: null }, status, 0);
        this.shape(out, { a: null, b: shapeB }, status, 0);
      }
      // The stop list of the side without a shape, as the before or after.
      if (!shapeA) {
        out.line(this.stopListLine(a, sa), {
          kind: 'line',
          status: 'removed',
          side: 'a',
          page: 'trip',
          id,
        });
      }
      if (!shapeB) {
        out.line(this.stopListLine(b, sb), {
          kind: 'line',
          status: 'added',
          side: 'b',
          page: 'trip',
          id,
        });
      }
    } else {
      const same = this.mappedStops(sa) === sb.join('\u0000');
      this.lines(out, this.stopListLine(a, sa), this.stopListLine(b, sb), {
        status: !ids.a
          ? 'added'
          : !ids.b
            ? 'removed'
            : same
              ? 'unchanged'
              : 'changed',
        page: 'trip',
        id,
      });
    }
    this.servedStops(out, new Set(sa), new Set(sb));
  }

  private routePage(out: Builder, id: string): void {
    const ids = this.reader.resolveRow('route', id);
    // The route's changes; unchanged lines and stops are context.
    out.focus = (p) => p.status !== 'unchanged';
    /** `swap`: the B trip of one of the list's trips that swapped a shape. */
    type StopList = { trip: string; stops: string[]; swap: string | null };
    const per = (
      side: Side,
      routeId: string | null
    ): { shapes: Set<string>; lists: StopList[]; stops: Set<string> } => {
      const s = this.pair[side];
      const shapes = new Set<string>();
      const lists = new Map<string, StopList>();
      const stops = new Set<string>();
      const seen = new Set<string>();
      if (routeId === null || !s.store.hasTable('trips')) {
        return { shapes, lists: [], stops };
      }
      for (const { row } of s.store.find('trips', 'route_id', routeId)) {
        if (row.shape_id) {
          shapes.add(row.shape_id);
        }
        const key = s.store.stopListKey(row.trip_id);
        if (key === null) {
          continue;
        }
        // A trip with a shape is drawn by its shape.
        if (!row.shape_id) {
          let list = lists.get(key);
          if (!list) {
            list = {
              trip: row.trip_id,
              stops: s.store.tripStops(row.trip_id).map((x) => x.stop_id),
              swap: null,
            };
            lists.set(key, list);
          }
          list.swap ??= this.shapeSwap(side, row.trip_id);
        }
        const listKey = `${key}:${row.shape_id ? 's' : ''}`;
        if (seen.has(listKey)) {
          continue;
        }
        seen.add(listKey);
        for (const x of s.store.tripStops(row.trip_id)) {
          stops.add(x.stop_id);
        }
      }
      return { shapes, lists: [...lists.values()], stops };
    };
    const a = per('a', ids.a);
    const b = per('b', ids.b);
    for (const sh of this.reader.union('shape_id', a.shapes, b.shapes)) {
      const status: MapStatus =
        sh.a === null
          ? 'added'
          : sh.b === null
            ? 'removed'
            : mapStatus(this.reader.shapeStatus(sh));
      this.shape(out, sh, status, 0);
    }
    // Stop lists of trips without a shape, matched by their mapped stops. A
    // list whose trips swapped a shape is the before (A) or after (B) of it.
    const listsB = new Map<string, StopList>();
    for (const list of b.lists) {
      listsB.set(list.stops.join('\u0000'), list);
    }
    const matched = new Set<string>();
    const listLine = (side: Side, list: StopList, status: MapStatus): void => {
      out.line(this.stopListLine(this.pair[side], list.stops), {
        kind: 'line',
        status,
        side,
        page: 'trip',
        id: list.swap ?? list.trip,
      });
    };
    for (const list of a.lists) {
      const key = this.mappedStops(list.stops);
      const other = listsB.get(key);
      if (!other) {
        listLine('a', list, 'removed');
        continue;
      }
      matched.add(key);
      if (list.swap === null && other.swap === null) {
        this.lines(
          out,
          this.stopListLine(this.pair.a, list.stops),
          this.stopListLine(this.pair.b, other.stops),
          { status: 'unchanged', page: 'trip', id: other.trip }
        );
      } else {
        listLine('a', list, list.swap === null ? 'unchanged' : 'removed');
        listLine('b', other, other.swap === null ? 'unchanged' : 'added');
      }
    }
    for (const [key, list] of listsB) {
      if (!matched.has(key)) {
        listLine('b', list, 'added');
      }
    }
    this.servedStops(out, a.stops, b.stops);
  }
}
