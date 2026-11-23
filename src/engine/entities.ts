/**
 * Per-entity reads for the entity pages: an entity's rows on both sides
 * (matched through renames), compared cell by cell, its related entities
 * with their status, and the labels its breadcrumbs need.
 */

import type { Row } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import { dateOf, minus } from './calendars';
import { CellComparer, entityOf } from './compare-cells';
import type { FeedPair, SideData } from './pair';
import type { Renames } from './renames';
import type { ShapesResult } from './shapes';
import type { StopTimesResult } from './stop-times';
import type {
  CrumbLabels,
  EntityKind,
  EntityRef,
  EntityStatus,
  EntityView,
  FieldDiff,
  GroupItem,
  PageEntity,
  RecordDiff,
} from './types';

type Ids = { a: string | null; b: string | null };

/** Where each entity's rows live and what names them. */
const TABLES: Record<
  Exclude<PageEntity, 'feed_info' | 'shape'>,
  { table: string; kind: EntityKind }
> = {
  agency: { table: 'agency', kind: 'agency_id' },
  route: { table: 'routes', kind: 'route_id' },
  trip: { table: 'trips', kind: 'trip_id' },
  stop: { table: 'stops', kind: 'stop_id' },
  service: { table: 'calendar', kind: 'service_id' },
};

/** Higher is the stronger change when a trip's row and stop_times disagree. */
const RANK: Record<EntityStatus, number> = {
  unchanged: 0,
  formatting: 1,
  followsRename: 2,
  renamed: 3,
  changed: 4,
  added: 5,
  removed: 5,
};

function stronger(x: EntityStatus, y: EntityStatus): EntityStatus {
  return RANK[y] > RANK[x] ? y : x;
}

function emptyCrumbs(): CrumbLabels {
  return { agency: {}, route: {}, trip: {}, stop: {} };
}

const routeLabel = (r: Row): string =>
  r.route_short_name || r.route_long_name || r.route_id;
const tripLabel = (r: Row): string =>
  r.trip_short_name || r.trip_headsign || r.trip_id;

export class EntityReader {
  private reverse = new Map<EntityKind, Map<string, string>>();
  private comparers = new Map<string, CellComparer>();
  private tripKinds: {
    a: Map<string, EntityStatus>;
    b: Map<string, EntityStatus>;
  } | null = null;
  private shapeKinds: Map<string, EntityStatus> | null = null;
  private shapeSets: { a: Set<string>; b: Set<string> } | null = null;
  private soleAgencies = new Map<SideData, string | null>();

  constructor(
    private pair: FeedPair,
    private renames: Renames,
    private stopTimes: StopTimesResult | null,
    private shapes: ShapesResult | null,
    private shapeGroup: Extract<GroupItem, { kind: 'shapeChanged' }>[]
  ) {}

  read(type: PageEntity, id: string): EntityView {
    switch (type) {
      case 'feed_info':
        return this.feedInfo();
      case 'agency':
        return this.agency(id);
      case 'route':
        return this.route(id);
      case 'trip':
        return this.trip(id);
      case 'stop':
        return this.stop(id);
      case 'service':
        return this.service(id);
      case 'shape':
        return this.shape(id);
    }
  }

  // ---------- lookups ----------

  private row(
    s: SideData,
    table: string,
    col: string,
    id: string | null
  ): Row | null {
    if (id === null || !s.store.hasTable(table)) {
      return null;
    }
    return s.store.find(table, col, id)[0]?.row ?? null;
  }

  private reverseMap(kind: EntityKind): Map<string, string> {
    let m = this.reverse.get(kind);
    if (!m) {
      m = new Map([...this.renames.maps[kind]].map(([a, b]) => [b, a]));
      this.reverse.set(kind, m);
    }
    return m;
  }

  /** The id on each side, matched on either one and through renames. */
  private resolve(
    kind: EntityKind,
    id: string,
    has: (s: SideData) => boolean
  ): Ids {
    const inA = has(this.pair.a);
    const inB = has(this.pair.b);
    if (inA && inB) {
      return { a: id, b: id };
    }
    if (inB) {
      return { a: this.reverseMap(kind).get(id) ?? null, b: id };
    }
    if (inA) {
      return { a: id, b: this.renames.maps[kind].get(id) ?? null };
    }
    return { a: null, b: null };
  }

  private resolveRow(type: keyof typeof TABLES, id: string): Ids {
    const { table, kind } = TABLES[type];
    return this.resolve(kind, id, (s) => this.row(s, table, kind, id) !== null);
  }

