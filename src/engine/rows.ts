/**
 * Row diff of an ordinary table (everything but stop_times and shapes).
 *
 * Two matchings over the same rows. Raw: the spec key's text, nothing else.
 * Grouped: raw pairs stay paired, then the leftovers are matched again with
 * renamed ids applied to the key, so a renamed entity's row pairs with its
 * new row instead of showing as removed + added. Files without a usable key
 * (no spec key, all fields, or duplicate keys) are matched as multisets of
 * whole rows, the grouped pass on canonical values.
 *
 * Keys are 53-bit hashes in sorted typed arrays, not string maps, so a
 * multi-million row calendar_dates costs tens of MB. A hash match is
 * checked against the key text.
 */

import { getGTFSPrimaryKey } from 'gtfs-zone-web-common/gtfs/spec/primary-keys';
import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import { CellComparer } from './compare-cells';
import { Hasher } from './hash';
import { canonFor } from './normalize';
import type { FeedPair, RenameMaps } from './pair';
import type {
  FeedIssue,
  GroupedCounts,
  RawCounts,
  RowChangeKind,
} from './types';

/** Differing rows of one file, as row ids (-1 for none). */
export class ChangeLog {
  kinds: RowChangeKind[] = [];
  a: number[] = [];
  b: number[] = [];

  push(kind: RowChangeKind, a: number, b: number): void {
    this.kinds.push(kind);
    this.a.push(a);
    this.b.push(b);
  }

  get size(): number {
    return this.kinds.length;
  }
}

export interface TableResult {
  cols: string[];
  match: 'keyed' | 'multiset' | 'single';
  keyFields: string[];
  duplicateKeys: { a: number; b: number };
  raw: RawCounts;
  grouped: GroupedCounts;
  changedCells: Record<string, number>;
  formattingCells: Record<string, number>;
  log: ChangeLog;
  issues: FeedIssue[];
}

export function emptyRaw(): RawCounts {
  return { added: 0, removed: 0, changed: 0, unchanged: 0 };
}

export function emptyGrouped(): GroupedCounts {
  return {
    added: 0,
    removed: 0,
    changed: 0,
    formatting: 0,
    followsRename: 0,
    renamed: 0,
    unchanged: 0,
    rematched: 0,
  };
}

/** Sorted (hash, id) pairs with lookups by hash. */
class HashIndex {
  readonly hashes: Float64Array;
  readonly ids: Int32Array;
  /** Index entries taken by a match. */
  readonly used: Uint8Array;

  constructor(hashes: number[], ids: number[]) {
    const order = Uint32Array.from(hashes.keys()).sort(
      (x, y) => hashes[x] - hashes[y] || ids[x] - ids[y]
    );
    this.hashes = Float64Array.from(order, (i) => hashes[i]);
    this.ids = Int32Array.from(order, (i) => ids[i]);
    this.used = new Uint8Array(order.length);
  }

  /** First entry with hash `h`, or -1. */
  first(h: number): number {
    let lo = 0;
    let hi = this.hashes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.hashes[mid] < h) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < this.hashes.length && this.hashes[lo] === h ? lo : -1;
  }

  /** Entries whose hash equals the one before them. */
  repeats(): number {
    let n = 0;
    for (let i = 1; i < this.hashes.length; i++) {
      if (this.hashes[i] === this.hashes[i - 1]) {
        n++;
      }
    }
    return n;
  }
}

/** Values of row `id` in `cols` order. */
function rowValues(
  store: FeedStore,
  table: string,
  id: number,
  cols: string[]
): string[] {
  const row = store.row(table, id);
  return cols.map((c) => row?.[c] ?? '');
}

