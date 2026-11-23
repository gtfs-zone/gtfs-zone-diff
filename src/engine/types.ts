/**
 * The comparison's result, as the diff worker sends it to the page.
 *
 * Counts are complete; long lists (renames, changed rows, per-service dates)
 * stay in the worker and are read a page at a time with `groupItems` and
 * `rowChanges`.
 */

import type { Feature, LineString, Point } from 'geojson';

export type Side = 'a' | 'b';

/** Entities whose ids can be renamed between the two feeds. */
export type EntityKind =
  'agency_id' | 'route_id' | 'stop_id' | 'service_id' | 'shape_id' | 'trip_id';

export const ENTITY_KINDS: readonly EntityKind[] = [
  'agency_id',
  'route_id',
  'stop_id',
  'service_id',
  'shape_id',
  'trip_id',
];

export interface CompareOptions {
  /**
   * Coordinates closer than this many metres count as formatting only.
   * 0 (the default) means equal numbers only.
   */
  coordToleranceM?: number;
}

/** Where one side comes from: a resolved URL (proxy included) or a file. */
export type CompareInput = { url: string } | { file: File };

export type Stage = 'load' | 'files' | 'renames' | 'rows' | 'groups';

export interface CompareProgress {
  stage: Stage;
  side?: Side;
  /** Compressed bytes read and the total when known (load only). */
  bytes?: number;
  total?: number | null;
  /** The table being parsed or compared. */
  table?: string;
}

/**
 * How a file differs. `formatting` means its bytes differ but every row
 * compares equal after normalization; `unknown` that the bytes could not be
 * compared (no zip index) and no row differs.
 */
export type FileStatus =
  'added' | 'removed' | 'identical' | 'formatting' | 'changed' | 'unknown';

/** Raw row counts: keyed on the file's spec key, no renames applied. */
export interface RawCounts {
  added: number;
  removed: number;
  /** Same key on both sides, some cell text differs. */
  changed: number;
  unchanged: number;
}

/**
 * The same rows grouped: renames applied to keys and foreign keys,
 * formatting told apart from content.
 */
export interface GroupedCounts {
  added: number;
  removed: number;
  /** Content differs. */
  changed: number;
  /** Only formatting differs (`8:00:00` vs `08:00:00`, `1.50` vs `1.5`). */
  formatting: number;
  /** Same key; every difference is a renamed id it refers to. */
  followsRename: number;
  /** Key differs only through a rename (a removed and an added row paired). */
  renamed: number;
  unchanged: number;
  /**
   * Pairs made from rows the raw match left unpaired: through a renamed key,
   * or in a keyless file through canonical values. Counted in the kinds above.
   */
  rematched: number;
}

export interface HeaderDiff {
  a: string[];
  b: string[];
  added: string[];
  removed: string[];
  /** Shared columns are in another order. */
  reordered: boolean;
}

export interface FileDiff {
  /** File name with its extension, e.g. `stops.txt`. */
  file: string;
  status: FileStatus;
  /** Zip CRC32 and size: same, different, or unknown (no zip index). */
  bytes: 'same' | 'different' | 'unknown';
  /** Parsed as a CSV table on at least one side. */
  table: boolean;
  header: HeaderDiff | null;
  /** How rows were matched. */
  match: 'keyed' | 'multiset' | 'single' | 'stop_times' | 'shapes' | 'none';
  keyFields: string[];
  /** Rows sharing a key on each side, when keyed matching had to fall back. */
  duplicateKeys: { a: number; b: number };
  raw: RawCounts;
  grouped: GroupedCounts;
  /** Changed (content) cells per column. */
  changedCells: Record<string, number>;
  /** Formatting-only cells per column. */
  formattingCells: Record<string, number>;
  /** Values trimmed at load, per column, on each side. */
  padded: { a: number; b: number };
  /**
   * Records `rowChanges` pages per kind: rows, or trips and shapes for
   * stop_times and shapes.
   */
  records: Partial<Record<RowChangeKind, number>>;
}

export type GroupKind =
  | 'rename'
  | 'renameSuggestion'
  | 'serviceDates'
  | 'serviceWindow'
  | 'timeShift'
  | 'patternChange'
  | 'stopTimesFields'
  | 'stopTimesTimes'
  | 'tripCount'
  | 'stopMoved'
  | 'shapeChanged';

/** One smart group: a label, a count, and the files its rows live in. */
export interface Group {
  id: string;
  kind: GroupKind;
  /** Entity kind for renames; empty otherwise. */
  entity?: EntityKind;
  /** Number of items (renames, services, routes, stops, shapes...). */
  count: number;
  /** Trips (or rows) the items cover, where that differs from `count`. */
  covers?: number;
  files: string[];
}

export type GroupItem =
  | { kind: 'rename'; a: string; b: string }
  | { kind: 'renameSuggestion'; a: string[]; b: string[] }
  | {
      kind: 'serviceDates' | 'serviceWindow';
      a: string | null;
      b: string | null;
      added: string[];
      removed: string[];
      /** Changed dates outside the other feed's service window. */
      outsideWindow: number;
    }
  | {
      kind: 'timeShift';
      route_id: string;
      /** Seconds added to every time of the trip. */
      delta: number;
      trips: number;
      sample: string[];
    }
  | {
      kind: 'patternChange';
      route_id: string;
      addedStops: string[];
      removedStops: string[];
      trips: number;
      sample: string[];
    }
  | {
      kind: 'stopTimesFields';
      route_id: string;
      columns: string[];
      trips: number;
      sample: string[];
    }
  | {
      kind: 'stopTimesTimes';
      route_id: string;
      trips: number;
      sample: string[];
    }
  | {
      kind: 'tripCount';
      route_id: string;
      direction_id: string;
      a: number;
      b: number;
    }
  | { kind: 'stopMoved'; a: string; b: string; metres: number }
  | {
      kind: 'shapeChanged';
      a: string;
      b: string;
      pointsA: number;
      pointsB: number;
      /** Largest distance from a point of one shape to the other line. */
      metres: number;
    };

