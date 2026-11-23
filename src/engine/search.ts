/**
 * The search index: agencies, routes, stops and (up to a limit) trips of
 * both sides, matched through renames, each with its status. Built once per
 * comparison; the main thread does the fuzzy matching.
 */

import type { Row } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import type { EntityReader, Ids } from './entities';
import type { FeedPair, SideData } from './pair';
import type {
  EntityKind,
  EntityStatus,
  SearchIndex,
  SearchItem,
} from './types';

/** Above this many trips (both sides together), trips are left out. */
const TRIP_LIMIT = 50_000;

/** Non-empty values, each once. */
function haystack(...parts: (string | undefined)[]): string {
  return [...new Set(parts.filter(Boolean))].join(' ');
}

function rowsById(s: SideData, table: string, col: string): Map<string, Row> {
  const out = new Map<string, Row>();
  if (s.store.hasTable(table)) {
    for (const { row } of s.store.rows(table)) {
      out.set(row[col], row);
    }
  }
  return out;
}

export class SearchReader {
  private index: SearchIndex | null = null;

  constructor(
    private pair: FeedPair,
    private reader: EntityReader
  ) {}

  read(): SearchIndex {
    if (!this.index) {
      const t0 = performance.now();
      this.index = {
        agencies: this.items('agency', 'agency_id', (r) => ({
          label: r.agency_name,
          words: [r.agency_name],
        })),
        routes: this.items('routes', 'route_id', (r) => ({
          label: r.route_short_name || r.route_long_name,
          words: [r.route_short_name, r.route_long_name, r.route_desc],
          marker: r.route_color,
        })),
        stops: this.items('stops', 'stop_id', (r) => ({
          label: r.stop_name,
          words: [r.stop_name, r.stop_code, r.stop_desc],
          marker: r.location_type || '0',
        })),
        trips: this.trips(),
      };
      console.log(
        `[SearchReader] index built in ${Math.round(performance.now() - t0)} ms`
      );
    }
    return this.index;
  }

  private items(
    table: string,
    kind: EntityKind,
    describe: (r: Row) => { label?: string; words: string[]; marker?: string },
    status?: (ids: Ids, ra: Row | null, rb: Row | null) => EntityStatus
  ): SearchItem[] {
    const a = rowsById(this.pair.a, table, kind);
    const b = rowsById(this.pair.b, table, kind);
    const out: SearchItem[] = [];
    for (const ids of this.reader.union(kind, a.keys(), b.keys())) {
      const ra = ids.a === null ? null : (a.get(ids.a) ?? null);
      const rb = ids.b === null ? null : (b.get(ids.b) ?? null);
      const db = rb ? describe(rb) : null;
      const da = ra ? describe(ra) : null;
      const id = ids.b ?? ids.a ?? '';
      const item: SearchItem = {
        id,
        label: db?.label || da?.label || id,
        status: status
          ? status(ids, ra, rb)
          : this.reader.pairRecord(table, ra, rb, ids.a !== ids.b).status,
        haystack: haystack(
          ...(db?.words ?? []),
          ...(da?.words ?? []),
          ids.b ?? undefined,
          ids.a ?? undefined
        ),
      };
      const marker = db?.marker ?? da?.marker;
      if (marker) {
        item.marker = marker;
      }
      if (ids.a !== null && ids.b !== null && ids.a !== ids.b) {
        item.was = ids.a;
      }
      out.push(item);
    }
    return out;
  }

  private trips(): SearchItem[] | null {
    const count = (s: SideData): number => s.store.counts()['trips'] ?? 0;
    if (count(this.pair.a) + count(this.pair.b) > TRIP_LIMIT) {
      return null;
    }
    return this.items(
      'trips',
      'trip_id',
      (r) => ({
        label: r.trip_short_name || r.trip_headsign,
        words: [r.trip_short_name, r.trip_headsign],
      }),
      (ids) => this.reader.tripStatus(ids)
    );
  }
}
