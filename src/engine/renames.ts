/**
 * ID renames: a removed id (only in A) and an added id (only in B) whose
 * entities match on content. One-to-one matches are applied; a signature
 * shared by several ids on either side is a suggestion only.
 *
 * Order matters, since later signatures use earlier renames: agencies,
 * routes (agency), stops, services (active dates inside the common window),
 * shapes (exact coordinates), trips (route, direction, headsign, service
 * dates, shape, stop pattern with renamed stops, times). Services the dates
 * left ambiguous are then settled by the trips that moved between them.
 */

import { clip, daysHash } from './calendars';
import { metres } from './geo';
import { Hasher } from './hash';
import { FeedPair, onlyIn, type RenameMaps, type SideData } from './pair';
import { ENTITY_KINDS, type EntityKind } from './types';

export interface RenameSuggestion {
  a: string[];
  b: string[];
}

export interface Renames {
  maps: RenameMaps;
  suggestions: Record<EntityKind, RenameSuggestion[]>;
}

/** Max metres between a removed and an added stop to pair them. */
const STOP_MATCH_M = 100;
/** Larger signature groups are only suggested, never paired by distance. */
const MAX_DISTANCE_GROUP = 500;

type Sig = string | number;

/** Pair ids by equal signature; ids without one (null) are skipped. */
function matchBySig(
  removed: string[],
  added: string[],
  sigA: (id: string) => Sig | null,
  sigB: (id: string) => Sig | null,
  map: Map<string, string>,
  suggestions: RenameSuggestion[]
): void {
  const groups = new Map<Sig, RenameSuggestion>();
  const groupFor = (sig: Sig): RenameSuggestion => {
    let g = groups.get(sig);
    if (!g) {
      groups.set(sig, (g = { a: [], b: [] }));
    }
    return g;
  };
  for (const id of removed) {
    const sig = sigA(id);
    if (sig !== null) {
      groupFor(sig).a.push(id);
    }
  }
  for (const id of added) {
    const sig = sigB(id);
    if (sig !== null && groups.has(sig)) {
      groups.get(sig)!.b.push(id);
    }
  }
  for (const g of groups.values()) {
    if (g.a.length === 1 && g.b.length === 1) {
      map.set(g.a[0], g.b[0]);
    } else if (g.b.length > 0) {
      suggestions.push(g);
    }
  }
}

/** Removed and added values of one column, as sets of ids. */
function churn(
  pair: FeedPair,
  table: string,
  col: string
): { removed: string[]; added: string[] } {
  const read = (s: SideData): Set<string> => {
    const out = new Set<string>();
    s.store.scan(table, [col], ([v]) => out.add(v));
    return out;
  };
  const a = read(pair.a);
  const b = read(pair.b);
  return { removed: onlyIn(a, b), added: onlyIn(b, a) };
}

