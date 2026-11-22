/**
 * Active dates per service_id, from calendar.txt and calendar_dates.txt, as
 * sorted day numbers (days since 1970-01-01).
 */

import type { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const DAY_MS = 86_400_000;
/** A calendar range longer than this is clipped, so a 2099 end date stays cheap. */
const MAX_RANGE_DAYS = 3 * 366;

/** YYYYMMDD to a day number, or null. */
export function dayOf(date: string): number | null {
  if (!/^\d{8}$/.test(date)) {
    return null;
  }
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8))
  );
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
}

export function dateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

export type ServiceDates = Map<string, Int32Array>;

export function serviceDates(store: FeedStore): ServiceDates {
  const sets = new Map<string, Set<number>>();
  const setFor = (id: string): Set<number> => {
    let s = sets.get(id);
    if (!s) {
      sets.set(id, (s = new Set()));
    }
    return s;
  };
  let clipped = 0;
  store.scan(
    'calendar',
    ['service_id', 'start_date', 'end_date', ...WEEKDAYS],
    ([id, start, end, ...days]) => {
      const set = setFor(id);
      const from = dayOf(start);
      let to = dayOf(end);
      if (from === null || to === null) {
        return;
      }
      if (to - from > MAX_RANGE_DAYS) {
        to = from + MAX_RANGE_DAYS;
        clipped++;
      }
      for (let d = from; d <= to; d++) {
        // Day 0 (1970-01-01) was a Thursday.
        if (days[(d + 4) % 7] === '1') {
          set.add(d);
        }
      }
    }
  );
  store.scan(
    'calendar_dates',
    ['service_id', 'date', 'exception_type'],
    ([id, date, type]) => {
      const d = dayOf(date);
      if (d === null) {
        return;
      }
      if (type === '1') {
        setFor(id).add(d);
      } else if (type === '2') {
        setFor(id).delete(d);
      }
    }
  );
  if (clipped > 0) {
    console.warn(
      `[calendars] ${clipped} calendar rows span over ${MAX_RANGE_DAYS} days; clipped`
    );
  }
  const out: ServiceDates = new Map();
  for (const [id, set] of sets) {
    out.set(
      id,
      Int32Array.from(set).sort((x, y) => x - y)
    );
  }
  return out;
}

/** First and last day any service runs, or null. */
export function serviceWindow(
  dates: ServiceDates
): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const days of dates.values()) {
    if (days.length > 0) {
      start = Math.min(start, days[0]);
      end = Math.max(end, days[days.length - 1]);
    }
  }
  return start <= end ? { start, end } : null;
}

/** The days of `days` inside [start, end]. */
export function clip(days: Int32Array, start: number, end: number): Int32Array {
  let i = 0;
  while (i < days.length && days[i] < start) {
    i++;
  }
  let j = i;
  while (j < days.length && days[j] <= end) {
    j++;
  }
  return days.subarray(i, j);
}

/** Days in `x` but not in `y`; both sorted. */
export function minus(x: Int32Array, y: Int32Array): number[] {
  const out: number[] = [];
  let j = 0;
  for (const v of x) {
    while (j < y.length && y[j] < v) {
      j++;
    }
    if (j >= y.length || y[j] !== v) {
      out.push(v);
    }
  }
  return out;
}

/** A hash of a sorted day list, equal for equal lists. */
export function daysHash(days: Int32Array): number {
  let h1 = 0x811c9dc5;
  let h2 = days.length;
  for (const d of days) {
    h1 = Math.imul(h1 ^ d, 16777619);
    h2 = Math.imul(h2 ^ d, 2246822507) + 1;
  }
  return (h2 & 0x1fffff) * 4294967296 + (h1 >>> 0);
}
