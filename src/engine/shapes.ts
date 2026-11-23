/**
 * shapes diff per shape: shapes pair by shape_id, then by rename, and points
 * pair by shape_pt_sequence. A shape whose geometry changed is summed up as
 * its point counts and the largest distance between the two lines, instead
 * of thousands of point rows.
 */

import { CellComparer } from './compare-cells';
import { lineDistance } from './geo';
import { pairBySequence, type FeedPair, type RenameMaps } from './pair';
import { emptyGrouped, emptyRaw } from './rows';
import type {
  GroupItem,
  GroupedCounts,
  RawCounts,
  RowChangeKind,
} from './types';

export interface ShapeChange {
  kind: RowChangeKind;
  a: string | null;
  b: string | null;
  rows: Partial<Record<RowChangeKind, number>>;
}

export interface ShapesResult {
  cols: string[];
  raw: RawCounts;
  grouped: GroupedCounts;
  changedCells: Record<string, number>;
  formattingCells: Record<string, number>;
  shapes: ShapeChange[];
  changedShapes: Extract<GroupItem, { kind: 'shapeChanged' }>[];
}

function sameCoords(x: Float64Array, y: Float64Array): boolean {
  if (x.length !== y.length) {
    return false;
  }
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) {
      return false;
    }
  }
  return true;
}

export function diffShapes(
  pair: FeedPair,
  maps: RenameMaps
): ShapesResult | null {
  const sa = pair.a.store;
  const sb = pair.b.store;
  const colsA = sa.hasTable('shapes') ? sa.columns('shapes') : [];
  const colsB = sb.hasTable('shapes') ? sb.columns('shapes') : [];
  if (colsA.length === 0 && colsB.length === 0) {
    return null;
  }
  const cols = [...colsA, ...colsB.filter((c) => !colsA.includes(c))];
  const seqAt = cols.indexOf('shape_pt_sequence');
  const result: ShapesResult = {
    cols,
    raw: emptyRaw(),
    grouped: emptyGrouped(),
    changedCells: {},
    formattingCells: {},
    shapes: [],
    changedShapes: [],
  };
  const { raw, grouped } = result;
  const cmp = new CellComparer(
    'shapes',
    cols,
    maps,
    pair.options.coordToleranceM
  );
  const values = (rows: Record<string, string>[]): string[][] =>
    rows.map((r) => cols.map((c) => r[c] ?? ''));

  const idsB = new Set(sb.shapeIds());
  const pairedB = new Set<string>();
  for (const a of sa.shapeIds()) {
    let b: string | null = idsB.has(a) ? a : null;
    const renamed =
      b === null && maps.shape_id.has(a) && idsB.has(maps.shape_id.get(a)!);
    if (renamed) {
      b = maps.shape_id.get(a)!;
    }
    const rowsA = values(sa.shapeRows(a));
    if (b === null) {
      raw.removed += rowsA.length;
      grouped.removed += rowsA.length;
      result.shapes.push({
        kind: 'removed',
        a,
        b: null,
        rows: { removed: rowsA.length },
      });
      continue;
    }
    pairedB.add(b);
    const rowsB = values(sb.shapeRows(b));
    const counts: Partial<Record<RowChangeKind, number>> = {};
    const add = (k: RowChangeKind): void => {
      counts[k] = (counts[k] ?? 0) + 1;
    };
    const { partner, usedB } = pairBySequence(rowsA, rowsB, seqAt);
    rowsA.forEach((row, i) => {
      const k = partner[i];
      if (k < 0) {
        if (!renamed) {
          raw.removed++;
        }
        grouped.removed++;
        add('removed');
        return;
      }
      const other = rowsB[k];
      if (renamed) {
        grouped.rematched++;
      } else if (row.every((v, c) => v === other[c])) {
        raw.unchanged++;
      } else {
        raw.changed++;
      }
      const verdict = cmp.rows(row, other, renamed);
      for (const c of verdict.changed) {
        result.changedCells[c] = (result.changedCells[c] ?? 0) + 1;
      }
      if (verdict.kind === 'unchanged') {
        grouped.unchanged++;
        return;
      }
      for (const c of verdict.formatting) {
        result.formattingCells[c] = (result.formattingCells[c] ?? 0) + 1;
      }
      grouped[verdict.kind]++;
      add(verdict.kind);
    });
    for (let k = 0; k < rowsB.length; k++) {
      if (!usedB[k]) {
        if (!renamed) {
          raw.added++;
        }
        grouped.added++;
        add('added');
      }
    }
    if (renamed) {
      raw.removed += rowsA.length;
      raw.added += rowsB.length;
    }
    const kinds = Object.keys(counts) as RowChangeKind[];
    if (kinds.length === 0) {
      continue;
    }
    const kind =
      // Paired on both sides: rows added or removed change it.
      counts.changed || counts.added || counts.removed
        ? 'changed'
        : (['renamed', 'followsRename', 'formatting'] as const).find(
            (k) => counts[k]
          )!;
    result.shapes.push({ kind, a, b, rows: counts });
    const ca = sa.shapeCoords(a);
    const cb = sb.shapeCoords(b);
    if (!sameCoords(ca, cb)) {
      result.changedShapes.push({
        kind: 'shapeChanged',
        a,
        b,
        pointsA: ca.length / 2,
        pointsB: cb.length / 2,
        metres: Math.round(lineDistance(ca, cb) * 10) / 10,
      });
    }
  }
  for (const b of idsB) {
    if (!pairedB.has(b)) {
      const n = sb.shapeRows(b).length;
      raw.added += n;
      grouped.added += n;
      result.shapes.push({ kind: 'added', a: null, b, rows: { added: n } });
    }
  }
  result.changedShapes.sort((x, y) => y.metres - x.metres);
  return result;
}
