/**
 * The comparison as MobilityData GTFS Diff v2 JSON (schema 2.0.0-rc1).
 *
 * `row_changes` is the raw, key-based diff: rows paired on the same key text
 * are `modified`, and everything else, renamed keys included, is `deleted`
 * plus `added`. Renames, moved stops and changed shapes are highlights whose
 * references name the rows on both sides. The output is written in Blob
 * chunks, so an uncapped export of a big pair is never one string.
 */

import { pairBySequence, type FeedPair, type SideData } from './pair';
import type { TableResult } from './rows';
import type { ShapesResult } from './shapes';
import { MERGE_RADIUS_M } from './stop-merges';
import { TripRows, type StopTimesResult } from './stop-times';
import type {
  DiffResult,
  EntityKind,
  FileDiff,
  GroupItem,
  Side,
} from './types';

export interface ExportOptions {
  /** Row changes kept per file; null keeps them all. */
  cap: number | null;
  /** How each feed is named: its URL, or the uploaded file's name. */
  sources: Record<Side, string>;
}

export interface ExportSources {
  pair: FeedPair;
  result: DiffResult;
  tables: ReadonlyMap<string, TableResult>;
  stopTimes: StopTimesResult | null;
  shapes: ShapesResult | null;
  items: (groupId: string) => readonly GroupItem[];
}

const SCHEMA_VERSION = '2.0.0-rc1';
/** Characters buffered before they are folded into a Blob. */
const FLUSH_CHARS = 4_000_000;

/** Strings collected into Blob chunks. */
class BlobWriter {
  private blobs: Blob[] = [];
  private parts: string[] = [];
  private chars = 0;

  write(s: string): void {
    this.parts.push(s);
    this.chars += s.length;
    if (this.chars >= FLUSH_CHARS) {
      this.flush();
    }
  }

  /** Appends Blob chunks after what was written so far. */
  append(chunks: Blob[]): void {
    this.flush();
    for (const c of chunks) {
      this.blobs.push(c);
    }
  }

  private flush(): void {
    if (this.parts.length > 0) {
      this.blobs.push(new Blob(this.parts));
      this.parts = [];
      this.chars = 0;
    }
  }

  /** Everything written so far, as Blob parts. */
  chunks(): Blob[] {
    this.flush();
    return this.blobs;
  }
}

/** A JSON array written one element at a time. */
class ArrayWriter {
  private out = new BlobWriter();
  n = 0;

  constructor() {
    this.out.write('[');
  }

  push(value: unknown): void {
    this.out.write((this.n++ > 0 ? ',' : '') + JSON.stringify(value));
  }

  chunks(): Blob[] {
    this.out.write(']');
    return this.out.chunks();
  }
}

type Identifier = Record<string, string>;

interface FieldChange {
  field: string;
  base_value: string;
  new_value: string;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** One file's row changes, capped, with uncapped counts. */
class RowChanges {
  readonly added = new ArrayWriter();
  readonly deleted = new ArrayWriter();
  readonly modified = new ArrayWriter();
  counts = { added: 0, deleted: 0, modified: 0 };
  /** Modified rows per column. */
  columnCounts = new Map<string, number>();
  omitted = 0;
  private keyAt: number[];

  constructor(
    readonly columns: string[],
    readonly primaryKey: string[],
    private cap: number | null
  ) {
    this.keyAt = primaryKey.map((f) => columns.indexOf(f));
  }

  private keep(): boolean {
    const n = this.counts.added + this.counts.deleted + this.counts.modified;
    if (this.cap === null || n < this.cap) {
      return true;
    }
    this.omitted++;
    return false;
  }

  private identifier(values: readonly string[]): Identifier {
    const out: Identifier = {};
    this.primaryKey.forEach((f, i) => {
      out[f] = values[this.keyAt[i]] ?? '';
    });
    return out;
  }

  private raw(values: readonly string[]): string {
    return this.columns.map((_, i) => csvCell(values[i] ?? '')).join(',');
  }

  add(values: readonly string[], line: number): void {
    if (this.keep()) {
      this.added.push({
        identifier: this.identifier(values),
        raw_value: this.raw(values),
        new_line_number: line,
      });
    }
    this.counts.added++;
  }

  delete(values: readonly string[], line: number): void {
    if (this.keep()) {
      this.deleted.push({
        identifier: this.identifier(values),
        raw_value: this.raw(values),
        base_line_number: line,
      });
    }
    this.counts.deleted++;
  }

