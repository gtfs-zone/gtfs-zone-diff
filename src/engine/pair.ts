/** Both loaded feeds and what every comparison stage reads from them. */

import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { PatternReader } from 'gtfs-zone-web-common/gtfs/store/pattern-reader';
import type { StreamResult } from 'gtfs-zone-web-common/gtfs/store/csv-stream';
import type { ZipEntryInfo } from 'gtfs-zone-web-common/util/zip-index';
import { serviceDates, serviceWindow, type ServiceDates } from './calendars';
import type { CompareOptions, EntityKind, Side } from './types';

export interface LoadedSide {
  store: FeedStore;
  stream: StreamResult;
  /** Zip entries by name, or null when the central directory was not read. */
  zip: Map<string, ZipEntryInfo> | null;
}

export interface SideData extends LoadedSide {
  dates: ServiceDates;
  window: { start: number; end: number } | null;
  patterns: PatternReader | null;
}

/** Renamed ids per entity kind, A id -> B id. */
export type RenameMaps = Record<EntityKind, Map<string, string>>;

export class FeedPair {
  readonly a: SideData;
  readonly b: SideData;
  /** Days both feeds cover, or null when their windows do not overlap. */
  readonly common: { start: number; end: number } | null;
  readonly options: Required<CompareOptions>;

  constructor(a: LoadedSide, b: LoadedSide, options: CompareOptions) {
    this.a = withDates(a);
    this.b = withDates(b);
    const wa = this.a.window;
    const wb = this.b.window;
    const start = wa && wb ? Math.max(wa.start, wb.start) : 0;
    const end = wa && wb ? Math.min(wa.end, wb.end) : -1;
    this.common = start <= end ? { start, end } : null;
    this.options = { coordToleranceM: options.coordToleranceM ?? 0 };
  }

  side(s: Side): SideData {
    return s === 'a' ? this.a : this.b;
  }
}

function withDates(s: LoadedSide): SideData {
  const dates = serviceDates(s.store);
  return {
    ...s,
    dates,
    window: serviceWindow(dates),
    patterns: s.store.patternReader(),
  };
}

/** Ids in `a` but not in `b`. */
export function onlyIn(a: Iterable<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const v of a) {
    if (!b.has(v)) {
      out.push(v);
    }
  }
  return out;
}