  /** B ids, then A ids not mapped to one of them. */
  private union(
    kind: EntityKind,
    idsA: Iterable<string>,
    idsB: Iterable<string>
  ): Ids[] {
    const map = this.renames.maps[kind];
    const out: Ids[] = [];
    const seenB = new Set<string>();
    const fromA = new Map<string, string>();
    for (const a of idsA) {
      const b = map.get(a) ?? a;
      fromA.set(b, a);
    }
    for (const b of idsB) {
      if (seenB.has(b)) {
        continue;
      }
      seenB.add(b);
      out.push({ a: fromA.get(b) ?? null, b });
    }
    for (const [b, a] of fromA) {
      if (!seenB.has(b)) {
        out.push({ a, b: null });
      }
    }
    return out;
  }

  // ---------- comparing rows ----------

  private comparer(table: string, cols: string[]): CellComparer {
    const key = `${table}:${cols.join(',')}`;
    let c = this.comparers.get(key);
    if (!c) {
      c = new CellComparer(
        table,
        cols,
        this.renames.maps,
        this.pair.options.coordToleranceM
      );
      this.comparers.set(key, c);
    }
    return c;
  }

  /** Columns of either row, A's order first. */
  private static columns(
    ra: Row | null,
    rb: Row | null,
    skip: string[] = []
  ): string[] {
    const out = [...Object.keys(ra ?? {})];
    for (const c of Object.keys(rb ?? {})) {
      if (!out.includes(c)) {
        out.push(c);
      }
    }
    return out.filter((c) => !skip.includes(c));
  }

  /** One row pair, cell by cell. `keyDiffers`: paired through a rename of its key. */
  pairRecord(
    table: string,
    ra: Row | null,
    rb: Row | null,
    keyDiffers: boolean,
    skip: string[] = []
  ): RecordDiff {
    const file = `${table}.txt`;
    const cols = EntityReader.columns(ra, rb, skip);
    const field = (name: string, cell: FieldDiff['cell']): FieldDiff => {
      const f: FieldDiff = {
        name,
        a: ra ? (ra[name] ?? null) : null,
        b: rb ? (rb[name] ?? null) : null,
        cell,
      };
      const ref = entityOf(table, name);
      if (ref) {
        f.ref = ref;
      }
      return f;
    };
    if (!ra || !rb) {
      return {
        file,
        status: ra ? 'removed' : rb ? 'added' : 'unchanged',
        fields: cols.map((c) => field(c, 'changed')),
      };
    }
    const cmp = this.comparer(table, cols);
    const va = cols.map((c) => ra[c] ?? '');
    const vb = cols.map((c) => rb[c] ?? '');
    const verdict = cmp.rows(va, vb, keyDiffers);
    return {
      file,
      status: verdict.kind,
      fields: cols.map((c, i) => field(c, cmp.cell(i, va[i], vb[i]))),
    };
  }

  private rowStatus(type: keyof typeof TABLES, ids: Ids): EntityStatus {
    const { table, kind } = TABLES[type];
    const ra = this.row(this.pair.a, table, kind, ids.a);
    const rb = this.row(this.pair.b, table, kind, ids.b);
    return this.pairRecord(table, ra, rb, ids.a !== ids.b).status;
  }

  // ---------- trips and shapes ----------

  /** stop_times verdict per trip: B ids, and A ids of trips not in B. */
  private stopTimesStatus(ids: Ids): EntityStatus {
    const st = this.stopTimes;
    if (!st) {
      return 'unchanged';
    }
    if (!this.tripKinds) {
      const a = new Map<string, EntityStatus>();
      const b = new Map<string, EntityStatus>();
      const pa = this.pair.a.patterns;
      const pb = this.pair.b.patterns;
      for (const c of st.trips) {
        if (c.b >= 0 && pb) {
          b.set(pb.tripId(c.b), c.kind);
        } else if (c.a >= 0 && pa) {
          a.set(pa.tripId(c.a), c.kind);
        }
      }
      this.tripKinds = { a, b };
    }
    return (
      (ids.b !== null
        ? this.tripKinds.b.get(ids.b)
        : this.tripKinds.a.get(ids.a ?? '')) ?? 'unchanged'
    );
  }

  private tripStatus(ids: Ids): EntityStatus {
    const row = this.rowStatus('trip', ids);
    return row === 'added' || row === 'removed'
      ? row
      : stronger(row, this.stopTimesStatus(ids));
  }

