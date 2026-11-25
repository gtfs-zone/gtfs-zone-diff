/**
 * Stops merged into one or split into several, read from paired trips.
 *
 * Only removed A stops and added B stops take part. Each slot of a paired
 * trip where removed stop `x` gave way to added stop `y` is a vote `x -> y`
 * (see `stopVotes` in stop-times). A merge is 2+ A stops whose votes go to
 * one B stop; a split is one A stop whose votes go to 2+ B stops. Every stop
 * in it is within `MERGE_RADIUS_M` of the other side's stop. The groups only
 * explain rows: stop_times keeps its real added and removed rows.
 */

import type { Row } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import { metres } from './geo';
import type { FeedPair, SideData } from './pair';
import type { TableResult } from './rows';
import type { GroupItem } from './types';

/** Farthest an A stop and its B stop can be apart. */
export const MERGE_RADIUS_M = 150;
/** Vote share for a merge or split; below it down to `WEAK_SHARE`, a suggestion. */
const STRONG_SHARE = 0.8;
const WEAK_SHARE = 0.5;

type Merged = Extract<GroupItem, { kind: 'stopMerged' }>;
type Split = Extract<GroupItem, { kind: 'stopSplit' }>;

export interface StopMerges {
  merged: Merged[];
  split: Split[];
  suggestions: (Merged | Split)[];
}

/** One side's stop -> votes per stop on the other side, and their total. */
interface Tally {
  votes: Map<string, number>;
  total: number;
}

/** A stop's link to its strongest partner. */
interface Link {
  from: string;
  to: string;
  share: number;
  metres: number;
}

function position(r: Row | undefined): [number, number] | null {
  if (!r || r.stop_lon === '' || r.stop_lat === '') {
    return null;
  }
  const lon = Number(r.stop_lon);
  const lat = Number(r.stop_lat);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function stopRow(s: SideData, id: string): Row | undefined {
  return s.store.find('stops', 'stop_id', id)[0]?.row;
}

function tally(map: Map<string, Tally>, from: string, to: string, n: number) {
  let t = map.get(from);
  if (!t) {
    map.set(from, (t = { votes: new Map(), total: 0 }));
  }
  t.votes.set(to, (t.votes.get(to) ?? 0) + n);
  t.total += n;
}

/** Each stop's strongest partner, grouped by that partner. */
function strongest(
  map: Map<string, Tally>,
  apart: (from: string, to: string) => number | null
): Map<string, Link[]> {
  const out = new Map<string, Link[]>();
  for (const [from, t] of map) {
    let to = '';
    let best = 0;
    for (const [y, n] of t.votes) {
      if (n > best) {
        best = n;
        to = y;
      }
    }
    const share = best / t.total;
    const m = apart(from, to);
    if (share < WEAK_SHARE || m === null || m > MERGE_RADIUS_M) {
      continue;
    }
    const link = { from, to, share, metres: Math.round(m * 10) / 10 };
    const list = out.get(to);
    if (list) {
      list.push(link);
    } else {
      out.set(to, [link]);
    }
  }
  return out;
}

export function findStopMerges(
  pair: FeedPair,
  stops: TableResult | null,
  stopVotes: Map<string, number[]> | null
): StopMerges {
  const out: StopMerges = { merged: [], split: [], suggestions: [] };
  if (!stops || !stopVotes || stopVotes.size === 0) {
    return out;
  }
  const { a, b } = pair;
  const removed = new Set<string>();
  const added = new Set<string>();
  const { log } = stops;
  for (let i = 0; i < log.size; i++) {
    if (log.kinds[i] === 'removed') {
      const id = a.store.row('stops', log.a[i])?.stop_id;
      if (id) {
        removed.add(id);
      }
    } else if (log.kinds[i] === 'added') {
      const id = b.store.row('stops', log.b[i])?.stop_id;
      if (id) {
        added.add(id);
      }
    }
  }

  const outA = new Map<string, Tally>();
  const inB = new Map<string, Tally>();
  const tripsOf = new Map<string, number[]>();
  for (const [key, trips] of stopVotes) {
    const [x, y] = key.split('\x1f');
    if (!removed.has(x) || !added.has(y)) {
      continue;
    }
    tally(outA, x, y, trips.length);
    tally(inB, y, x, trips.length);
    tripsOf.set(key, trips);
  }
  if (outA.size === 0) {
    return out;
  }

  const posA = new Map<string, [number, number] | null>();
  const posB = new Map<string, [number, number] | null>();
  const at = (
    cache: Map<string, [number, number] | null>,
    s: SideData,
    id: string
  ): [number, number] | null => {
    let p = cache.get(id);
    if (p === undefined) {
      cache.set(id, (p = position(stopRow(s, id))));
    }
    return p;
  };
  const apart = (x: string, y: string): number | null => {
    const p = at(posA, a, x);
    const q = at(posB, b, y);
    return p && q ? metres(p[0], p[1], q[0], q[1]) : null;
  };
  /** Distinct trips behind a set of `x -> y` votes. */
  const tripCount = (pairs: [string, string][]): number => {
    const seen = new Set<number>();
    for (const [x, y] of pairs) {
      for (const u of tripsOf.get(`${x}\x1f${y}`) ?? []) {
        seen.add(u);
      }
    }
    return seen.size;
  };

  // Merges: A stops whose votes mostly go to one B stop.
  const inMerge = new Set<string>();
  for (const [y, links] of strongest(outA, apart)) {
    if (links.length < 2) {
      continue;
    }
    links.sort((p, q) => p.from.localeCompare(q.from));
    const share = Math.min(...links.map((l) => l.share));
    const item: Merged = {
      kind: 'stopMerged',
      a: links.map((l) => l.from),
      metres: links.map((l) => l.metres),
      b: y,
      trips: tripCount(links.map((l) => [l.from, y])),
      share: Math.round(share * 100) / 100,
    };
    if (share >= STRONG_SHARE) {
      out.merged.push(item);
      for (const l of links) {
        inMerge.add(l.from);
      }
    } else {
      out.suggestions.push(item);
    }
  }

  // Splits: B stops whose votes mostly come from one A stop.
  const apartB = (y: string, x: string): number | null => apart(x, y);
  for (const [x, links] of strongest(inB, apartB)) {
    if (links.length < 2 || inMerge.has(x)) {
      continue;
    }
    links.sort((p, q) => p.from.localeCompare(q.from));
    const share = Math.min(...links.map((l) => l.share));
    const ids = links.map((l) => l.from);
    const parents = new Set(
      ids.map((y) => stopRow(b, y)?.parent_station ?? '')
    );
    const station = parents.size === 1 ? [...parents][0] || null : null;
    const item: Split = {
      kind: 'stopSplit',
      a: x,
      b: ids,
      metres: links.map((l) => l.metres),
      trips: tripCount(ids.map((y) => [x, y])),
      share: Math.round(share * 100) / 100,
      station,
    };
    (share >= STRONG_SHARE ? out.split : out.suggestions).push(item);
  }

  const byTrips = (p: { trips: number }, q: { trips: number }): number =>
    q.trips - p.trips;
  out.merged.sort(byTrips);
  out.split.sort(byTrips);
  out.suggestions.sort(byTrips);
  return out;
}