function sameAt(
  a: ArrayLike<string>,
  b: ArrayLike<string>,
  at: number[]
): boolean {
  for (const i of at) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function diffTable(
  pair: FeedPair,
  table: string,
  maps: RenameMaps
): TableResult {
  const sa = pair.a.store;
  const sb = pair.b.store;
  const colsA = sa.hasTable(table) ? sa.columns(table) : [];
  const colsB = sb.hasTable(table) ? sb.columns(table) : [];
  const cols = [...colsA, ...colsB.filter((c) => !colsA.includes(c))];
  const spec = getGTFSPrimaryKey(table);
  const keyFields =
    spec && (spec.type === 'natural' || spec.type === 'composite')
      ? spec.fields
      : [];
  const result: TableResult = {
    cols,
    match: 'keyed',
    keyFields,
    duplicateKeys: { a: 0, b: 0 },
    raw: emptyRaw(),
    grouped: emptyGrouped(),
    changedCells: {},
    formattingCells: {},
    log: new ChangeLog(),
    issues: [],
  };
  const cmp = new CellComparer(table, cols, maps, pair.options.coordToleranceM);

  if (spec?.singleRow || spec?.type === 'none') {
    result.match = 'single';
    diffByOrder(pair, table, cmp, result);
  } else if (keyFields.length > 0) {
    const keyAt = keyFields.map((f) => {
      const i = cols.indexOf(f);
      return i < 0 ? cols.length : i;
    });
    const dupA = keyIndex(sa, table, cols, keyAt).repeats();
    const dupB = keyIndex(sb, table, cols, keyAt).repeats();
    result.duplicateKeys = { a: dupA, b: dupB };
    if (dupA > 0 || dupB > 0) {
      for (const [side, n] of [
        ['a', dupA],
        ['b', dupB],
      ] as const) {
        if (n > 0) {
          result.issues.push({
            side,
            file: `${table}.txt`,
            code: 'duplicateKeys',
            count: n,
            detail: keyFields.join(', '),
          });
        }
      }
      result.match = 'multiset';
      diffMultiset(pair, table, cmp, result);
    } else {
      diffKeyed(pair, table, cmp, keyAt, result);
    }
  } else {
    result.match = 'multiset';
    diffMultiset(pair, table, cmp, result);
  }
  return result;
}

/** Hash of the key cells; `mapped` applies renames to A's values. */
function keyHash(
  h: Hasher,
  values: ArrayLike<string>,
  keyAt: number[],
  cmp: CellComparer | null
): number {
  h.reset();
  for (const i of keyAt) {
    const v = values[i] ?? '';
    h.str(cmp ? cmp.mapped(i, v) : v);
  }
  return h.value;
}

function keyIndex(
  store: FeedStore,
  table: string,
  cols: string[],
  keyAt: number[]
): HashIndex {
  const hashes: number[] = [];
  const ids: number[] = [];
  const h = new Hasher();
  store.scan(table, cols, (values, id) => {
    hashes.push(keyHash(h, values, keyAt, null));
    ids.push(id);
  });
  return new HashIndex(hashes, ids);
}

function record(
  result: TableResult,
  verdict: ReturnType<CellComparer['rows']>,
  a: number,
  b: number,
  rematched: boolean
): void {
  const g = result.grouped;
  if (rematched) {
    g.rematched++;
  }
  for (const c of verdict.changed) {
    result.changedCells[c] = (result.changedCells[c] ?? 0) + 1;
  }
  if (verdict.kind === 'unchanged') {
    g.unchanged++;
    return;
  }
  for (const c of verdict.formatting) {
    result.formattingCells[c] = (result.formattingCells[c] ?? 0) + 1;
  }
  g[verdict.kind]++;
  result.log.push(verdict.kind, a, b);
}

function diffKeyed(
  pair: FeedPair,
  table: string,
  cmp: CellComparer,
  keyAt: number[],
  result: TableResult
): void {
  const sa = pair.a.store;
  const sb = pair.b.store;
  const { cols, raw, grouped } = result;
  const index = keyIndex(sb, table, cols, keyAt);
  const renamable = keyAt.some((i) => i < cols.length && cmp.renamable(i));
  const h = new Hasher();
  /** A rows without a raw match, kept for the grouped pass. */
  const leftover: { id: number; values: string[] }[] = [];

  sa.scan(table, cols, (values, id) => {
    let at = index.first(keyHash(h, values, keyAt, null));
    let bValues: string[] | null = null;
    while (at >= 0) {
      bValues = rowValues(sb, table, index.ids[at], cols);
      if (sameAt(values, bValues, keyAt)) {
        break;
      }
      // A hash collision: a different key with the same hash.
      bValues = null;
      at = index.hashes[at + 1] === index.hashes[at] ? at + 1 : -1;
    }
    if (at < 0 || !bValues) {
      raw.removed++;
      if (renamable) {
        leftover.push({ id, values: [...values] });
      } else {
        grouped.removed++;
        result.log.push('removed', id, -1);
      }
      return;
    }
    index.used[at] = 1;
    let rawSame = true;
    for (let i = 0; i < cols.length; i++) {
      if (values[i] !== bValues[i]) {
        rawSame = false;
        break;
      }
    }
    if (rawSame) {
      raw.unchanged++;
    } else {
      raw.changed++;
    }
    record(result, cmp.rows(values, bValues, false), id, index.ids[at], false);
  });

  // B rows without a raw match, by mapped key hash.
  const restHashes: number[] = [];
  const restIds: number[] = [];
  for (let i = 0; i < index.ids.length; i++) {
    if (!index.used[i]) {
      raw.added++;
      restHashes.push(index.hashes[i]);
      restIds.push(index.ids[i]);
    }
  }
  const rest = new HashIndex(restHashes, restIds);
  for (const { id, values } of leftover) {
    const mappedValues = values.map((v, i) => cmp.mapped(i, v));
    let at = rest.first(keyHash(h, values, keyAt, cmp));
    let bValues: string[] | null = null;
    while (at >= 0) {
      if (!rest.used[at]) {
        bValues = rowValues(sb, table, rest.ids[at], cols);
        if (sameAt(mappedValues, bValues, keyAt)) {
          break;
        }
      }
      bValues = null;
      at = rest.hashes[at + 1] === rest.hashes[at] ? at + 1 : -1;
    }
    if (at < 0 || !bValues) {
      grouped.removed++;
      result.log.push('removed', id, -1);
      continue;
    }
    rest.used[at] = 1;
    record(result, cmp.rows(values, bValues, true), id, rest.ids[at], true);
  }
  for (let i = 0; i < rest.ids.length; i++) {
    if (!rest.used[i]) {
      grouped.added++;
      result.log.push('added', -1, rest.ids[i]);
    }
  }
}

/** Rows paired by position (single-row files such as feed_info.txt). */
function diffByOrder(
  pair: FeedPair,
  table: string,
  cmp: CellComparer,
  result: TableResult
): void {
  const { cols, raw, grouped } = result;
  const read = (store: FeedStore): { id: number; values: string[] }[] => {
    const out: { id: number; values: string[] }[] = [];
    store.scan(table, cols, (values, id) =>
      out.push({ id, values: [...values] })
    );
    return out;
  };
  const a = read(pair.a.store);
  const b = read(pair.b.store);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const same = cols.every((_, c) => a[i].values[c] === b[i].values[c]);
    if (same) {
      raw.unchanged++;
    } else {
      raw.changed++;
    }
    record(
      result,
      cmp.rows(a[i].values, b[i].values, false),
      a[i].id,
      b[i].id,
      false
    );
  }
  for (let i = n; i < a.length; i++) {
    raw.removed++;
    grouped.removed++;
    result.log.push('removed', a[i].id, -1);
  }
  for (let i = n; i < b.length; i++) {
    raw.added++;
    grouped.added++;
    result.log.push('added', -1, b[i].id);
  }
}

