/**
 * stop_times diff on the stores' trip patterns, never row by row.
 *
 * Trips pair by trip_id, then by trip rename. Within a pair, rows pair by
 * stop_sequence. A same-id pair whose pattern and encoded times are equal is
 * unchanged without reading a cell; only the rest are compared cell by cell.
 *
 * The same pass builds the timetable groups: per route, trips shifted by a
 * constant time, trips whose stop list changed, trips with other field or
 * time changes, and trip counts per route and direction.
 */

import { diffArrays } from 'diff';
import {
  TIME_VERBATIM,
  type PatternReader,
} from 'gtfs-zone-web-common/gtfs/store/pattern-reader';
import { CellComparer } from './compare-cells';
import type { FeedPair, RenameMaps, SideData } from './pair';
import { emptyGrouped, emptyRaw } from './rows';
import type {
  FeedIssue,
  GroupItem,
  GroupedCounts,
  RawCounts,
  RowChangeKind,
} from './types';

/** One differing trip: indexes into each side's PatternReader (-1 for none). */
export interface TripChange {
  kind: RowChangeKind;
  a: number;
  b: number;
  rows: Partial<Record<RowChangeKind, number>>;
}

export interface StopTimesResult {
  cols: string[];
  raw: RawCounts;
  grouped: GroupedCounts;
  changedCells: Record<string, number>;
  formattingCells: Record<string, number>;
  trips: TripChange[];
  groups: {
    timeShift: Extract<GroupItem, { kind: 'timeShift' }>[];
    patternChange: Extract<GroupItem, { kind: 'patternChange' }>[];
    stopTimesFields: Extract<GroupItem, { kind: 'stopTimesFields' }>[];
    stopTimesTimes: Extract<GroupItem, { kind: 'stopTimesTimes' }>[];
    tripCount: Extract<GroupItem, { kind: 'tripCount' }>[];
  };
  issues: FeedIssue[];
}

const SAMPLE = 5;
const TIME_COLS = new Set(['arrival_time', 'departure_time']);

/** Rows of one side's trips as values in a fixed column order. */
class TripRows {
  private patternCache = new Map<number, string[][]>();
  private at: {
    trip: number;
    arr: number;
    dep: number;
    seq: number;
    stop: number;
  };

  constructor(
    private p: PatternReader,
    private cols: string[]
  ) {
    this.at = {
      trip: cols.indexOf('trip_id'),
      arr: cols.indexOf('arrival_time'),
      dep: cols.indexOf('departure_time'),
      seq: cols.indexOf('stop_sequence'),
      stop: cols.indexOf('stop_id'),
    };
  }

  /** Pattern rows with trip_id and times left empty, parsed from its key. */
  pattern(k: number): string[][] {
    let rows = this.patternCache.get(k);
    if (rows) {
      return rows;
    }
    const index = new Map(this.cols.map((c, i) => [c, i]));
    rows = [];
    const key = this.p.patternKey(k);
    const n = this.p.patternLength(k);
    const lines = n > 0 ? key.split('\x1e') : [];
    for (const line of lines) {
      const row = new Array<string>(this.cols.length).fill('');
      if (line !== '') {
        for (const cell of line.split('\x1f')) {
          const eq = cell.indexOf('=');
          const i = index.get(cell.slice(0, eq));
          if (i !== undefined) {
            row[i] = cell.slice(eq + 1);
          }
        }
      }
      rows.push(row);
    }
    this.patternCache.set(k, rows);
    return rows;
  }

  /** Every row of trip `t`, fresh arrays. */
  trip(t: number): string[][] {
    const rows = this.pattern(this.p.tripPattern(t)).map((r) => [...r]);
    const id = this.p.tripId(t);
    const timed = this.p.hasTimes;
    rows.forEach((row, k) => {
      if (this.at.trip >= 0) {
        row[this.at.trip] = id;
      }
      if (timed && this.at.arr >= 0) {
        row[this.at.arr] = this.p.timeText(t, k, 'arr');
      }
      if (timed && this.at.dep >= 0) {
        row[this.at.dep] = this.p.timeText(t, k, 'dep');
      }
    });
    return rows;
  }

  stops(k: number): string[] {
    return this.at.stop < 0 ? [] : this.pattern(k).map((r) => r[this.at.stop]);
  }

  seqIndex(): number {
    return this.at.seq;
  }

  clear(): void {
    this.patternCache.clear();
  }
}