/** Rows of a table by the value of `col`, as `cols` values. */
function byId(
  s: SideData,
  table: string,
  col: string,
  cols: string[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  s.store.scan(table, [col, ...cols], ([id, ...rest]) => {
    if (!out.has(id)) {
      out.set(id, [...rest]);
    }
  });
  return out;
}

const mapped = (m: Map<string, string>, v: string): string => m.get(v) ?? v;

export function findRenames(pair: FeedPair): Renames {
  const maps = Object.fromEntries(
    ENTITY_KINDS.map((k) => [k, new Map<string, string>()])
  ) as RenameMaps;
  const suggestions = Object.fromEntries(
    ENTITY_KINDS.map((k) => [k, [] as RenameSuggestion[]])
  ) as Record<EntityKind, RenameSuggestion[]>;

  const simple = (
    kind: EntityKind,
    table: string,
    cols: string[],
    sig: (row: string[], side: 'a' | 'b') => string
  ): void => {
    const { removed, added } = churn(pair, table, kind);
    if (removed.length === 0 || added.length === 0) {
      return;
    }
    const ra = byId(pair.a, table, kind, cols);
    const rb = byId(pair.b, table, kind, cols);
    matchBySig(
      removed,
      added,
      (id) => sig(ra.get(id)!, 'a'),
      (id) => sig(rb.get(id)!, 'b'),
      maps[kind],
      suggestions[kind]
    );
  };

  simple('agency_id', 'agency', ['agency_name', 'agency_timezone'], (r) =>
    r.join('\x1f')
  );
  simple(
    'route_id',
    'routes',
    ['agency_id', 'route_short_name', 'route_long_name', 'route_type'],
    ([agency, ...rest], side) =>
      [side === 'a' ? mapped(maps.agency_id, agency) : agency, ...rest].join(
        '\x1f'
      )
  );
  matchStops(pair, maps.stop_id, suggestions.stop_id);
  matchServices(pair, maps.service_id, suggestions.service_id);
  matchShapes(pair, maps.shape_id, suggestions.shape_id);
  matchTrips(pair, maps, suggestions.trip_id);
  settleServicesByTrips(pair, maps, suggestions);

  for (const kind of ENTITY_KINDS) {
    console.log(
      `[renames] ${kind}: ${maps[kind].size} renamed, ${suggestions[kind].length} suggestions`
    );
  }
  return { maps, suggestions };
}

function matchStops(
  pair: FeedPair,
  map: Map<string, string>,
  suggestions: RenameSuggestion[]
): void {
  const { removed, added } = churn(pair, 'stops', 'stop_id');
  if (removed.length === 0 || added.length === 0) {
    return;
  }
  const cols = ['stop_name', 'location_type', 'stop_lon', 'stop_lat'];
  const ra = byId(pair.a, 'stops', 'stop_id', cols);
  const rb = byId(pair.b, 'stops', 'stop_id', cols);
  const groups = new Map<string, RenameSuggestion>();
  const sig = (r: string[]): string => `${r[0]}\x1f${r[1] || '0'}`;
  for (const id of removed) {
    const key = sig(ra.get(id)!);
    let g = groups.get(key);
    if (!g) {
      groups.set(key, (g = { a: [], b: [] }));
    }
    g.a.push(id);
  }
  for (const id of added) {
    groups.get(sig(rb.get(id)!))?.b.push(id);
  }
  const near = (x: string[], y: string[]): boolean => {
    const d = metres(+x[2], +x[3], +y[2], +y[3]);
    // Stops without coordinates (some stations) pair on name alone.
    return Number.isNaN(d) || d <= STOP_MATCH_M;
  };
  for (const g of groups.values()) {
    if (g.b.length === 0) {
      continue;
    }
    if (g.a.length * g.b.length > MAX_DISTANCE_GROUP * MAX_DISTANCE_GROUP) {
      suggestions.push(g);
      continue;
    }
    const candA = new Map<string, string[]>();
    const candB = new Map<string, string[]>();
    for (const x of g.a) {
      for (const y of g.b) {
        if (near(ra.get(x)!, rb.get(y)!)) {
          (candA.get(x) ?? candA.set(x, []).get(x)!).push(y);
          (candB.get(y) ?? candB.set(y, []).get(y)!).push(x);
        }
      }
    }
    const loose = { a: new Set<string>(), b: new Set<string>() };
    for (const [x, ys] of candA) {
      if (ys.length === 1 && candB.get(ys[0])!.length === 1) {
        map.set(x, ys[0]);
      } else {
        loose.a.add(x);
        ys.forEach((y) => loose.b.add(y));
      }
    }
    if (loose.a.size > 0) {
      suggestions.push({ a: [...loose.a], b: [...loose.b] });
    }
  }
}

/** A service's dates inside the common window, as a signature. */
function serviceSig(pair: FeedPair, s: SideData, id: string): number | null {
  const days = s.dates.get(id);
  if (!days || !pair.common) {
    return null;
  }
  const inside = clip(days, pair.common.start, pair.common.end);
  return inside.length > 0 ? daysHash(inside) : null;
}

function matchServices(
  pair: FeedPair,
  map: Map<string, string>,
  suggestions: RenameSuggestion[]
): void {
  const a = new Set(pair.a.dates.keys());
  const b = new Set(pair.b.dates.keys());
  matchBySig(
    onlyIn(a, b),
    onlyIn(b, a),
    (id) => serviceSig(pair, pair.a, id),
    (id) => serviceSig(pair, pair.b, id),
    map,
    suggestions
  );
}

function shapeSig(s: SideData, id: string): number {
  const coords = s.store.shapeCoords(id);
  const h = new Hasher().num(coords.length);
  const words = new Uint32Array(
    coords.buffer,
    coords.byteOffset,
    coords.length * 2
  );
  for (const w of words) {
    h.num(w);
  }
  return h.value;
}

function matchShapes(
  pair: FeedPair,
  map: Map<string, string>,
  suggestions: RenameSuggestion[]
): void {
  const a = new Set(pair.a.store.shapeIds());
  const b = new Set(pair.b.store.shapeIds());
  matchBySig(
    onlyIn(a, b),
    onlyIn(b, a),
    (id) => shapeSig(pair.a, id),
    (id) => shapeSig(pair.b, id),
    map,
    suggestions
  );
}

const TRIP_COLS = [
  'route_id',
  'direction_id',
  'trip_headsign',
  'service_id',
  'shape_id',
];

/**
 * Hash of each pattern's content with stop_ids renamed, so a trip over a
 * renamed stop still matches. Same layout as `PatternReader.patternKey`.
 */
function patternSigs(s: SideData, stops: Map<string, string> | null): number[] {
  const p = s.patterns!;
  const out: number[] = new Array<number>(p.patternCount);
  for (let k = 0; k < p.patternCount; k++) {
    const h = new Hasher();
    for (const row of p.patternKey(k).split('\x1e')) {
      for (const cell of row.split('\x1f')) {
        h.str(
          stops && cell.startsWith('stop_id=')
            ? `stop_id=${mapped(stops, cell.slice(8))}`
            : cell
        );
      }
      h.str('\x1e');
    }
    out[k] = h.value;
  }
  return out;
}

function matchTrips(
  pair: FeedPair,
  maps: RenameMaps,
  suggestions: RenameSuggestion[]
): void {
  const { removed, added } = churn(pair, 'trips', 'trip_id');
  if (removed.length === 0 || added.length === 0) {
    return;
  }
  const sigFor = (s: SideData, side: 'a' | 'b'): ((id: string) => number) => {
    const rows = byId(s, 'trips', 'trip_id', TRIP_COLS);
    const p = s.patterns;
    const pats = p ? patternSigs(s, side === 'a' ? maps.stop_id : null) : [];
    const timed = p?.hasTimes ?? false;
    const svc = new Map<string, string | number>();
    return (id) => {
      const [route, dir, headsign, service, shape] = rows.get(id)!;
      let serviceKey = svc.get(service);
      if (serviceKey === undefined) {
        const own = side === 'a' ? mapped(maps.service_id, service) : service;
        serviceKey = serviceSig(pair, s, service) ?? own;
        svc.set(service, serviceKey);
      }
      const h = new Hasher()
        .str(side === 'a' ? mapped(maps.route_id, route) : route)
        .str(dir)
        .str(headsign)
        .str(String(serviceKey))
        .str(side === 'a' ? mapped(maps.shape_id, shape) : shape);
      const t = p ? p.tripIndex(id) : -1;
      if (t < 0) {
        return h.str('\x00no-stop-times').value;
      }
      h.num(pats[p!.tripPattern(t)]);
      if (timed) {
        const { arr, dep } = p!.encodedTimes(t);
        for (let k = 0; k < arr.length; k++) {
          h.num(arr[k] >> 1).num(dep[k] >> 1);
        }
      }
      return h.value;
    };
  };
  matchBySig(
    removed,
    added,
    sigFor(pair.a, 'a'),
    sigFor(pair.b, 'b'),
    maps.trip_id,
    suggestions
  );
}

/**
 * Renames the trips imply for services left unmatched: a removed service
 * whose matched trips all run on one added service, which gets trips from
 * no other service.
 */
function settleServicesByTrips(
  pair: FeedPair,
  maps: RenameMaps,
  suggestions: Record<EntityKind, RenameSuggestion[]>
): void {
  const map = maps.service_id;
  const a = new Set(pair.a.dates.keys());
  const b = new Set(pair.b.dates.keys());
  const removed = new Set(onlyIn(a, b).filter((id) => !map.has(id)));
  const taken = new Set(map.values());
  const added = new Set(onlyIn(b, a).filter((id) => !taken.has(id)));
  if (removed.size === 0 || added.size === 0) {
    return;
  }
  const svcA = byId(pair.a, 'trips', 'trip_id', ['service_id']);
  const svcB = byId(pair.b, 'trips', 'trip_id', ['service_id']);
  const targets = new Map<string, Set<string>>();
  const sources = new Map<string, Set<string>>();
  for (const [tripA, [sa]] of svcA) {
    if (!removed.has(sa)) {
      continue;
    }
    const sb = svcB.get(mapped(maps.trip_id, tripA))?.[0];
    if (sb === undefined || !added.has(sb)) {
      continue;
    }
    (targets.get(sa) ?? targets.set(sa, new Set()).get(sa)!).add(sb);
    (sources.get(sb) ?? sources.set(sb, new Set()).get(sb)!).add(sa);
  }
  let settled = 0;
  for (const [sa, sbs] of targets) {
    const [sb] = sbs;
    if (sbs.size === 1 && sources.get(sb)!.size === 1) {
      map.set(sa, sb);
      settled++;
    }
  }
  // Drop suggestions a settled rename now covers.
  const doneA = new Set(map.keys());
  const doneB = new Set(map.values());
  suggestions.service_id = suggestions.service_id
    .map((g) => ({
      a: g.a.filter((id) => !doneA.has(id)),
      b: g.b.filter((id) => !doneB.has(id)),
    }))
    .filter((g) => g.a.length > 0 && g.b.length > 0);
  console.log(`[renames] service_id: ${settled} settled by trips`);
}