export type RowChangeKind =
  'added' | 'removed' | 'changed' | 'formatting' | 'followsRename' | 'renamed';

/** One differing row (or trip / shape for stop_times and shapes). */
export interface RowChange {
  kind: RowChangeKind;
  /** The row's key values (B's, or A's when removed), joined; empty when keyless. */
  key: string;
  /** The entity the row belongs to, for its page. */
  owner?: { kind: EntityKind; id: string };
  /** Every column of either side, cell by cell. Empty for stop_times and shapes. */
  fields: FieldDiff[];
  /** For stop_times and shapes: rows of that trip or shape per kind. */
  rows?: Partial<Record<RowChangeKind, number>>;
}

export interface FeedIssue {
  side: Side | 'both';
  file: string;
  code:
    'duplicateKeys' | 'duplicateStopSequence' | 'noZipIndex' | 'parseErrors';
  count: number;
  detail?: string;
}

export interface SideSummary {
  counts: Record<string, number>;
  shapeCount: number;
  /** First and last active service date, YYYYMMDD, or null. */
  window: { start: string; end: string } | null;
  agencies: string[];
  feedInfo: Record<string, string> | null;
  /** Archive entries that are not tables (e.g. `locations.geojson`). */
  otherFiles: string[];
}

export interface Completeness {
  ok: boolean;
  /** One line per file whose grouped counts do not add up to the raw ones. */
  mismatches: string[];
}

export interface DiffResult {
  sides: Record<Side, SideSummary>;
  files: FileDiff[];
  groups: Group[];
  issues: FeedIssue[];
  completeness: Completeness;
  /** Milliseconds per stage. */
  timings: Record<string, number>;
}

/** Pages that show one entity (or the feed_info row) across both feeds. */
export type PageEntity =
  'feed_info' | 'agency' | 'route' | 'trip' | 'stop' | 'service' | 'shape';

export type EntityStatus = RowChangeKind | 'unchanged';

/** One column of a row pair. A value is null where that side has no cell. */
export interface FieldDiff {
  name: string;
  a: string | null;
  b: string | null;
  cell: 'equal' | 'renamed' | 'formatting' | 'changed';
  /** The entity the values name, for linking. */
  ref?: EntityKind;
}

/** One row of a file, on each side, compared cell by cell. */
export interface RecordDiff {
  file: string;
  status: EntityStatus;
  fields: FieldDiff[];
}

/** A link to another entity page, with its status. */
export interface EntityRef {
  type: PageEntity;
  /** The B id, or the A id when it is not in B. */
  id: string;
  label: string;
  status: EntityStatus;
  /** The A id, when it was renamed. */
  was?: string;
}

export type RelatedKey = 'routes' | 'trips' | 'childStops' | 'stopRoutes';

/** Labels and parents of the entities on a page's breadcrumb chain. */
export interface CrumbLabels {
  agency: Record<string, { label: string }>;
  route: Record<string, { label: string; agency_id: string | null }>;
  trip: Record<string, { label: string; route_id: string }>;
  stop: Record<
    string,
    { label: string; location_type?: number; parent_station?: string }
  >;
}

export interface EntityView {
  type: PageEntity;
  /** The id asked for, and the id on each side (through renames). */
  id: string;
  a: string | null;
  b: string | null;
  status: EntityStatus;
  label: string;
  /** The entity's own rows (calendar.txt for a service). */
  records: RecordDiff[];
  related: { key: RelatedKey; items: EntityRef[] }[];
  /** A trip's stop_times, one record per stop_sequence. */
  stopTimes?: RecordDiff[];
  /** A service's active dates. */
  dates?: { a: number; b: number; added: string[]; removed: string[] };
  /** A shape's points, and the largest distance between its two lines. */
  shape?: { pointsA: number; pointsB: number; metres: number | null };
  /** Trips using a service or shape, per side. */
  tripCount?: { a: number; b: number };
  crumbs: CrumbLabels;
}

/** What the map shows: the changes overview (one layer of it), or one page. */
export type MapScope =
  | { type: 'overview'; layer?: 'stops' | 'shapes' | 'moved' }
  | { type: 'stop' | 'trip' | 'route' | 'shape'; id: string };

export type MapStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface MapFeatureProps {
  /** A stop, a shape or stop-list line, or a moved stop's A to B line. */
  kind: 'stop' | 'line' | 'move';
  status: MapStatus;
  /** The feed the geometry comes from; `both` when it is the same in each. */
  side: Side | 'both';
  /** The page a click opens, and its id. */
  page: 'stop' | 'shape' | 'trip';
  id: string;
}

export interface MapGeometry {
  features: Feature<Point | LineString, MapFeatureProps>[];
  /** West, south, east, north, or null when there is nothing to draw. */
  bounds: [number, number, number, number] | null;
}

/** One entity in the search index, matched across both sides. */
export interface SearchItem {
  /** The B id, or the A id when it is not in B. */
  id: string;
  /** The A id, when it was renamed. */
  was?: string;
  label: string;
  status: EntityStatus;
  /** Names, ids and codes of both sides, joined with spaces. */
  haystack: string;
  /** A stop's location_type, or a route's route_color. */
  marker?: string;
}

/** Search entries per entity type. `trips` is null above the trip limit. */
export interface SearchIndex {
  agencies: SearchItem[];
  routes: SearchItem[];
  stops: SearchItem[];
  trips: SearchItem[] | null;
}
