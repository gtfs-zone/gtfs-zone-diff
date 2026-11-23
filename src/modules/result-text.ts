/** Words for the comparison's result: file titles, counts, group labels. */

import { formatNumber } from 'gtfs-zone-web-common/i18n/fmt';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';
import type {
  EntityKind,
  FeedIssue,
  FileDiff,
  FileStatus,
  Group,
  GroupKind,
} from '../engine/types';
import type { PageLocation } from '../types/page-state';
import type { Source, Sources } from './sources';

type Key = Parameters<typeof t>[0];

export const fmt = (n: number): string => formatNumber(n);

/** GTFS files by name, to the key of their title. */
const FILE_TITLES: Record<string, Key> = {
  'agency.txt': 'file.agency',
  'stops.txt': 'file.stops',
  'routes.txt': 'file.routes',
  'trips.txt': 'file.trips',
  'stop_times.txt': 'file.stop_times',
  'calendar.txt': 'file.calendar',
  'calendar_dates.txt': 'file.calendar_dates',
  'fare_attributes.txt': 'file.fare_attributes',
  'fare_rules.txt': 'file.fare_rules',
  'timeframes.txt': 'file.timeframes',
  'rider_categories.txt': 'file.rider_categories',
  'fare_media.txt': 'file.fare_media',
  'fare_products.txt': 'file.fare_products',
  'fare_leg_rules.txt': 'file.fare_leg_rules',
  'fare_leg_join_rules.txt': 'file.fare_leg_join_rules',
  'fare_transfer_rules.txt': 'file.fare_transfer_rules',
  'areas.txt': 'file.areas',
  'stop_areas.txt': 'file.stop_areas',
  'networks.txt': 'file.networks',
  'route_networks.txt': 'file.route_networks',
  'shapes.txt': 'file.shapes',
  'frequencies.txt': 'file.frequencies',
  'transfers.txt': 'file.transfers',
  'pathways.txt': 'file.pathways',
  'levels.txt': 'file.levels',
  'location_groups.txt': 'file.location_groups',
  'location_group_stops.txt': 'file.location_group_stops',
  'locations.geojson': 'file.locations',
  'booking_rules.txt': 'file.booking_rules',
  'translations.txt': 'file.translations',
  'feed_info.txt': 'file.feed_info',
  'attributions.txt': 'file.attributions',
};

/** A file's title, or its name for a file the spec does not list. */
export function fileTitle(file: string): string {
  const key = FILE_TITLES[file];
  return key ? t(key) : file;
}

const STATUS_BADGE: Record<FileStatus, string> = {
  added: 'badge-success',
  removed: 'badge-error',
  changed: 'badge-warning',
  formatting: 'badge-info',
  identical: 'badge-ghost',
  unknown: 'badge-ghost',
};

export function statusBadge(status: FileStatus): string {
  return `<span class="badge badge-sm ${STATUS_BADGE[status]}">${escapeHtml(
    t(`results.status.${status}`)
  )}</span>`;
}

/** The grouped counts of a file, as one line. */
export function fileCounts(f: FileDiff): string {
  const g = f.grouped;
  const parts: string[] = [];
  const push = (key: Key, count: number): void => {
    if (count > 0) {
      parts.push(t(key, { count: count }));
    }
  };
  push('results.added', g.added);
  push('results.removed', g.removed);
  push('results.changed', g.changed);
  push('results.renamed', g.renamed);
  push('results.followsRename', g.followsRename);
  push('results.formatting', g.formatting);
  return parts.join(', ');
}

/** Column changes of a file, as one line, or empty. */
export function headerLine(f: FileDiff): string {
  const h = f.header;
  if (!h) {
    return '';
  }
  const changes: string[] = [];
  if (h.added.length > 0) {
    changes.push(t('results.headerAdded', { cols: h.added.join(', ') }));
  }
  if (h.removed.length > 0) {
    changes.push(t('results.headerRemoved', { cols: h.removed.join(', ') }));
  }
  if (h.reordered) {
    changes.push(t('results.headerReordered'));
  }
  return changes.length > 0
    ? t('results.header', { changes: changes.join('; ') })
    : '';
}

export function issueText(i: FeedIssue): string {
  return t(`results.issue.${i.code}`, {
    side: i.side.toUpperCase(),
    count: i.count,
    file: i.file,
    detail: i.detail ?? '',
  });
}

const ENTITY_WORD: Record<EntityKind, Key> = {
  agency_id: 'entity.agency',
  route_id: 'entity.route',
  stop_id: 'entity.stop',
  service_id: 'entity.service',
  shape_id: 'entity.shape',
  trip_id: 'entity.trip',
};

export function groupLabel(g: Group): string {
  return t(`results.group.${g.kind}`, {
    entity: g.entity ? t(ENTITY_WORD[g.entity]) : '',
  });
}

/** What one item of a group is. */
const GROUP_UNIT: Record<GroupKind, Key> = {
  rename: 'unit.ids',
  renameSuggestion: 'unit.ids',
  serviceDates: 'unit.services',
  serviceWindow: 'unit.services',
  timeShift: 'unit.routes',
  patternChange: 'unit.routes',
  stopTimesFields: 'unit.routes',
  stopTimesTimes: 'unit.routes',
  tripCount: 'unit.routes',
  stopMoved: 'unit.stops',
  shapeChanged: 'unit.shapes',
};

/** A group's count, and the trips it covers, as one line. */
export function groupCount(g: Group): string {
  const items = t(GROUP_UNIT[g.kind], { count: g.count });
  return g.covers === undefined
    ? items
    : `${items}, ${t('unit.trips', { count: g.covers })}`;
}

/** "A vs B", or the generic name until both sides are set. */
export function comparisonLabel(sources: Sources): string {
  const name = (src: Source | null): string | null =>
    !src ? null : src.kind === 'missing' ? src.feedId : src.label;
  const a = name(sources.a);
  const b = name(sources.b);
  return a && b ? t('home.versus', { a, b }) : t('home.newComparison');
}

/** The page an entity id of a kind opens. */
export function entityPage(kind: EntityKind, id: string): PageLocation {
  switch (kind) {
    case 'agency_id':
      return { type: 'agency', agency_id: id };
    case 'route_id':
      return { type: 'route', route_id: id };
    case 'stop_id':
      return { type: 'stop', stop_id: id };
    case 'service_id':
      return { type: 'service', service_id: id };
    case 'shape_id':
      return { type: 'shape', shape_id: id };
    case 'trip_id':
      return { type: 'trip', trip_id: id };
  }
}

/** A time difference in seconds as "+2 min", "-1 min 30 s". */
export function formatShift(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const min = Math.floor(abs / 60);
  const sec = abs % 60;
  if (min === 0) {
    return `${sign}${sec} s`;
  }
  return sec === 0 ? `${sign}${min} min` : `${sign}${min} min ${sec} s`;
}