  private shapeIds(): { a: Set<string>; b: Set<string> } {
    this.shapeSets ??= {
      a: new Set(this.pair.a.store.shapeIds()),
      b: new Set(this.pair.b.store.shapeIds()),
    };
    return this.shapeSets;
  }

  private shapeStatus(ids: Ids): EntityStatus {
    if (!this.shapes) {
      return 'unchanged';
    }
    if (!this.shapeKinds) {
      this.shapeKinds = new Map();
      for (const c of this.shapes.shapes) {
        this.shapeKinds.set(c.b ?? `a:${c.a}`, c.kind);
      }
    }
    return this.shapeKinds.get(ids.b ?? `a:${ids.a}`) ?? 'unchanged';
  }

  // ---------- labels ----------

  /** The row on B, else on A. */
  private either(type: keyof typeof TABLES, ids: Ids): Row | null {
    const { table, kind } = TABLES[type];
    return (
      this.row(this.pair.b, table, kind, ids.b) ??
      this.row(this.pair.a, table, kind, ids.a)
    );
  }

  private ref(
    type: PageEntity,
    ids: Ids,
    label: string,
    status: EntityStatus
  ): EntityRef {
    const id = ids.b ?? ids.a ?? '';
    const out: EntityRef = { type, id, label, status };
    if (ids.a !== null && ids.b !== null && ids.a !== ids.b) {
      out.was = ids.a;
    }
    return out;
  }

  /** The route's agency, else the side's sole agency. */
  private routeAgency(r: Row, side: SideData): string | null {
    return r.agency_id || this.soleAgency(side);
  }

  private addAgencyCrumb(crumbs: CrumbLabels, agencyId: string): void {
    const ids = this.resolveRow('agency', agencyId);
    const r = this.either('agency', ids);
    crumbs.agency[agencyId] = { label: r?.agency_name || agencyId };
  }

  private addRouteCrumbs(crumbs: CrumbLabels, routeId: string): void {
    const ids = this.resolveRow('route', routeId);
    const rb = this.row(this.pair.b, 'routes', 'route_id', ids.b);
    const r = rb ?? this.row(this.pair.a, 'routes', 'route_id', ids.a);
    if (!r) {
      return;
    }
    const agencyId = this.routeAgency(r, rb ? this.pair.b : this.pair.a);
    crumbs.route[routeId] = { label: routeLabel(r), agency_id: agencyId };
    if (agencyId !== null) {
      this.addAgencyCrumb(crumbs, agencyId);
    }
  }

