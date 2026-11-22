/** The right panel: the two sources on home, and the focused file or entity. */

import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import { renderComparison, type CompareState } from './results-view';
import {
  isLinkable,
  SIDES,
  type Side,
  type Source,
  type Sources,
} from './sources';

function sourceCard(side: Side, src: Source | null): string {
  const title = t(side === 'a' ? 'home.sideA' : 'home.sideB');
  let body: string;
  if (!src) {
    body = `<p class="text-sm opacity-70">${t('home.noSource')}</p>`;
  } else if (src.kind === 'missing') {
    body = `
      <p class="text-sm font-semibold break-all">${escapeHtml(src.feedId)}</p>
      <p class="text-sm text-error">${escapeHtml(src.reason)}</p>`;
  } else {
    const detail =
      src.kind === 'file'
        ? t('home.uploaded')
        : `<span class="break-all">${escapeHtml(src.url)}</span>`;
    body = `
      <p class="text-sm font-semibold break-words">${escapeHtml(src.label)}</p>
      <p class="text-xs opacity-70">${detail}</p>`;
  }
  const clear = src
    ? `<button class="btn btn-ghost btn-xs" data-action="clear" data-side="${side}">${t('home.clear')}</button>`
    : '';
  return `
    <section class="card card-bordered bg-base-100">
      <div class="card-body p-3 gap-2">
        <div class="flex items-center gap-2">
          <span class="badge badge-neutral font-mono">${side.toUpperCase()}</span>
          <h3 class="font-semibold flex-1">${title}</h3>
          ${clear}
          <button class="btn btn-primary btn-xs" data-action="pick" data-side="${side}">
            ${t(src ? 'home.change' : 'home.choose')}
          </button>
        </div>
        ${body}
      </div>
    </section>`;
}

function renderHome(sources: Sources, compare: CompareState): string {
  const cards = SIDES.map((side) => sourceCard(side, sources[side])).join('');
  const swap =
    sources.a || sources.b
      ? `<button class="btn btn-sm btn-ghost" data-action="swap">${t('home.swap')}</button>`
      : '';
  const unlinked = SIDES.some(
    (side) => sources[side] && !isLinkable(sources[side])
  );
  const notes: string[] = [];
  if (unlinked) {
    notes.push(t('home.uploadNotLinked'));
  }
  notes.push(t('home.yourFeedsNote'));
  return `
    <div class="flex flex-col gap-3 p-3">
      <p class="text-sm">${t('home.lede')}</p>
      ${cards}
      <div class="flex justify-end">${swap}</div>
      ${notes.map((n) => `<p class="text-xs opacity-70">${n}</p>`).join('')}
      <div id="compare-view" class="flex flex-col gap-3">${renderComparison(compare)}</div>
    </div>`;
}

/** The page's kind and the id it names, for the focus header. */
function focusOf(loc: Exclude<PageLocation, { type: 'home' }>): string {
  switch (loc.type) {
    case 'file':
      return loc.file;
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

function renderFocus(loc: Exclude<PageLocation, { type: 'home' }>): string {
  return `
    <div class="flex flex-col gap-3 p-3">
      <button class="btn btn-ghost btn-sm self-start" data-action="home">${t('focus.back')}</button>
      <p class="text-xs uppercase opacity-60">${t(`focus.${loc.type}`)}</p>
      <h2 class="font-semibold break-all">${escapeHtml(focusOf(loc))}</h2>
    </div>`;
}

export function renderPanel(
  loc: PageLocation,
  sources: Sources,
  compare: CompareState
): string {
  return loc.type === 'home' ? renderHome(sources, compare) : renderFocus(loc);
}

/** Redraw only the comparison part of the home panel, when it is shown. */
export function renderCompareView(compare: CompareState): void {
  const el = document.getElementById('compare-view');
  if (el) {
    el.innerHTML = renderComparison(compare);
  }
}
