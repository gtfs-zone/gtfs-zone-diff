/**
 * Runs every comparison stage over two loaded feeds and keeps the details
 * for paged reads.
 *
 * Stages, cheapest first: files (zip CRC32 + size, headers), renames, rows
 * per file (stop_times on patterns, shapes per shape), then the smart groups.
 * The completeness check proves the grouped counts account for every raw
 * row difference.
 */

import { dateOf, minus } from './calendars';
import { EntityReader } from './entities';
import { metres } from './geo';
import { FeedPair, type LoadedSide, type SideData } from './pair';
import { findRenames, type Renames } from './renames';
import { diffTable, emptyGrouped, emptyRaw, type TableResult } from './rows';
import { diffShapes, type ShapesResult } from './shapes';
import { diffStopTimes, type StopTimesResult } from './stop-times';
import {
  ENTITY_KINDS,
  type CompareOptions,
  type CompareProgress,
  type Completeness,
  type DiffResult,
  type EntityKind,
  type EntityView,
  type FeedIssue,
  type FileDiff,
  type Group,
  type GroupItem,
  type HeaderDiff,
  type PageEntity,
  type RowChange,
  type RowChangeKind,
  type SideSummary,
} from './types';

const SPECIAL = new Set(['stop_times', 'shapes']);

/** The entity a table's rows belong to, for linking a row to its page. */
const OWNER: Partial<Record<string, EntityKind>> = {
  agency: 'agency_id',
  routes: 'route_id',
  trips: 'trip_id',
  stops: 'stop_id',
  calendar: 'service_id',
  calendar_dates: 'service_id',
  frequencies: 'trip_id',
};