/** True when the trips' times are the same encoded values and text. */
function sameTimes(
  pa: PatternReader,
  t: number,
  pb: PatternReader,
  u: number
): boolean {
  if (!pa.hasTimes || !pb.hasTimes) {
    return pa.hasTimes === pb.hasTimes;
  }
  const x = pa.encodedTimes(t);
  const y = pb.encodedTimes(u);
  if (x.arr.length !== y.arr.length) {
    return false;
  }
  for (let k = 0; k < x.arr.length; k++) {
    if (x.arr[k] !== y.arr[k] || x.dep[k] !== y.dep[k]) {
      return false;
    }
    if (
      (x.arr[k] === TIME_VERBATIM &&
        pa.timeText(t, k, 'arr') !== pb.timeText(u, k, 'arr')) ||
      (x.dep[k] === TIME_VERBATIM &&
        pa.timeText(t, k, 'dep') !== pb.timeText(u, k, 'dep'))
    ) {
      return false;
    }
  }
  return true;
}

/** The constant shift between two trips' times in seconds, 0 if equal, null if not constant. */
function timeShift(
  pa: PatternReader,
  t: number,
  pb: PatternReader,
  u: number
): number | null {
  if (!pa.hasTimes || !pb.hasTimes) {
    return 0;
  }
  const x = pa.encodedTimes(t);
  const y = pb.encodedTimes(u);
  if (x.arr.length !== y.arr.length) {
    return null;
  }
  let delta: number | null = null;
  for (let k = 0; k < x.arr.length; k++) {
    for (const [v, w] of [
      [x.arr[k], y.arr[k]],
      [x.dep[k], y.dep[k]],
    ]) {
      if (v < 0 || w < 0) {
        if (v !== w) {
          return null;
        }
        continue;
      }
      const d = (w >> 1) - (v >> 1);
      if (delta === null) {
        delta = d;
      } else if (d !== delta) {
        return null;
      }
    }
  }
  return delta ?? 0;
}

function tripInfo(s: SideData): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  s.store.scan('trips', ['trip_id', 'route_id', 'direction_id'], ([t, r, d]) =>
    out.set(t, [r, d])
  );
  return out;
}