  private addStopCrumbs(crumbs: CrumbLabels, stopId: string): void {
    const seen = new Set<string>();
    let id: string | undefined = stopId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const r = this.either('stop', this.resolveRow('stop', id));
      if (!r) {
        return;
      }
      const loc =
        r.location_type === '' || r.location_type === undefined
          ? undefined
          : Number(r.location_type);
      crumbs.stop[id] = {
        label: r.stop_name || id,
        location_type: Number.isNaN(loc) ? undefined : loc,
        parent_station: r.parent_station || undefined,
      };
      id = r.parent_station || undefined;
    }
  }

  private view(
    type: PageEntity,
    id: string,
    ids: Ids,
    status: EntityStatus,
    label: string,
    records: RecordDiff[],
    crumbs = emptyCrumbs()
  ): EntityView {
    return {
      type,
      id,
      a: ids.a,
      b: ids.b,
      status,
      label,
      records,
      related: [],
      crumbs,
    };
  }

  // ---------- pages ----------

  private feedInfo(): EntityView {
    const first = (s: SideData): Row | null =>
      s.store.hasTable('feed_info')
        ? (s.store.rows('feed_info', 0, 1)[0]?.row ?? null)
        : null;
    const rec = this.pairRecord(
      'feed_info',
      first(this.pair.a),
      first(this.pair.b),
      false
    );
    const label = rec.fields.find((f) => f.name === 'feed_publisher_name');
    return this.view(
      'feed_info',
      '',
      { a: '', b: '' },
      rec.status,
      label?.b || label?.a || '',
      rec.fields.length > 0 ? [rec] : []
    );
  }

  private agency(id: string): EntityView {
    const ids = this.resolveRow('agency', id);
    const { a, b } = this.pair;
    const rec = this.pairRecord(
      'agency',
      this.row(a, 'agency', 'agency_id', ids.a),
      this.row(b, 'agency', 'agency_id', ids.b),
      ids.a !== ids.b
    );
    const routesOf = (s: SideData, agencyId: string | null): string[] => {
      if (agencyId === null || !s.store.hasTable('routes')) {
        return [];
      }
      const out: string[] = [];
      s.store.scan('routes', ['route_id', 'agency_id'], ([routeId, ag]) => {
        if ((ag || this.soleAgency(s)) === agencyId) {
          out.push(routeId);
        }
      });
      return out;
    };
    const routes = this.union(
      'route_id',
      routesOf(a, ids.a),
      routesOf(b, ids.b)
    ).map((r) =>
      this.ref(
        'route',
        r,
        routeLabel(this.either('route', r) ?? { route_id: r.b ?? r.a ?? '' }),
        this.rowStatus('route', r)
      )
    );
    const crumbs = emptyCrumbs();
    this.addAgencyCrumb(crumbs, id);
    const row = this.either('agency', ids);
    const v = this.view(
      'agency',
      id,
      ids,
      rec.status,
      row?.agency_name || id,
      [rec],
      crumbs
    );
    v.related.push({ key: 'routes', items: routes });
    return v;
  }

  private soleAgency(s: SideData): string | null {
    if (!this.soleAgencies.has(s)) {
      const rows = s.store.hasTable('agency')
        ? s.store.rows('agency', 0, 2)
        : [];
      this.soleAgencies.set(
        s,
        rows.length === 1 ? rows[0].row.agency_id || null : null
      );
    }
    return this.soleAgencies.get(s) ?? null;
  }

  private route(id: string): EntityView {
    const ids = this.resolveRow('route', id);
    const { a, b } = this.pair;
    const rec = this.pairRecord(
      'routes',
      this.row(a, 'routes', 'route_id', ids.a),
      this.row(b, 'routes', 'route_id', ids.b),
      ids.a !== ids.b
    );
    const tripsOf = (s: SideData, routeId: string | null): string[] =>
      routeId === null || !s.store.hasTable('trips')
        ? []
        : s.store.find('trips', 'route_id', routeId).map((r) => r.row.trip_id);
    const trips = this.union(
      'trip_id',
      tripsOf(a, ids.a),
      tripsOf(b, ids.b)
    ).map((t) =>
      this.ref(
        'trip',
        t,
        tripLabel(this.either('trip', t) ?? { trip_id: t.b ?? t.a ?? '' }),
        this.tripStatus(t)
      )
    );
    const crumbs = emptyCrumbs();
    this.addRouteCrumbs(crumbs, id);
    const row = this.either('route', ids);
    const v = this.view(
      'route',
      id,
      ids,
      rec.status,
      row ? routeLabel(row) : id,
      [rec],
      crumbs
    );
    v.related.push({ key: 'trips', items: trips });
    return v;
  }

  private trip(id: string): EntityView {
    const ids = this.resolveRow('trip', id);
    const { a, b } = this.pair;
    const ra = this.row(a, 'trips', 'trip_id', ids.a);
    const rb = this.row(b, 'trips', 'trip_id', ids.b);
    const rec = this.pairRecord('trips', ra, rb, ids.a !== ids.b);
    const crumbs = emptyCrumbs();
    const r = rb ?? ra;
    if (r) {
      crumbs.trip[id] = { label: tripLabel(r), route_id: r.route_id };
      this.addRouteCrumbs(crumbs, r.route_id);
    }
    const status =
      rec.status === 'added' || rec.status === 'removed'
        ? rec.status
        : stronger(rec.status, this.stopTimesStatus(ids));
    const v = this.view(
      'trip',
      id,
      ids,
      status,
      r ? tripLabel(r) : id,
      [rec],
      crumbs
    );
    v.stopTimes = this.tripStopTimes(ids);
    return v;
  }

  /** A trip's stop_times on both sides, paired by stop_sequence. */
  private tripStopTimes(ids: Ids): RecordDiff[] {
    const rows = (s: SideData, tripId: string | null): Row[] =>
      tripId === null || !s.store.hasTable('trips')
        ? []
        : s.store.stopTimesForTrip(tripId);
    const bySeq = new Map<number, { a: Row | null; b: Row | null }>();
    const put = (list: Row[], side: 'a' | 'b'): void => {
      for (const r of list) {
        const seq = Number(r.stop_sequence);
        const slot = bySeq.get(seq) ?? { a: null, b: null };
        slot[side] = r;
        bySeq.set(seq, slot);
      }
    };
    put(rows(this.pair.a, ids.a), 'a');
    put(rows(this.pair.b, ids.b), 'b');
    return [...bySeq.entries()]
      .sort(([x], [y]) => x - y)
      .map(([, p]) =>
        this.pairRecord('stop_times', p.a, p.b, false, ['trip_id'])
      );
  }

  private stop(id: string): EntityView {
    const ids = this.resolveRow('stop', id);
    const { a, b } = this.pair;
    const rec = this.pairRecord(
      'stops',
      this.row(a, 'stops', 'stop_id', ids.a),
      this.row(b, 'stops', 'stop_id', ids.b),
      ids.a !== ids.b
    );
    const children = (s: SideData, stopId: string | null): string[] =>
      stopId === null || !s.store.hasTable('stops')
        ? []
        : s.store
            .find('stops', 'parent_station', stopId)
            .map((r) => r.row.stop_id);
    const childRefs = this.union(
      'stop_id',
      children(a, ids.a),
      children(b, ids.b)
    ).map((c) =>
      this.ref(
        'stop',
        c,
        this.either('stop', c)?.stop_name || c.b || c.a || '',
        this.rowStatus('stop', c)
      )
    );
    const routesAt = (s: SideData, stopId: string | null): string[] => {
      if (stopId === null || !s.store.hasTable('trips')) {
        return [];
      }
      const out = new Set<string>();
      for (const tripId of s.store.tripsAtStop(stopId)) {
        const r = this.row(s, 'trips', 'trip_id', tripId);
        if (r) {
          out.add(r.route_id);
        }
      }
      return [...out];
    };
    const routeRefs = this.union(
      'route_id',
      routesAt(a, ids.a),
      routesAt(b, ids.b)
    ).map((r) =>
      // Status here is whether the route serves the stop on each side.
      this.ref(
        'route',
        r,
        routeLabel(this.either('route', r) ?? { route_id: r.b ?? r.a ?? '' }),
        r.a === null ? 'added' : r.b === null ? 'removed' : 'unchanged'
      )
    );
    const crumbs = emptyCrumbs();
    this.addStopCrumbs(crumbs, id);
    const row = this.either('stop', ids);
    const v = this.view(
      'stop',
      id,
      ids,
      rec.status,
      row?.stop_name || id,
      [rec],
      crumbs
    );
    v.related.push(
      { key: 'childStops', items: childRefs },
      { key: 'stopRoutes', items: routeRefs }
    );
    return v;
  }

  private tripCount(col: string, ids: Ids): { a: number; b: number } {
    const n = (s: SideData, v: string | null): number =>
      v === null || !s.store.hasTable('trips')
        ? 0
        : s.store.find('trips', col, v).length;
    return { a: n(this.pair.a, ids.a), b: n(this.pair.b, ids.b) };
  }

  private service(id: string): EntityView {
    const ids = this.resolve('service_id', id, (s) => s.dates.has(id));
    const { a, b } = this.pair;
    const rec = this.pairRecord(
      'calendar',
      this.row(a, 'calendar', 'service_id', ids.a),
      this.row(b, 'calendar', 'service_id', ids.b),
      ids.a !== ids.b
    );
    const da = ids.a === null ? undefined : a.dates.get(ids.a);
    const db = ids.b === null ? undefined : b.dates.get(ids.b);
    const empty = new Int32Array(0);
    const added = minus(db ?? empty, da ?? empty).map(dateOf);
    const removed = minus(da ?? empty, db ?? empty).map(dateOf);
    let status: EntityStatus = !da ? 'added' : !db ? 'removed' : rec.status;
    if (
      status !== 'added' &&
      status !== 'removed' &&
      added.length + removed.length > 0
    ) {
      status = 'changed';
    }
    const v = this.view(
      'service',
      id,
      ids,
      status,
      id,
      rec.fields.length > 0 ? [rec] : []
    );
    v.dates = { a: da?.length ?? 0, b: db?.length ?? 0, added, removed };
    v.tripCount = this.tripCount('service_id', ids);
    return v;
  }

  private shape(id: string): EntityView {
    const sets = this.shapeIds();
    const ids = this.resolve('shape_id', id, (s) =>
      (s === this.pair.a ? sets.a : sets.b).has(id)
    );
    const points = (s: SideData, v: string | null): number =>
      v === null ? 0 : s.store.shapeCoords(v).length / 2;
    const item = this.shapeGroup.find((g) => g.b === ids.b && g.a === ids.a);
    const v = this.view('shape', id, ids, this.shapeStatus(ids), id, []);
    v.shape = {
      pointsA: points(this.pair.a, ids.a),
      pointsB: points(this.pair.b, ids.b),
      metres: item ? item.metres : null,
    };
    v.tripCount = this.tripCount('shape_id', ids);
    return v;
  }
}