function countKinds(
  kinds: Iterable<RowChangeKind>
): Partial<Record<RowChangeKind, number>> {
  const out: Partial<Record<RowChangeKind, number>> = {};
  for (const k of kinds) {
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Everything a finished comparison keeps for paged reads. */
export class Comparison {
  readonly result: DiffResult;
  private tables = new Map<string, TableResult>();
  private stopTimes: StopTimesResult | null = null;
  private shapes: ShapesResult | null = null;
  private items = new Map<string, GroupItem[]>();
  private renames: Renames;
  private reader: EntityReader | null = null;
  /** `file:kind` -> positions of that kind's records, for paging. */
  private kindIndex = new Map<string, Int32Array>();
  private recordKinds = new Map<string, RowChangeKind[]>();

  constructor(
    private pair: FeedPair,
    progress: (p: CompareProgress) => void
  ) {
    const timings: Record<string, number> = {};
    const time = <T>(stage: string, fn: () => T): T => {
      const t0 = performance.now();
      const out = fn();
      timings[stage] = Math.round(performance.now() - t0);
      return out;
    };
    const issues: FeedIssue[] = [];

    progress({ stage: 'files' });
    const names = time('files', () => this.fileNames());

    progress({ stage: 'renames' });
    const renames = time('renames', () => findRenames(pair));
    this.renames = renames;

    const files: FileDiff[] = [];
    time('rows', () => {
      for (const name of names) {
        progress({ stage: 'rows', table: name });
        const diff = time(`rows:${name}`, () => this.diffFile(name, renames));
        files.push(diff);
        console.log(`[compare] ${name}: ${diff.status}`, diff.grouped);
      }
    });
    for (const t of this.tables.values()) {
      issues.push(...t.issues);
    }
    if (this.stopTimes) {
      issues.push(...this.stopTimes.issues);
    }
    for (const side of ['a', 'b'] as const) {
      const s = pair.side(side);
      if (!s.zip) {
        issues.push({ side, file: '', code: 'noZipIndex', count: 1 });
      }
      for (const [table, errs] of Object.entries(s.stream.errors)) {
        if (errs.length > 0) {
          issues.push({
            side,
            file: `${table}.txt`,
            code: 'parseErrors',
            count: errs.length,
            detail: errs[0],
          });
        }
      }
    }

    progress({ stage: 'groups' });
    const groups = time('groups', () => this.buildGroups(renames));

    this.result = {
      sides: { a: summarize(pair.a), b: summarize(pair.b) },
      files,
      groups,
      issues,
      completeness: checkCompleteness(files),
      timings,
    };
    if (!this.result.completeness.ok) {
      console.error(
        '[compare] completeness check failed',
        this.result.completeness.mismatches
      );
    }
    console.log('[compare] done', timings);
  }

  /** Every file on either side, tables first, as `name.txt` or the entry name. */
  private fileNames(): string[] {
    const out = new Set<string>();
    for (const s of [this.pair.a, this.pair.b]) {
      for (const t of s.store.tableNames()) {
        out.add(`${t}.txt`);
      }
    }
    for (const s of [this.pair.a, this.pair.b]) {
      for (const f of s.stream.otherFiles) {
        out.add(f);
      }
    }
    return [...out];
  }

  private bytes(name: string): FileDiff['bytes'] {
    const za = this.pair.a.zip?.get(name);
    const zb = this.pair.b.zip?.get(name);
    if (!za || !zb) {
      return 'unknown';
    }
    return za.crc32 === zb.crc32 && za.uncompressedSize === zb.uncompressedSize
      ? 'same'
      : 'different';
  }

  private diffFile(name: string, renames: Renames): FileDiff {
    const table = name.endsWith('.txt') ? name.slice(0, -4) : null;
    const inA = this.has(this.pair.a, name, table);
    const inB = this.has(this.pair.b, name, table);
    const bytes = inA && inB ? this.bytes(name) : 'unknown';
    const isTable =
      table !== null &&
      (this.pair.a.store.hasTable(table) ||
        this.pair.b.store.hasTable(table) ||
        SPECIAL.has(table));
    const diff: FileDiff = {
      file: name,
      status: !inA ? 'added' : !inB ? 'removed' : 'unknown',
      bytes,
      table: isTable,
      header: null,
      match: 'none',
      keyFields: [],
      duplicateKeys: { a: 0, b: 0 },
      raw: emptyRaw(),
      grouped: emptyGrouped(),
      changedCells: {},
      formattingCells: {},
      padded: { a: padded(this.pair.a, table), b: padded(this.pair.b, table) },
      records: {},
    };
    if (!isTable || table === null) {
      if (inA && inB) {
        diff.status =
          bytes === 'same'
            ? 'identical'
            : bytes === 'different'
              ? 'changed'
              : this.sameOtherFile(name);
      }
      return diff;
    }
    diff.header = headerDiff(
      this.columns(this.pair.a, table),
      this.columns(this.pair.b, table)
    );

    if (bytes === 'same') {
      // Byte-identical: every row unchanged, nothing to read.
      const n = this.rowCount(this.pair.a, table);
      diff.raw.unchanged = n;
      diff.grouped.unchanged = n;
      diff.match =
        table === 'stop_times'
          ? 'stop_times'
          : table === 'shapes'
            ? 'shapes'
            : 'keyed';
      diff.status = 'identical';
      return diff;
    }

    if (table === 'stop_times') {
      const st = diffStopTimes(this.pair, renames.maps);
      this.stopTimes = st;
      diff.match = 'stop_times';
      diff.keyFields = ['trip_id', 'stop_sequence'];
      if (st) {
        Object.assign(diff, {
          raw: st.raw,
          grouped: st.grouped,
          changedCells: st.changedCells,
          formattingCells: st.formattingCells,
          records: countKinds(st.trips.map((c) => c.kind)),
        });
      }
    } else if (table === 'shapes') {
      const sh = diffShapes(this.pair, renames.maps);
      this.shapes = sh;
      diff.match = 'shapes';
      diff.keyFields = ['shape_id', 'shape_pt_sequence'];
      if (sh) {
        Object.assign(diff, {
          raw: sh.raw,
          grouped: sh.grouped,
          changedCells: sh.changedCells,
          formattingCells: sh.formattingCells,
          records: countKinds(sh.shapes.map((c) => c.kind)),
        });
      }
    } else {
      const t = diffTable(this.pair, table, renames.maps);
      this.tables.set(name, t);
      Object.assign(diff, {
        match: t.match,
        keyFields: t.keyFields,
        duplicateKeys: t.duplicateKeys,
        raw: t.raw,
        grouped: t.grouped,
        changedCells: t.changedCells,
        formattingCells: t.formattingCells,
        records: countKinds(t.log.kinds),
      });
    }
    if (inA && inB) {
      diff.status = fileStatus(diff);
    }
    return diff;
  }

  private has(s: SideData, name: string, table: string | null): boolean {
    if (table !== null && s.store.tableNames().includes(table)) {
      return true;
    }
    return (
      s.stream.otherFiles.includes(name) ||
      (table !== null && (s.stream.rows[table] ?? -1) >= 0)
    );
  }

  private columns(s: SideData, table: string): string[] {
    return s.store.tableNames().includes(table) ? s.store.columns(table) : [];
  }

  private rowCount(s: SideData, table: string): number {
    return s.store.counts()[table] ?? s.stream.rows[table] ?? 0;
  }

  private sameOtherFile(name: string): FileDiff['status'] {
    const a = this.pair.a.store.file(name);
    const b = this.pair.b.store.file(name);
    if (!a || !b) {
      return 'unknown';
    }
    if (a.length !== b.length) {
      return 'changed';
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return 'changed';
      }
    }
    return 'identical';
  }

  private buildGroups(renames: Renames): Group[] {
    const groups: Group[] = [];
    const add = (
      id: string,
      kind: Group['kind'],
      items: GroupItem[],
      files: string[],
      extra: Partial<Group> = {}
    ): void => {
      if (items.length === 0) {
        return;
      }
      this.items.set(id, items);
      groups.push({ id, kind, count: items.length, files, ...extra });
    };
    const homeFiles: Record<string, string[]> = {
      agency_id: ['agency.txt'],
      route_id: ['routes.txt'],
      stop_id: ['stops.txt'],
      service_id: ['calendar.txt', 'calendar_dates.txt'],
      shape_id: ['shapes.txt'],
      trip_id: ['trips.txt', 'stop_times.txt'],
    };
    for (const kind of ENTITY_KINDS) {
      const map = renames.maps[kind];
      add(
        `rename:${kind}`,
        'rename',
        [...map].map(([a, b]) => ({ kind: 'rename', a, b })),
        homeFiles[kind],
        { entity: kind }
      );
      add(
        `renameSuggestion:${kind}`,
        'renameSuggestion',
        renames.suggestions[kind].map((s) => ({
          kind: 'renameSuggestion',
          a: s.a,
          b: s.b,
        })),
        homeFiles[kind],
        { entity: kind }
      );
    }
    const services = this.serviceGroups(renames.maps.service_id);
    add('serviceDates', 'serviceDates', services.dates, homeFiles.service_id);
    add(
      'serviceWindow',
      'serviceWindow',
      services.window,
      homeFiles.service_id
    );
    add('stopMoved', 'stopMoved', this.movedStops(), ['stops.txt']);
    const st = this.stopTimes;
    if (st) {
      const covers = (list: { trips: number }[]): number =>
        list.reduce((n, g) => n + g.trips, 0);
      add('timeShift', 'timeShift', st.groups.timeShift, ['stop_times.txt'], {
        covers: covers(st.groups.timeShift),
      });
      add(
        'patternChange',
        'patternChange',
        st.groups.patternChange,
        ['stop_times.txt'],
        { covers: covers(st.groups.patternChange) }
      );
      add(
        'stopTimesFields',
        'stopTimesFields',
        st.groups.stopTimesFields,
        ['stop_times.txt'],
        {
          covers: covers(st.groups.stopTimesFields),
        }
      );
      add(
        'stopTimesTimes',
        'stopTimesTimes',
        st.groups.stopTimesTimes,
        ['stop_times.txt'],
        { covers: covers(st.groups.stopTimesTimes) }
      );
      add('tripCount', 'tripCount', st.groups.tripCount, ['trips.txt']);
    }
    if (this.shapes) {
      add('shapeChanged', 'shapeChanged', this.shapes.changedShapes, [
        'shapes.txt',
      ]);
    }
    return groups;
  }

  /** Date changes per service kept or renamed; window-only ones apart. */
  private serviceGroups(renamed: Map<string, string>): {
    dates: GroupItem[];
    window: GroupItem[];
  } {
    const { a, b } = this.pair;
    const dates: GroupItem[] = [];
    const window: GroupItem[] = [];
    const outside = (days: number[], w: SideData['window']): number =>
      w ? days.filter((d) => d < w.start || d > w.end).length : days.length;
    for (const [idA, daysA] of a.dates) {
      const idB = b.dates.has(idA) ? idA : renamed.get(idA);
      const daysB = idB === undefined ? undefined : b.dates.get(idB);
      if (!daysB || idB === undefined) {
        continue;
      }
      const added = minus(daysB, daysA);
      const removed = minus(daysA, daysB);
      if (added.length === 0 && removed.length === 0) {
        continue;
      }
      const out = outside(added, a.window) + outside(removed, b.window);
      const item: GroupItem = {
        kind:
          out === added.length + removed.length
            ? 'serviceWindow'
            : 'serviceDates',
        a: idA,
        b: idB,
        added: added.map(dateOf),
        removed: removed.map(dateOf),
        outsideWindow: out,
      };
      (item.kind === 'serviceWindow' ? window : dates).push(item);
    }
    return { dates, window };
  }

  /** Stops paired on both sides whose position changed. */
  private movedStops(): GroupItem[] {
    const t = this.tables.get('stops.txt');
    if (!t) {
      return [];
    }
    const out: Extract<GroupItem, { kind: 'stopMoved' }>[] = [];
    const tolerance = this.pair.options.coordToleranceM;
    for (let i = 0; i < t.log.size; i++) {
      if (t.log.a[i] < 0 || t.log.b[i] < 0) {
        continue;
      }
      const ra = this.pair.a.store.row('stops', t.log.a[i]);
      const rb = this.pair.b.store.row('stops', t.log.b[i]);
      if (
        !ra ||
        !rb ||
        (ra.stop_lat === rb.stop_lat && ra.stop_lon === rb.stop_lon)
      ) {
        continue;
      }
      const m = metres(+ra.stop_lon, +ra.stop_lat, +rb.stop_lon, +rb.stop_lat);
      if (!(m > tolerance)) {
        continue;
      }
      out.push({
        kind: 'stopMoved',
        a: ra.stop_id,
        b: rb.stop_id,
        metres: Math.round(m * 10) / 10,
      });
    }
    return out.sort((x, y) => y.metres - x.metres);
  }

  /** One entity on both sides, for its page. */
  entity(type: PageEntity, id: string): EntityView {
    return this.entities().read(type, id);
  }

  /** One page of a group's items. */
  groupItems(id: string, offset = 0, limit = 100): GroupItem[] {
    return (this.items.get(id) ?? []).slice(offset, offset + limit);
  }

  /** The kinds of a list of per-trip or per-shape records, cached per file. */
  private kindsOf(
    file: string,
    list: readonly { kind: RowChangeKind }[]
  ): RowChangeKind[] {
    let out = this.recordKinds.get(file);
    if (!out) {
      out = list.map((c) => c.kind);
      this.recordKinds.set(file, out);
    }
    return out;
  }

  /** Positions in `kinds` of one kind, cached per file. */
  private positions(
    file: string,
    kinds: readonly RowChangeKind[],
    kind: RowChangeKind
  ): Int32Array {
    const key = `${file}:${kind}`;
    let out = this.kindIndex.get(key);
    if (!out) {
      const list: number[] = [];
      for (let i = 0; i < kinds.length; i++) {
        if (kinds[i] === kind) {
          list.push(i);
        }
      }
      out = Int32Array.from(list);
      this.kindIndex.set(key, out);
    }
    return out;
  }

  /** Positions `[offset, offset + limit)` of the records of one kind, or all. */
  private page(
    file: string,
    kinds: readonly RowChangeKind[],
    offset: number,
    limit: number,
    kind?: RowChangeKind
  ): number[] {
    if (!kind) {
      const end = Math.min(kinds.length, offset + limit);
      return Array.from(
        { length: Math.max(0, end - offset) },
        (_, i) => offset + i
      );
    }
    return [
      ...this.positions(file, kinds, kind).subarray(offset, offset + limit),
    ];
  }

  private entities(): EntityReader {
    this.reader ??= new EntityReader(
      this.pair,
      this.renames,
      this.stopTimes,
      this.shapes,
      this.shapes?.changedShapes ?? []
    );
    return this.reader;
  }

  /**
   * One page of a file's differing records, optionally of one kind, in the
   * order the comparison found them. stop_times and shapes give one record
   * per trip or shape, with its row counts.
   */
  rowChanges(
    file: string,
    offset = 0,
    limit = 100,
    kind?: RowChangeKind
  ): RowChange[] {
    const { a, b } = this.pair;
    if (file === 'stop_times.txt' && this.stopTimes) {
      const trips = this.stopTimes.trips;
      const kinds = this.kindsOf(file, trips);
      const pa = a.patterns;
      const pb = b.patterns;
      return this.page(file, kinds, offset, limit, kind).map((i) => {
        const c = trips[i];
        const id = c.b >= 0 ? pb!.tripId(c.b) : pa!.tripId(c.a);
        return {
          kind: c.kind,
          key: id,
          owner: { kind: 'trip_id', id },
          fields: [],
          rows: c.rows,
        };
      });
    }
    if (file === 'shapes.txt' && this.shapes) {
      const shapes = this.shapes.shapes;
      const kinds = this.kindsOf(file, shapes);
      return this.page(file, kinds, offset, limit, kind).map((i) => {
        const c = shapes[i];
        const id = c.b ?? c.a ?? '';
        return {
          kind: c.kind,
          key: id,
          owner: { kind: 'shape_id', id },
          fields: [],
          rows: c.rows,
        };
      });
    }
    const t = this.tables.get(file);
    if (!t) {
      return [];
    }
    const table = file.slice(0, -4);
    const ownerKind = OWNER[table];
    const reader = this.entities();
    return this.page(file, t.log.kinds, offset, limit, kind).map((i) => {
      const ra = t.log.a[i] >= 0 ? a.store.row(table, t.log.a[i]) : null;
      const rb = t.log.b[i] >= 0 ? b.store.row(table, t.log.b[i]) : null;
      const k = t.log.kinds[i];
      const row = rb ?? ra ?? {};
      const out: RowChange = {
        kind: k,
        key: t.keyFields.map((f) => row[f] ?? '').join(' / '),
        fields: reader.pairRecord(table, ra, rb, k === 'renamed').fields,
      };
      const id = ownerKind ? row[ownerKind] : undefined;
      if (ownerKind && id) {
        out.owner = { kind: ownerKind, id };
      }
      return out;
    });
  }
}

export function compare(
  a: LoadedSide,
  b: LoadedSide,
  options: CompareOptions,
  progress: (p: CompareProgress) => void
): Comparison {
  return new Comparison(new FeedPair(a, b, options), progress);
}

function padded(s: SideData, table: string | null): number {
  if (table === null) {
    return 0;
  }
  let n = 0;
  for (const [key, count] of Object.entries(s.stream.padded)) {
    if (key.startsWith(`${table}.`)) {
      n += count;
    }
  }
  return n;
}

function headerDiff(a: string[], b: string[]): HeaderDiff {
  const shared = a.filter((c) => b.includes(c));
  const sharedB = b.filter((c) => a.includes(c));
  return {
    a,
    b,
    added: b.filter((c) => !a.includes(c)),
    removed: a.filter((c) => !b.includes(c)),
    reordered: shared.some((c, i) => sharedB[i] !== c),
  };
}

function fileStatus(d: FileDiff): FileDiff['status'] {
  const g = d.grouped;
  if (g.added + g.removed + g.changed + g.renamed + g.followsRename > 0) {
    return 'changed';
  }
  const h = d.header;
  if (
    g.formatting > 0 ||
    (h && (h.added.length > 0 || h.removed.length > 0 || h.reordered)) ||
    d.bytes === 'different'
  ) {
    return 'formatting';
  }
  return d.bytes === 'unknown' ? 'unknown' : 'identical';
}

/**
 * Raw vs grouped, per file: every raw added, removed and changed row is
 * either still that, or one of the grouped kinds, and nothing is counted
 * twice.
 */
function checkCompleteness(files: FileDiff[]): Completeness {
  const mismatches: string[] = [];
  for (const f of files) {
    const r = f.raw;
    const g = f.grouped;
    const pairsRaw = r.changed + r.unchanged;
    const pairsGrouped =
      g.changed + g.formatting + g.followsRename + g.renamed + g.unchanged;
    const checks: [string, number, number][] = [
      ['removed', r.removed, g.removed + g.rematched],
      ['added', r.added, g.added + g.rematched],
      ['pairs', pairsRaw + g.rematched, pairsGrouped],
      ['unchanged', r.unchanged, g.unchanged],
    ];
    for (const [what, raw, grouped] of checks) {
      if (raw !== grouped) {
        mismatches.push(`${f.file} ${what}: raw ${raw}, grouped ${grouped}`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function summarize(s: SideData): SideSummary {
  const agencies: string[] = [];
  s.store.scan('agency', ['agency_name'], ([name]) => agencies.push(name));
  const feedInfo = s.store.hasTable('feed_info')
    ? (s.store.rows('feed_info', 0, 1)[0]?.row ?? null)
    : null;
  return {
    counts: s.store.counts(),
    shapeCount: s.store.shapeIds().length,
    window: s.window
      ? { start: dateOf(s.window.start), end: dateOf(s.window.end) }
      : null,
    agencies,
    feedInfo,
    otherFiles: s.stream.otherFiles,
  };
}