export function diffStopTimes(
  pair: FeedPair,
  maps: RenameMaps
): StopTimesResult | null {
  const pa = pair.a.patterns;
  const pb = pair.b.patterns;
  if (!pa && !pb) {
    return null;
  }
  const colsA = pair.a.store.hasTable('stop_times')
    ? pair.a.store.columns('stop_times')
    : [];
  const colsB = pair.b.store.hasTable('stop_times')
    ? pair.b.store.columns('stop_times')
    : [];
  const cols = [...colsA, ...colsB.filter((c) => !colsA.includes(c))];
  const result: StopTimesResult = {
    cols,
    raw: emptyRaw(),
    grouped: emptyGrouped(),
    changedCells: {},
    formattingCells: {},
    trips: [],
    groups: {
      timeShift: [],
      patternChange: [],
      stopTimesFields: [],
      stopTimesTimes: [],
      tripCount: [],
    },
    issues: [],
  };
  const { raw, grouped } = result;
  const lenOf = (p: PatternReader, t: number): number =>
    p.patternLength(p.tripPattern(t));

  if (!pa || !pb) {
    // Only one side has stop_times: every row is added or removed.
    const p = (pa ?? pb)!;
    for (let t = 0; t < p.tripCount; t++) {
      const n = lenOf(p, t);
      const kind = pa ? 'removed' : 'added';
      raw[kind] += n;
      grouped[kind] += n;
      result.trips.push({
        kind,
        a: pa ? t : -1,
        b: pb ? t : -1,
        rows: { [kind]: n },
      });
    }
    return result;
  }

  const cmp = new CellComparer(
    'stop_times',
    cols,
    maps,
    pair.options.coordToleranceM
  );
  const rowsA = new TripRows(pa, cols);
  const rowsB = new TripRows(pb, cols);
  const hashA = Array.from({ length: pa.patternCount }, (_, k) =>
    pa.patternHash(k)
  );
  const hashB = Array.from({ length: pb.patternCount }, (_, k) =>
    pb.patternHash(k)
  );
  const infoA = tripInfo(pair.a);
  const infoB = tripInfo(pair.b);
  const seqAt = rowsA.seqIndex();
  let dupSeq = 0;

  const groupBy = new Map<
    string,
    GroupItem & { trips: number; sample: string[] }
  >();
  const bump = (
    key: string,
    make: () => GroupItem & { trips: number; sample: string[] },
    trip: string
  ): void => {
    let g = groupBy.get(key);
    if (!g) {
      groupBy.set(key, (g = make()));
    }
    g.trips++;
    if (g.sample.length < SAMPLE) {
      g.sample.push(trip);
    }
  };

  /** Compare one trip pair row by row; returns per-kind row counts. */
  const comparePair = (
    t: number,
    u: number,
    renamed: boolean
  ): Partial<Record<RowChangeKind, number>> => {
    const counts: Partial<Record<RowChangeKind, number>> = {};
    const add = (k: RowChangeKind, n = 1): void => {
      counts[k] = (counts[k] ?? 0) + n;
    };
    const a = rowsA.trip(t);
    const b = rowsB.trip(u);
    const bySeq = new Map<string, number>();
    b.forEach((row, k) => {
      const seq = seqAt >= 0 ? row[seqAt] : String(k);
      if (bySeq.has(seq)) {
        dupSeq++;
      } else {
        bySeq.set(seq, k);
      }
    });
    const usedB = new Uint8Array(b.length);
    const seenA = new Set<string>();
    for (const row of a) {
      const seq = seqAt >= 0 ? row[seqAt] : '';
      const k = seenA.has(seq) ? undefined : bySeq.get(seq);
      if (seenA.has(seq)) {
        dupSeq++;
      }
      seenA.add(seq);
      if (k === undefined) {
        if (!renamed) {
          raw.removed++;
        }
        grouped.removed++;
        add('removed');
        continue;
      }
      usedB[k] = 1;
      const other = b[k];
      if (!renamed) {
        if (row.every((v, i) => v === other[i])) {
          raw.unchanged++;
        } else {
          raw.changed++;
        }
      } else {
        grouped.rematched++;
      }
      const verdict = cmp.rows(row, other, renamed);
      for (const c of verdict.changed) {
        result.changedCells[c] = (result.changedCells[c] ?? 0) + 1;
      }
      if (verdict.kind === 'unchanged') {
        grouped.unchanged++;
        continue;
      }
      for (const c of verdict.formatting) {
        result.formattingCells[c] = (result.formattingCells[c] ?? 0) + 1;
      }
      grouped[verdict.kind]++;
      add(verdict.kind);
    }
    for (let k = 0; k < b.length; k++) {
      if (!usedB[k]) {
        if (!renamed) {
          raw.added++;
        }
        grouped.added++;
        add('added');
      }
    }
    if (renamed) {
      raw.removed += a.length;
      raw.added += b.length;
    }
    return counts;
  };

  /** Timetable groups for a trip pair that differs in content. */
  const groupPair = (t: number, u: number, changedCols: Set<string>): void => {
    const tripB = pb.tripId(u);
    const route = infoB.get(tripB)?.[0] ?? '';
    const stopsA = rowsA
      .stops(pa.tripPattern(t))
      .map((s) => cmp.mapped(cols.indexOf('stop_id'), s));
    const stopsB = rowsB.stops(pb.tripPattern(u));
    const sameStops =
      stopsA.length === stopsB.length &&
      stopsA.every((s, i) => s === stopsB[i]);
    if (!sameStops) {
      const added: string[] = [];
      const removed: string[] = [];
      for (const part of diffArrays(stopsA, stopsB)) {
        if (part.added) {
          added.push(...part.value);
        } else if (part.removed) {
          removed.push(...part.value);
        }
      }
      bump(
        `p\x1f${route}\x1f${added.join(',')}\x1f${removed.join(',')}`,
        () => ({
          kind: 'patternChange',
          route_id: route,
          addedStops: added,
          removedStops: removed,
          trips: 0,
          sample: [],
        }),
        tripB
      );
      return;
    }
    const fields = [...changedCols]
      .filter((c) => !TIME_COLS.has(c) && c !== 'trip_id')
      .sort();
    if (fields.length > 0) {
      bump(
        `f\x1f${route}\x1f${fields.join(',')}`,
        () => ({
          kind: 'stopTimesFields',
          route_id: route,
          columns: fields,
          trips: 0,
          sample: [],
        }),
        tripB
      );
    }
    if (changedCols.has('arrival_time') || changedCols.has('departure_time')) {
      const delta = timeShift(pa, t, pb, u);
      if (delta !== null && delta !== 0) {
        bump(
          `s\x1f${route}\x1f${delta}`,
          () => ({
            kind: 'timeShift',
            route_id: route,
            delta,
            trips: 0,
            sample: [],
          }),
          tripB
        );
      } else {
        bump(
          `t\x1f${route}`,
          () => ({
            kind: 'stopTimesTimes',
            route_id: route,
            trips: 0,
            sample: [],
          }),
          tripB
        );
      }
    }
  };

  const tripMap = maps.trip_id;
  const pairedB = new Uint8Array(pb.tripCount);
  for (let t = 0; t < pa.tripCount; t++) {
    const id = pa.tripId(t);
    let u = pb.tripIndex(id);
    let renamed = false;
    if (u < 0 && tripMap.has(id)) {
      u = pb.tripIndex(tripMap.get(id)!);
      renamed = u >= 0;
    }
    if (u < 0) {
      const n = lenOf(pa, t);
      raw.removed += n;
      grouped.removed += n;
      result.trips.push({ kind: 'removed', a: t, b: -1, rows: { removed: n } });
      continue;
    }
    pairedB[u] = 1;
    if (
      !renamed &&
      hashA[pa.tripPattern(t)] === hashB[pb.tripPattern(u)] &&
      sameTimes(pa, t, pb, u)
    ) {
      const n = lenOf(pa, t);
      raw.unchanged += n;
      grouped.unchanged += n;
      continue;
    }
    const before = { ...result.changedCells };
    const rows = comparePair(t, u, renamed);
    const changedCols = new Set(
      Object.keys(result.changedCells).filter(
        (c) => result.changedCells[c] !== before[c]
      )
    );
    const kinds = Object.keys(rows) as RowChangeKind[];
    if (kinds.length === 0) {
      continue;
    }
    const kind: RowChangeKind = (
      [
        'changed',
        'added',
        'removed',
        'renamed',
        'followsRename',
        'formatting',
      ] as const
    ).find((k) => rows[k])!;
    result.trips.push({ kind, a: t, b: u, rows });
    if (rows.changed || rows.added || rows.removed) {
      groupPair(t, u, changedCols);
    }
  }
  for (let u = 0; u < pb.tripCount; u++) {
    if (!pairedB[u]) {
      const n = lenOf(pb, u);
      raw.added += n;
      grouped.added += n;
      result.trips.push({ kind: 'added', a: -1, b: u, rows: { added: n } });
    }
  }
  rowsA.clear();
  rowsB.clear();

  for (const g of groupBy.values()) {
    (
      result.groups[g.kind as keyof StopTimesResult['groups']] as GroupItem[]
    ).push(g);
  }
  for (const list of Object.values(result.groups)) {
    (list as { trips?: number }[]).sort(
      (x, y) => (y.trips ?? 0) - (x.trips ?? 0)
    );
  }
  result.groups.tripCount = tripCounts(infoA, infoB, maps.route_id);
  if (dupSeq > 0) {
    result.issues.push({
      side: 'both',
      file: 'stop_times.txt',
      code: 'duplicateStopSequence',
      count: dupSeq,
    });
  }
  return result;
}

/** Trips per route and direction on each side, where the counts differ. */
function tripCounts(
  infoA: Map<string, [string, string]>,
  infoB: Map<string, [string, string]>,
  routes: Map<string, string>
): Extract<GroupItem, { kind: 'tripCount' }>[] {
  const counts = new Map<string, { a: number; b: number }>();
  const bump = (route: string, dir: string, side: 'a' | 'b'): void => {
    const key = `${route}\x1f${dir}`;
    let c = counts.get(key);
    if (!c) {
      counts.set(key, (c = { a: 0, b: 0 }));
    }
    c[side]++;
  };
  for (const [route, dir] of infoA.values()) {
    bump(routes.get(route) ?? route, dir, 'a');
  }
  for (const [route, dir] of infoB.values()) {
    bump(route, dir, 'b');
  }
  const out: Extract<GroupItem, { kind: 'tripCount' }>[] = [];
  for (const [key, c] of counts) {
    if (c.a !== c.b) {
      const [route_id, direction_id] = key.split('\x1f');
      out.push({ kind: 'tripCount', route_id, direction_id, a: c.a, b: c.b });
    }
  }
  return out.sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));
}
