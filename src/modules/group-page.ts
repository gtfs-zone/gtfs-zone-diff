/** One smart group: its items, read from the worker a page at a time. */

import {
  entityRow,
  type EntityRow,
} from 'gtfs-zone-web-common/gtfs/entity-row';
import {
  listSection,
  type TreePage,
} from 'gtfs-zone-web-common/gtfs/tree-page';
import type { Group, GroupItem } from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import { doneResult, waitingPage, type PageContext } from './page-context';
import {
  entityPage,
  fileTitle,
  formatShift,
  groupCount,
  groupLabel,
} from './result-text';

const route = (route_id: string): PageLocation => ({
  type: 'route',
  route_id,
});

function tripsLine(trips: number): string {
  return t('unit.trips', { count: trips });
}

/** One item as a row: what it names, where it goes, what changed. */
export function itemRow(
  group: Group,
  item: GroupItem
): EntityRow<PageLocation> {
  switch (item.kind) {
    case 'rename':
      return {
        state: group.entity ? entityPage(group.entity, item.b) : undefined,
        label: item.b,
        sublabel: t('group.wasId', { id: item.a }),
      };
    case 'renameSuggestion':
      return {
        label: item.a.join(', '),
        sublabel: t('group.candidates', { ids: item.b.join(', ') }),
      };
    case 'serviceDates':
    case 'serviceWindow': {
      const id = item.b ?? item.a ?? '';
      const parts = [
        t('group.datesAdded', { count: item.added.length }),
        t('group.datesRemoved', { count: item.removed.length }),
      ];
      if (item.a && item.b && item.a !== item.b) {
        parts.push(t('group.wasId', { id: item.a }));
      }
      return {
        state: { type: 'service', service_id: id },
        label: id,
        sublabel: parts.join(', '),
      };
    }
    case 'timeShift':
      return {
        state: route(item.route_id),
        label: item.route_id,
        sublabel: t('group.shifted', {
          trips: tripsLine(item.trips),
          delta: formatShift(item.delta),
        }),
      };
    case 'patternChange': {
      const parts = [tripsLine(item.trips)];
      if (item.addedStops.length > 0) {
        parts.push(t('group.stopsAdded', { ids: item.addedStops.join(', ') }));
      }
      if (item.removedStops.length > 0) {
        parts.push(
          t('group.stopsRemoved', { ids: item.removedStops.join(', ') })
        );
      }
      return {
        state: route(item.route_id),
        label: item.route_id,
        sublabel: parts.join('; '),
      };
    }
    case 'stopTimesFields':
      return {
        state: route(item.route_id),
        label: item.route_id,
        sublabel: `${tripsLine(item.trips)}; ${t('group.columns', {
          cols: item.columns.join(', '),
        })}`,
      };
    case 'stopTimesTimes':
      return {
        state: route(item.route_id),
        label: item.route_id,
        sublabel: tripsLine(item.trips),
      };
    case 'tripCount':
      return {
        state: route(item.route_id),
        label: item.route_id,
        sublabel: t('group.tripCount', {
          direction: item.direction_id || '-',
          a: item.a,
          b: item.b,
        }),
      };
    case 'stopMoved':
      return {
        state: { type: 'stop', stop_id: item.b },
        label: item.b,
        sublabel: [
          t('group.movedBy', { metres: Math.round(item.metres) }),
          item.a !== item.b ? t('group.wasId', { id: item.a }) : '',
        ]
          .filter(Boolean)
          .join(', '),
      };
    case 'shapeChanged':
      return {
        state: { type: 'shape', shape_id: item.b },
        label: item.b,
        sublabel: t('group.shapeChanged', {
          metres: Math.round(item.metres),
          a: item.pointsA,
          b: item.pointsB,
        }),
      };
  }
}

export function groupPage(ctx: PageContext, id: string): TreePage {
  const done = doneResult(ctx);
  if (!done) {
    return waitingPage(ctx, { eyebrow: t('crumb.group'), title: id });
  }
  const group = done.result.groups.find((g) => g.id === id);
  if (!group) {
    return {
      eyebrow: t('crumb.group'),
      title: id,
      sections: [
        { body: `<p class="text-sm opacity-70">${t('group.unknown')}</p>` },
      ],
    };
  }
  const { session } = done;
  const files = group.files.map((f) => `${fileTitle(f)} (${f})`).join(', ');
  return {
    eyebrow: t('crumb.group'),
    title: groupLabel(group),
    sections: [
      {
        body: `<p class="text-sm">${groupCount(group)}</p>${
          files
            ? `<p class="text-xs opacity-60">${t('group.files', { files })}</p>`
            : ''
        }`,
      },
      listSection(t('group.items'), {
        name: `group ${id}`,
        items: {
          count: group.count,
          page: (start, end) =>
            session.call('groupItems', id, start, end - start),
        },
        row: (item) => entityRow<PageLocation>(ctx, itemRow(group, item)),
        searchText: (item) => {
          const row = itemRow(group, item);
          return `${row.label} ${row.sublabel ?? ''}`;
        },
        empty: t('group.empty'),
      }),
    ],
  };
}
