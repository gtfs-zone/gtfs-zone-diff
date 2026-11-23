/**
 * Entity pages: one agency, route, trip, stop, service, shape or the
 * feed_info row, read from the worker and shown on both sides.
 */

import { entityRow } from 'gtfs-zone-web-common/gtfs/entity-row';
import {
  listSection,
  type TreePage,
  type TreeSection,
} from 'gtfs-zone-web-common/gtfs/tree-page';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type {
  EntityRef,
  EntityView,
  PageEntity,
  RelatedKey,
} from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import { appLinkButtons, type LinkFocus } from './app-links';
import { doneResult, waitingPage, type PageContext } from './page-context';
import { SIDES } from './sources';
import { entityStatusBadge, recordTable, stopTimesTable } from './record-view';
import { fileTitle, fmt } from './result-text';

type EntityLocation = Extract<PageLocation, { type: PageEntity }>;

const EYEBROW: Record<PageEntity, Parameters<typeof t>[0]> = {
  feed_info: 'crumb.feedInfo',
  agency: 'crumb.agency',
  route: 'crumb.route',
  trip: 'crumb.trip',
  stop: 'crumb.stop',
  service: 'crumb.service',
  shape: 'crumb.shape',
};

const RELATED_TITLE: Record<RelatedKey, Parameters<typeof t>[0]> = {
  routes: 'related.routes',
  trips: 'related.trips',
  childStops: 'related.childStops',
  stopRoutes: 'related.stopRoutes',
};

/** The page's id param, or '' for feed_info. */
export function locationId(loc: EntityLocation): string {
  switch (loc.type) {
    case 'feed_info':
      return '';
    case 'agency':
      return loc.agency_id;
    case 'route':
      return loc.route_id;
    case 'trip':
      return loc.trip_id;
    case 'stop':
      return loc.stop_id;
    case 'service':
      return loc.service_id;
    case 'shape':
      return loc.shape_id;
  }
}

function refLocation(r: EntityRef): PageLocation {
  switch (r.type) {
    case 'feed_info':
      return { type: 'feed_info' };
    case 'agency':
      return { type: 'agency', agency_id: r.id };
    case 'route':
      return { type: 'route', route_id: r.id };
    case 'trip':
      return { type: 'trip', trip_id: r.id };
    case 'stop':
      return { type: 'stop', stop_id: r.id };
    case 'service':
      return { type: 'service', service_id: r.id };
    case 'shape':
      return { type: 'shape', shape_id: r.id };
  }
}

const text = (s: string): string =>
  `<p class="text-sm opacity-70">${escapeHtml(s)}</p>`;

/** The ids line: one id, or both when the entity was renamed. */
function idLine(v: EntityView): string | undefined {
  if (v.type === 'feed_info') {
    return undefined;
  }
  if (v.a !== null && v.b !== null && v.a !== v.b) {
    return t('entity.renamedIds', { a: v.a, b: v.b });
  }
  return v.b ?? v.a ?? v.id;
}

/** Changed entities first, the rest in feed order. */
function byChange(items: EntityRef[]): EntityRef[] {
  return [
    ...items.filter((r) => r.status !== 'unchanged'),
    ...items.filter((r) => r.status === 'unchanged'),
  ];
}

function relatedSection(
  ctx: PageContext,
  key: RelatedKey,
  items: EntityRef[]
): TreeSection {
  return listSection(t(RELATED_TITLE[key]), {
    name: `related ${key}`,
    items: byChange(items),
    row: (r) =>
      entityRow<PageLocation>(ctx, {
        state: refLocation(r),
        label: r.label,
        sublabel: r.was ? t('entity.renamedIds', { a: r.was, b: r.id }) : r.id,
        badgeHtml:
          r.status === 'unchanged' ? undefined : entityStatusBadge(r.status),
      }),
    searchText: (r) => `${r.label} ${r.id} ${r.was ?? ''}`,
    empty: t('related.empty'),
  });
}

function presence(v: EntityView): string {
  if (v.a === null && v.b === null) {
    return '';
  }
  if (v.a === null) {
    return text(t('entity.onlyB'));
  }
  if (v.b === null) {
    return text(t('entity.onlyA'));
  }
  return '';
}

/** "n in A, m in B" for a pair of counts. */
function pairLine(a: number, b: number): string {
  return t('entity.perSide', { a: fmt(a), b: fmt(b) });
}

function datesBlock(added: string[], removed: string[]): string {
  const iso = (d: string): string =>
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const list = (title: string, dates: string[]): string =>
    dates.length === 0
      ? ''
      : `<div><p class="text-xs font-medium">${escapeHtml(title)}</p>
          <p class="text-xs font-mono max-h-32 overflow-auto break-words">${dates
            .map(iso)
            .join(', ')}</p></div>`;
  return (
    list(t('entity.datesAdded', { count: added.length }), added) +
    list(t('entity.datesRemoved', { count: removed.length }), removed)
  );
}