  /** A pair on the same key; nothing is written when every cell is equal. */
  modify(
    a: readonly string[],
    b: readonly string[],
    lineA: number,
    lineB: number
  ): void {
    const changes: FieldChange[] = [];
    this.columns.forEach((field, i) => {
      const base = a[i] ?? '';
      const next = b[i] ?? '';
      if (base !== next) {
        changes.push({ field, base_value: base, new_value: next });
      }
    });
    if (changes.length === 0) {
      return;
    }
    for (const c of changes) {
      this.columnCounts.set(c.field, (this.columnCounts.get(c.field) ?? 0) + 1);
    }
    if (this.keep()) {
      this.modified.push({
        identifier: this.identifier(a),
        raw_value: this.raw(a),
        base_line_number: lineA,
        new_line_number: lineB,
        field_changes: changes,
      });
    }
    this.counts.modified++;
  }
}

function rowCount(s: SideData, table: string): number {
  return s.store.counts()[table] ?? 0;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** v2's action for a file, or null when no value differs. */
function fileAction(f: FileDiff): 'added' | 'deleted' | 'modified' | null {
  if (f.status === 'added') {
    return 'added';
  }
  if (f.status === 'removed') {
    return 'deleted';
  }
  const r = f.raw;
  const h = f.header;
  return r.added + r.removed + r.changed > 0 ||
    (h !== null && (h.added.length > 0 || h.removed.length > 0))
    ? 'modified'
    : null;
}

/** Fills `rc` with an ordinary table's raw row changes. */
function tableRows(
  src: ExportSources,
  t: TableResult,
  table: string,
  rc: RowChanges
): void {
  const { a, b } = src.pair;
  const cols = t.cols;
  const values = (s: SideData, id: number): string[] => {
    const row = s.store.row(table, id) ?? {};
    return cols.map((c) => row[c] ?? '');
  };
  const line = (s: SideData, id: number): number =>
    s.store.line(table, id) ?? id + 2;
  const keyAt = t.keyFields.map((f) => cols.indexOf(f));
  const sameKey = (x: string[], y: string[]): boolean =>
    keyAt.every((i) => i >= 0 && x[i] === y[i]);
  const log = t.log;
  for (let i = 0; i < log.size; i++) {
    const ia = log.a[i];
    const ib = log.b[i];
    const va = ia >= 0 ? values(a, ia) : null;
    const vb = ib >= 0 ? values(b, ib) : null;
    if (va && vb) {
      const rawPair =
        t.match === 'single' || (t.match === 'keyed' && sameKey(va, vb));
      if (rawPair) {
        rc.modify(va, vb, line(a, ia), line(b, ib));
        continue;
      }
    }
    if (va) {
      rc.delete(va, line(a, ia));
    }
    if (vb) {
      rc.add(vb, line(b, ib));
    }
  }
}

/** Rows of two sides of one trip or shape, paired by sequence on the same id. */
function sequenceRows(
  rc: RowChanges,
  rowsA: string[][] | null,
  rowsB: string[][] | null,
  linesA: ArrayLike<number> | null,
  linesB: ArrayLike<number> | null,
  sameId: boolean,
  seqAt: number
): void {
  const la = (k: number): number => linesA?.[k] ?? 1;
  const lb = (k: number): number => linesB?.[k] ?? 1;
  if (rowsA && rowsB && sameId) {
    const { partner, usedB } = pairBySequence(rowsA, rowsB, seqAt);
    rowsA.forEach((row, i) => {
      const k = partner[i];
      if (k < 0) {
        rc.delete(row, la(i));
      } else {
        rc.modify(row, rowsB[k], la(i), lb(k));
      }
    });
    rowsB.forEach((row, k) => {
      if (!usedB[k]) {
        rc.add(row, lb(k));
      }
    });
    return;
  }
  rowsA?.forEach((row, i) => rc.delete(row, la(i)));
  rowsB?.forEach((row, k) => rc.add(row, lb(k)));
}

function stopTimesRows(
  src: ExportSources,
  st: StopTimesResult,
  rc: RowChanges
): void {
  const pa = src.pair.a.patterns;
  const pb = src.pair.b.patterns;
  const rowsA = pa ? new TripRows(pa, st.cols) : null;
  const rowsB = pb ? new TripRows(pb, st.cols) : null;
  const seqAt = st.cols.indexOf('stop_sequence');
  for (const c of st.trips) {
    const ta = c.a >= 0 && pa && rowsA ? rowsA.trip(c.a) : null;
    const tb = c.b >= 0 && pb && rowsB ? rowsB.trip(c.b) : null;
    sequenceRows(
      rc,
      ta,
      tb,
      ta ? pa!.tripLines(c.a) : null,
      tb ? pb!.tripLines(c.b) : null,
      ta !== null && tb !== null && pa!.tripId(c.a) === pb!.tripId(c.b),
      seqAt
    );
  }
}

function shapesRows(
  src: ExportSources,
  sh: ShapesResult,
  rc: RowChanges
): void {
  const { a, b } = src.pair;
  const seqAt = sh.cols.indexOf('shape_pt_sequence');
  const values = (s: SideData, id: string): string[][] =>
    s.store.shapeRows(id).map((r) => sh.cols.map((c) => r[c] ?? ''));
  for (const c of sh.shapes) {
    sequenceRows(
      rc,
      c.a !== null ? values(a, c.a) : null,
      c.b !== null ? values(b, c.b) : null,
      c.a !== null ? a.store.shapeLines(c.a) : null,
      c.b !== null ? b.store.shapeLines(c.b) : null,
      c.a !== null && c.a === c.b,
      seqAt
    );
  }
}

/** One file_diffs entry, written to `out`. */
function writeFile(
  out: BlobWriter,
  src: ExportSources,
  f: FileDiff,
  action: 'added' | 'deleted' | 'modified',
  cap: number | null
): void {
  const h = f.header;
  const head = {
    file_name: f.file,
    file_action: action,
    columns_added: (h?.added ?? []).map((name) => ({
      name,
      position: h!.b.indexOf(name) + 1,
    })),
    columns_deleted: (h?.removed ?? []).map((name) => ({
      name,
      position: h!.a.indexOf(name) + 1,
    })),
  };
  const json = JSON.stringify(head);
  if (action !== 'modified') {
    out.write(json);
    return;
  }
  const table = f.file.slice(0, -4);
  let rc: RowChanges | null = null;
  if (table === 'stop_times' && src.stopTimes) {
    rc = new RowChanges(src.stopTimes.cols, f.keyFields, cap);
    stopTimesRows(src, src.stopTimes, rc);
  } else if (table === 'shapes' && src.shapes) {
    rc = new RowChanges(src.shapes.cols, f.keyFields, cap);
    shapesRows(src, src.shapes, rc);
  } else {
    const t = src.tables.get(f.file);
    if (t) {
      rc = new RowChanges(
        t.cols,
        t.keyFields.length > 0 ? t.keyFields : t.cols,
        cap
      );
      tableRows(src, t, table, rc);
    }
  }
  out.write(json.slice(0, -1));
  if (!rc) {
    out.write('}');
    return;
  }
  const { counts } = rc;
  const raw = f.raw;
  if (
    counts.added !== raw.added ||
    counts.deleted !== raw.removed ||
    counts.modified !== raw.changed
  ) {
    console.warn(`[export] ${f.file}: row changes differ from raw counts`, {
      counts,
      raw,
    });
  }
  out.write(
    `,"row_changes":{"primary_key":${JSON.stringify(rc.primaryKey)},"columns":${JSON.stringify(rc.columns)},"added":`
  );
  for (const [name, list] of [
    ['added', rc.added],
    ['deleted', rc.deleted],
    ['modified', rc.modified],
  ] as const) {
    if (name !== 'added') {
      out.write(`,"${name}":`);
    }
    out.append(list.chunks());
  }
  const baseRows = rowCount(src.pair.a, table);
  const newRows = rowCount(src.pair.b, table);
  const total = counts.added + counts.deleted + counts.modified;
  const stats = {
    total_rows_base: baseRows,
    total_rows_new: newRows,
    columns_added_count: head.columns_added.length,
    columns_deleted_count: head.columns_deleted.length,
    rows_added_count: counts.added,
    rows_deleted_count: counts.deleted,
    rows_modified_count: counts.modified,
    // Renamed rows count as deleted and added, so the share can pass 100.
    rows_changed_percentage: Math.min(
      100,
      round1((100 * total) / Math.max(1, baseRows, newRows))
    ),
    column_stats: [...rc.columnCounts]
      .sort((x, y) => y[1] - x[1])
      .map(([column, n]) => ({
        column,
        modifications_count: n,
        modifications_percentage: round1((100 * n) / counts.modified),
      })),
  };
  out.write(`},"stats":${JSON.stringify(stats)}`);
  if (rc.omitted > 0) {
    out.write(
      `,"truncated":${JSON.stringify({ is_truncated: true, omitted_count: rc.omitted })}`
    );
  }
  out.write('}');
}

interface Reference {
  file_name: string;
  feed: 'base' | 'new';
  identifier: Identifier;
}

interface Highlight {
  code: string;
  message: string;
  files: string[];
  references?: Reference[];
  details?: Record<string, unknown>;
}

const ENTITY_FILE: Record<EntityKind, string> = {
  agency_id: 'agency.txt',
  route_id: 'routes.txt',
  stop_id: 'stops.txt',
  service_id: 'calendar.txt',
  shape_id: 'shapes.txt',
  trip_id: 'trips.txt',
};

/** The file an id lives in on one side (calendar or calendar_dates for a service). */
function entityFile(s: SideData, kind: EntityKind, id: string): string {
  if (kind !== 'service_id') {
    return ENTITY_FILE[kind];
  }
  return s.store.hasTable('calendar') &&
    s.store.find('calendar', 'service_id', id).length > 0
    ? 'calendar.txt'
    : 'calendar_dates.txt';
}

function stopPoint(
  s: SideData,
  id: string
): {
  name: string;
  at: [number, number];
} {
  const row = s.store.find('stops', 'stop_id', id)[0]?.row;
  return {
    name: row?.stop_name ?? '',
    at: [Number(row?.stop_lat), Number(row?.stop_lon)],
  };
}

function highlights(src: ExportSources, cap: number | null) {
  const { a, b } = src.pair;
  const tolerance = src.pair.options.coordToleranceM;
  const byCode = new Map<string, Highlight[]>();
  const push = (h: Highlight): void => {
    let list = byCode.get(h.code);
    if (!list) {
      byCode.set(h.code, (list = []));
    }
    list.push(h);
  };
  const ref = (side: Side, kind: EntityKind, id: string): Reference => ({
    file_name: entityFile(src.pair.side(side), kind, id),
    feed: side === 'a' ? 'base' : 'new',
    identifier: { [kind]: id },
  });

  for (const g of src.result.groups) {
    const kind = g.entity;
    for (const item of src.items(g.id)) {
      if (item.kind === 'rename' && kind) {
        push({
          code: 'id_renamed',
          message: `${kind} ${item.a} is ${item.b} in the new feed.`,
          files: g.files,
          references: [ref('a', kind, item.a), ref('b', kind, item.b)],
          details: { field: kind, base_id: item.a, new_id: item.b },
        });
      } else if (item.kind === 'renameSuggestion' && kind) {
        push({
          code: 'id_rename_suggested',
          message: `${kind} ${item.a.join(', ')} may be ${item.b.join(', ')} in the new feed; the match is ambiguous.`,
          files: g.files,
          references: [
            ...item.a.map((id) => ref('a', kind, id)),
            ...item.b.map((id) => ref('b', kind, id)),
          ],
          details: { field: kind, base_ids: item.a, new_ids: item.b },
        });
      } else if (item.kind === 'stopMoved') {
        const pa = stopPoint(a, item.a);
        const pb = stopPoint(b, item.b);
        push({
          code: 'stop_moved',
          message: `Stop ${pb.name || item.b} moved ${item.metres} m.`,
          files: ['stops.txt'],
          references: [
            ref('a', 'stop_id', item.a),
            ref('b', 'stop_id', item.b),
          ],
          details: {
            stop_name: pb.name,
            distance_m: item.metres,
            base: pa.at,
            new: pb.at,
          },
        });
      } else if (item.kind === 'stopMerged') {
        const suggested = g.kind === 'stopMergeSuggestion';
        push({
          code: suggested ? 'stop_merge_suggested' : 'stop_merged',
          message: `Stops ${item.a.join(', ')} ${suggested ? 'may be' : 'are'} merged into ${item.b} in the new feed.`,
          files: g.files,
          references: [
            ...item.a.map((id) => ref('a', 'stop_id', id)),
            ref('b', 'stop_id', item.b),
          ],
          details: {
            base_ids: item.a,
            new_id: item.b,
            distances_m: item.metres,
            trips: item.trips,
            share: item.share,
          },
        });
      } else if (item.kind === 'stopSplit') {
        const suggested = g.kind === 'stopMergeSuggestion';
        push({
          code: suggested ? 'stop_split_suggested' : 'stop_split',
          message: `Stop ${item.a} ${suggested ? 'may be' : 'is'} split into ${item.b.join(', ')} in the new feed.`,
          files: g.files,
          references: [
            ref('a', 'stop_id', item.a),
            ...item.b.map((id) => ref('b', 'stop_id', id)),
          ],
          details: {
            base_id: item.a,
            new_ids: item.b,
            distances_m: item.metres,
            trips: item.trips,
            share: item.share,
            parent_station: item.station,
          },
        });
      } else if (item.kind === 'shapeChanged' && item.metres > tolerance) {
        push({
          code: 'shape_moved',
          message: `Shape ${item.b} moved up to ${item.metres} m.`,
          files: ['shapes.txt'],
          references: [
            ref('a', 'shape_id', item.a),
            ref('b', 'shape_id', item.b),
          ],
          details: {
            distance_m: item.metres,
            base_points: item.pointsA,
            new_points: item.pointsB,
          },
        });
      }
    }
  }
  for (const f of src.result.files) {
    if (!f.table && f.status === 'changed') {
      push({
        code: 'unsupported_file_changed',
        message: `${f.file} differs between the two feeds.`,
        files: [f.file],
      });
    }
  }
  if (byCode.size === 0) {
    return null;
  }
  const counts: Record<string, number> = {};
  const items: Highlight[] = [];
  for (const [code, list] of byCode) {
    counts[code] = list.length;
    const kept = cap === null ? list.length : Math.min(cap, list.length);
    for (let i = 0; i < kept; i++) {
      items.push(list[i]);
    }
  }
  return {
    cap_per_code: cap,
    parameters: {
      stop_moved_m: tolerance,
      shape_moved_m: tolerance,
      stop_merge_radius_m: MERGE_RADIUS_M,
    },
    counts,
    items,
  };
}

/** The whole v2 document as a Blob. */
export function exportV2(src: ExportSources, options: ExportOptions): Blob {
  const { pair, result } = src;
  const cap = options.cap;
  const unsupported = result.files
    .filter((f) => !f.table)
    .map((f) => ({
      file_name: f.file,
      present_in:
        f.status === 'added' ? 'new' : f.status === 'removed' ? 'base' : 'both',
    }));
  const changed = result.files
    .filter((f) => f.table)
    .map((f) => ({ f, action: fileAction(f) }))
    .filter(
      (x): x is { f: FileDiff; action: NonNullable<typeof x.action> } =>
        x.action !== null
    );
  const count = (action: string): number =>
    changed.filter((x) => x.action === action).length;
  const metadata = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    row_changes_cap_per_file: cap,
    base_feed: { source: options.sources.a, downloaded_at: pair.a.loadedAt },
    new_feed: { source: options.sources.b, downloaded_at: pair.b.loadedAt },
    unsupported_files: unsupported,
  };
  const summary = {
    total_changes: changed.reduce(
      (n, { f }) => n + f.raw.added + f.raw.removed + f.raw.changed,
      0
    ),
    files_added_count: count('added'),
    files_deleted_count: count('deleted'),
    files_modified_count: count('modified'),
    files_not_compared_count: 0,
    files: changed.map(({ f, action }) => ({
      file_name: f.file,
      status: action,
    })),
  };

  const out = new BlobWriter();
  out.write(
    `{"metadata":${JSON.stringify(metadata)},"summary":${JSON.stringify(summary)},"file_diffs":[`
  );
  changed.forEach(({ f, action }, i) => {
    if (i > 0) {
      out.write(',');
    }
    const t0 = performance.now();
    writeFile(out, src, f, action, cap);
    console.log(`[export] ${f.file}: ${Math.round(performance.now() - t0)} ms`);
  });
  out.write(']');
  const h = highlights(src, cap);
  if (h) {
    out.write(`,"highlights":${JSON.stringify(h)}`);
  }
  out.write('}');
  return new Blob(out.chunks(), { type: 'application/json' });
}