/**
 * Rows matched as whole rows. Raw: equal text. Grouped: the rows left over
 * are matched again on canonical values with A's ids renamed.
 */
function diffMultiset(
  pair: FeedPair,
  table: string,
  cmp: CellComparer,
  result: TableResult
): void {
  const sa = pair.a.store;
  const sb = pair.b.store;
  const { cols, raw, grouped } = result;
  const all = cols.map((_, i) => i);
  const canon = cols.map((c) => canonFor(table, c));
  const h = new Hasher();
  const rawHash = (values: ArrayLike<string>): number =>
    keyHash(h, values, all, null);
  const canonHash = (values: ArrayLike<string>, side: 'a' | 'b'): number => {
    h.reset();
    for (let i = 0; i < cols.length; i++) {
      let v = values[i] ?? '';
      if (side === 'a') {
        v = cmp.mapped(i, v);
      }
      const c = canon[i];
      h.str(c ? c(v) : v);
    }
    return h.value;
  };

  const bHashes: number[] = [];
  const bIds: number[] = [];
  sb.scan(table, cols, (values, id) => {
    bHashes.push(rawHash(values));
    bIds.push(id);
  });
  const index = new HashIndex(bHashes, bIds);
  const leftover: { id: number; values: string[] }[] = [];
  sa.scan(table, cols, (values, id) => {
    let at = index.first(rawHash(values));
    while (at >= 0) {
      if (!index.used[at]) {
        const bValues = rowValues(sb, table, index.ids[at], cols);
        if (sameAt(values, bValues, all)) {
          break;
        }
      }
      at = index.hashes[at + 1] === index.hashes[at] ? at + 1 : -1;
    }
    if (at < 0) {
      raw.removed++;
      leftover.push({ id, values: [...values] });
      return;
    }
    index.used[at] = 1;
    raw.unchanged++;
    grouped.unchanged++;
  });

  const restHashes: number[] = [];
  const restIds: number[] = [];
  const restValues = new Map<number, string[]>();
  for (let i = 0; i < index.ids.length; i++) {
    if (!index.used[i]) {
      raw.added++;
      const values = rowValues(sb, table, index.ids[i], cols);
      restHashes.push(canonHash(values, 'b'));
      restIds.push(index.ids[i]);
      restValues.set(index.ids[i], values);
    }
  }
  const rest = new HashIndex(restHashes, restIds);
  for (const { id, values } of leftover) {
    let at = rest.first(canonHash(values, 'a'));
    while (at >= 0 && rest.used[at]) {
      at = rest.hashes[at + 1] === rest.hashes[at] ? at + 1 : -1;
    }
    if (at < 0) {
      grouped.removed++;
      result.log.push('removed', id, -1);
      continue;
    }
    const bValues = restValues.get(rest.ids[at])!;
    const verdict = cmp.rows(values, bValues, false);
    if (verdict.kind === 'changed' || verdict.kind === 'unchanged') {
      // A canonical-hash collision; the rows are not the same.
      grouped.removed++;
      result.log.push('removed', id, -1);
      continue;
    }
    rest.used[at] = 1;
    // A whole-row match has no key; a pair is "via rename" when a rename
    // was needed to make it.
    const via = verdict.kind === 'followsRename';
    record(
      result,
      via ? { ...verdict, kind: 'renamed' } : verdict,
      id,
      rest.ids[at],
      true
    );
  }
  for (let i = 0; i < rest.ids.length; i++) {
    if (!rest.used[i]) {
      grouped.added++;
      result.log.push('added', -1, rest.ids[i]);
    }
  }
}
