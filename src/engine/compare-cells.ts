/**
 * Classifies one A row against one B row, cell by cell: equal, a renamed id,
 * formatting only, or a content change.
 */

import { gtfsSpec } from 'gtfs-zone-web-common/gtfs/spec/gtfs-spec';
import { sameValueFor, type SameValue } from './normalize';
import type { RenameMaps } from './pair';
import { ENTITY_KINDS, type EntityKind, type RowChangeKind } from './types';

const KINDS = new Set<string>(ENTITY_KINDS);

/** `table.col` -> the entity its values name, from the spec's foreign keys. */
const REFERENCES = new Map<string, EntityKind>();
for (const file of gtfsSpec.files) {
  const table = file.filename.replace(/\.(txt|geojson)$/, '');
  for (const field of file.fields ?? []) {
    const target = field.foreignKey?.find((t) => KINDS.has(t.field));
    if (target) {
      REFERENCES.set(`${table}.${field.name}`, target.field as EntityKind);
    }
  }
}

/** The entity a column names: its own id column or a foreign key. */
export function entityOf(table: string, col: string): EntityKind | null {
  return (
    REFERENCES.get(`${table}.${col}`) ??
    (KINDS.has(col) ? (col as EntityKind) : null)
  );
}

export type CellKind = 'equal' | 'renamed' | 'formatting' | 'changed';

export interface RowVerdict {
  kind: RowChangeKind | 'unchanged';
  /** Columns with content changes, and with formatting-only ones. */
  changed: string[];
  formatting: string[];
}

export class CellComparer {
  private renames: (Map<string, string> | null)[];
  private same: (SameValue | null)[];

  constructor(
    readonly table: string,
    readonly cols: string[],
    maps: RenameMaps,
    toleranceM: number
  ) {
    this.renames = cols.map((c) => {
      const kind = entityOf(table, c);
      return kind && maps[kind].size > 0 ? maps[kind] : null;
    });
    this.same = cols.map((c) => sameValueFor(table, c, toleranceM));
  }

  /** The value an A cell takes once renames are applied. */
  mapped(i: number, v: string): string {
    return this.renames[i]?.get(v) ?? v;
  }

  /** True when column `i` can be renamed at all. */
  renamable(i: number): boolean {
    return this.renames[i] !== null;
  }

  cell(i: number, a: string, b: string): CellKind {
    if (a === b) {
      return 'equal';
    }
    if (this.renames[i]?.get(a) === b) {
      return 'renamed';
    }
    const same = this.same[i];
    return same && same(a, b) ? 'formatting' : 'changed';
  }

  /**
   * Compare rows given as values in `cols` order. `keyDiffers` says the pair
   * was matched through a rename of its key, not on the raw key.
   */
  rows(
    a: ArrayLike<string>,
    b: ArrayLike<string>,
    keyDiffers: boolean
  ): RowVerdict {
    const changed: string[] = [];
    const formatting: string[] = [];
    let renamed = false;
    for (let i = 0; i < this.cols.length; i++) {
      switch (this.cell(i, a[i], b[i])) {
        case 'equal':
          break;
        case 'renamed':
          renamed = true;
          break;
        case 'formatting':
          formatting.push(this.cols[i]);
          break;
        case 'changed':
          changed.push(this.cols[i]);
          break;
      }
    }
    let kind: RowVerdict['kind'];
    if (changed.length > 0) {
      kind = 'changed';
    } else if (keyDiffers) {
      kind = 'renamed';
    } else if (renamed) {
      kind = 'followsRename';
    } else if (formatting.length > 0) {
      kind = 'formatting';
    } else {
      kind = 'unchanged';
    }
    return { kind, changed, formatting };
  }
}
