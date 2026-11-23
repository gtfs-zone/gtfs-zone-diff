/**
 * Search groups for `SearchController`, from the worker's search index.
 * One read per session; the groups are kept so the controller's haystack
 * cache hits on every keystroke.
 */

import {
  neutralMarker,
  routeMarker,
  stopMarker,
  type SearchEntry,
  type SearchGroup,
} from 'gtfs-zone-web-common/ui/search-controller';
import type { SearchItem } from '../engine/types';
import { t as tShared } from 'gtfs-zone-web-common/i18n/messages';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import type { DiffSession } from './diff-client';

/** Status word and id(s), as the secondary text. */
function secondary(item: SearchItem): string {
  const id = item.was
    ? t('entity.renamedIds', { a: item.was, b: item.id })
    : item.id;
  return item.status === 'unchanged'
    ? id
    : `${t(`status.${item.status}`)} - ${id}`;
}

function entries(
  items: SearchItem[],
  payload: (id: string) => PageLocation,
  icon: (item: SearchItem) => string,
  priority?: (item: SearchItem) => number
): SearchEntry<PageLocation>[] {
  return items.map((item) => ({
    payload: payload(item.id),
    icon: icon(item),
    primary: item.label,
    secondary: secondary(item),
    haystack: item.haystack,
    priority: priority?.(item),
  }));
}

export class SearchEntries {
  private session: DiffSession | null = null;
  private groups: Promise<SearchGroup<PageLocation>[]> | null = null;

  /** The groups of this session's comparison, read on first ask. */
  get(session: DiffSession | null): Promise<SearchGroup<PageLocation>[]> {
    if (!session) {
      return Promise.resolve([]);
    }
    if (session !== this.session || !this.groups) {
      this.session = session;
      this.groups = session.call('searchIndex').then((index) => {
        const groups: SearchGroup<PageLocation>[] = [
          {
            label: tShared('search.stops'),
            entries: entries(
              index.stops,
              (stop_id) => ({ type: 'stop', stop_id }),
              (i) => stopMarker(i.marker),
              // Stations first.
              (i) => (i.marker === '1' ? 0 : 1)
            ),
          },
          {
            label: tShared('search.routes'),
            entries: entries(
              index.routes,
              (route_id) => ({ type: 'route', route_id }),
              (i) => routeMarker(i.marker)
            ),
          },
          {
            label: t('search.agencies'),
            entries: entries(
              index.agencies,
              (agency_id) => ({ type: 'agency', agency_id }),
              neutralMarker
            ),
          },
        ];
        if (index.trips) {
          groups.push({
            label: t('search.trips'),
            entries: entries(
              index.trips,
              (trip_id) => ({ type: 'trip', trip_id }),
              neutralMarker
            ),
          });
        }
        return groups;
      });
      // A failed read is retried on the next query.
      this.groups.catch(() => {
        if (this.session === session) {
          this.groups = null;
        }
      });
    }
    return this.groups;
  }
}