function sections(ctx: PageContext, v: EntityView): TreeSection[] {
  const out: TreeSection[] = [];
  const intro = presence(v);
  if (intro) {
    out.push({ body: intro });
  }
  for (const rec of v.records) {
    out.push({
      title: fileTitle(rec.file),
      titleExtra: ` <span class="font-mono text-xs font-normal opacity-60">${escapeHtml(rec.file)}</span>`,
      body: recordTable(ctx, rec),
    });
  }
  if (v.dates) {
    const d = v.dates;
    out.push({
      title: t('entity.dates'),
      body: `<div class="flex flex-col gap-2"><p class="text-xs">${escapeHtml(
        pairLine(d.a, d.b)
      )}</p>${datesBlock(d.added, d.removed)}</div>`,
    });
    if (v.records.length === 0) {
      out.push({
        body: `<p class="text-xs opacity-60">${escapeHtml(t('entity.noCalendar'))}</p>`,
      });
    }
  }
  if (v.shape) {
    const s = v.shape;
    const lines = [
      `<p class="text-xs">${escapeHtml(t('entity.points'))}: ${escapeHtml(pairLine(s.pointsA, s.pointsB))}</p>`,
    ];
    if (s.metres !== null) {
      lines.push(
        `<p class="text-xs">${escapeHtml(
          t('entity.apart', { metres: fmt(Math.round(s.metres)) })
        )}</p>`
      );
    }
    out.push({ title: t('file.shapes'), body: lines.join('') });
  }
  if (v.tripCount) {
    out.push({
      title: t('entity.tripsUsing'),
      body: `<p class="text-xs">${escapeHtml(pairLine(v.tripCount.a, v.tripCount.b))}</p>`,
    });
  }
  if (v.stopTimes) {
    out.push({
      title: fileTitle('stop_times.txt'),
      titleExtra: ` <span class="font-mono text-xs font-normal opacity-60">stop_times.txt</span>`,
      body: `<p class="text-xs opacity-60">${escapeHtml(t('entity.stopTimesNote'))}</p>${stopTimesTable(ctx, v.stopTimes)}`,
    });
  }
  for (const r of v.related) {
    out.push(relatedSection(ctx, r.key, r.items));
  }
  const links = linksSection(ctx, v);
  if (links) {
    out.push(links);
  }
  return out;
}

/** Each side's links into the editor and the visualizer, on its own id. */
function linksSection(ctx: PageContext, v: EntityView): TreeSection | null {
  const rows = SIDES.flatMap((side) => {
    const id = v.type === 'feed_info' ? '' : v[side];
    if (id === null) {
      return [];
    }
    const focus: LinkFocus = { type: v.type, id };
    const route = v.crumbs.trip[id]?.route_id;
    if (route) {
      focus.route_id = route;
    }
    const buttons = appLinkButtons(ctx.sources[side], focus);
    return buttons
      ? [
          `<div class="flex items-center gap-2"><span class="badge badge-neutral font-mono">${side.toUpperCase()}</span>${buttons}</div>`,
        ]
      : [];
  });
  return rows.length === 0
    ? null
    : {
        title: t('links.title'),
        body: `<div class="flex flex-col gap-2"><p class="text-xs opacity-60">${escapeHtml(t('links.note'))}</p>${rows.join('')}</div>`,
      };
}

export function entityPageFor(ctx: PageContext, loc: EntityLocation): TreePage {
  const id = locationId(loc);
  const eyebrow = t(EYEBROW[loc.type]);
  const head = {
    eyebrow,
    title: loc.type === 'feed_info' ? eyebrow : id,
    id: loc.type === 'feed_info' ? undefined : id,
  };
  const done = doneResult(ctx);
  if (!done) {
    return waitingPage(ctx, head);
  }
  const state = ctx.entities.get(done.session, loc.type, id);
  if (!state || state.status === 'loading') {
    return { ...head, sections: [{ body: text(t('entity.loading')) }] };
  }
  if (state.status === 'failed') {
    return {
      ...head,
      sections: [
        {
          body: `<div role="alert" class="alert alert-error text-sm">${escapeHtml(
            t('entity.failed', { message: state.message })
          )}</div>`,
        },
      ],
    };
  }
  const v = state.view;
  const missing =
    v.a === null && v.b === null
      ? true
      : v.type === 'feed_info' && v.records.length === 0;
  if (missing) {
    return {
      ...head,
      sections: [
        {
          body: text(
            v.type === 'feed_info'
              ? t('entity.noFeedInfo')
              : t('entity.notFound', { id })
          ),
        },
      ],
    };
  }
  return {
    eyebrow,
    title: v.label || head.title,
    id: idLine(v),
    titleExtra: entityStatusBadge(v.status),
    sections: sections(ctx, v),
  };
}
