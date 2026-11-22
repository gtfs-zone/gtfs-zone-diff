/**
 * Which cell differences are formatting only, per column type from the spec.
 *
 * Numbers compare as numbers (`1.50` = `1.5`, `01` = `1`), times as seconds
 * (`8:00:00` = `08:00:00`), colors case-insensitively. Ids and text never
 * normalize: `007` and `7` are different stop_ids.
 */

import { gtfsSpec } from 'gtfs-zone-web-common/gtfs/spec/gtfs-spec';
import {
  GTFSFieldType,
  mapGTFSTypeString,
} from 'gtfs-zone-web-common/gtfs/spec/field-types';

/** True when `a` and `b` (already unequal) are the same value. */
export type SameValue = (a: string, b: string) => boolean;

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const TIME_RE = /^(\d+):(\d\d):(\d\d)$/;
const EARTH_M_PER_DEG = 111_320;

const sameNumber: SameValue = (a, b) =>
  NUMBER_RE.test(a) && NUMBER_RE.test(b) && Number(a) === Number(b);

function seconds(v: string): number | null {
  const m = TIME_RE.exec(v);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const sameTime: SameValue = (a, b) => {
  const x = seconds(a);
  return x !== null && x === seconds(b);
};

const sameColor: SameValue = (a, b) => a.toLowerCase() === b.toLowerCase();

const NUMERIC_TYPES = new Set([
  GTFSFieldType.Integer,
  GTFSFieldType.NonNegativeInteger,
  GTFSFieldType.NonZeroInteger,
  GTFSFieldType.PositiveInteger,
  GTFSFieldType.Float,
  GTFSFieldType.NonNegativeFloat,
  GTFSFieldType.PositiveFloat,
  GTFSFieldType.CurrencyAmount,
  GTFSFieldType.Enum,
]);

/** Spec type of every `file.field`, file without its extension. */
const FIELD_TYPES = new Map<string, GTFSFieldType>();
for (const file of gtfsSpec.files) {
  const table = file.filename.replace(/\.(txt|geojson)$/, '');
  for (const field of file.fields ?? []) {
    FIELD_TYPES.set(`${table}.${field.name}`, mapGTFSTypeString(field.type));
  }
}

export function fieldType(table: string, col: string): GTFSFieldType | null {
  return FIELD_TYPES.get(`${table}.${col}`) ?? null;
}

/**
 * The formatting test for a column, or null when any difference is real.
 * `toleranceM` widens latitude and longitude to that many metres.
 */
export function sameValueFor(
  table: string,
  col: string,
  toleranceM: number
): SameValue | null {
  const type = fieldType(table, col);
  if (type === GTFSFieldType.Latitude || type === GTFSFieldType.Longitude) {
    if (toleranceM <= 0) {
      return sameNumber;
    }
    // Longitude degrees shrink with latitude; this bound is loose near the
    // poles, which no transit feed reaches.
    const deg = toleranceM / EARTH_M_PER_DEG;
    return (a, b) =>
      NUMBER_RE.test(a) &&
      NUMBER_RE.test(b) &&
      Math.abs(Number(a) - Number(b)) <= deg;
  }
  if (type === GTFSFieldType.Time) {
    return sameTime;
  }
  if (type === GTFSFieldType.Color) {
    return sameColor;
  }
  if (type !== null && NUMERIC_TYPES.has(type)) {
    return sameNumber;
  }
  return null;
}

/**
 * A canonical form of a column's values, so formatting-only variants hash
 * alike: numbers as `Number` text, times as seconds, colors lower case.
 * Null when values are compared verbatim.
 */
export function canonFor(
  table: string,
  col: string
): ((v: string) => string) | null {
  const type = fieldType(table, col);
  if (type === GTFSFieldType.Time) {
    return (v) => {
      const s = seconds(v);
      return s === null ? v : String(s);
    };
  }
  if (type === GTFSFieldType.Color) {
    return (v) => v.toLowerCase();
  }
  if (
    type === GTFSFieldType.Latitude ||
    type === GTFSFieldType.Longitude ||
    (type !== null && NUMERIC_TYPES.has(type))
  ) {
    return (v) => (NUMBER_RE.test(v) ? String(Number(v)) : v);
  }
  return null;
}
