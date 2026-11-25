/** The help pages: what exists, its grouping, and its copy. */

import { eyebrow, glyphList, lede } from 'gtfs-zone-web-common/ui/help-modal';
import type { AboutApp } from 'gtfs-zone-web-common/ui/about-links';
import {
  aboutPage,
  helpIcon,
  ICON_CHECK,
  ICON_LOAD,
  ICON_MAP,
  type HelpPage,
} from 'gtfs-zone-web-common/ui/help-pages';
import { renderHelpIcon } from 'gtfs-zone-web-common/ui/modal-utils';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';
import { STATUS_COLORS } from './map-layers';

type Key = Parameters<typeof t>[0];

const ICON_ADDED = helpIcon('<path d="M16 8v16M8 16h16"/>');
const ICON_REMOVED = helpIcon('<path d="M8 16h16"/>');
const ICON_CHANGED = helpIcon('<path d="M20 6l6 6-14 14H6v-6z"/>');
const ICON_FORMATTING = helpIcon(
  '<path d="M7 25l6-18 6 18M9.5 18h7M21 25V15"/>'
);
const ICON_RENAMED = helpIcon('<path d="M6 11h19l-5-5M26 21H7l5 5"/>');
const ICON_SUGGESTION = helpIcon(
  '<path d="M12 12a4 4 0 1 1 6 3.5c-1.2.7-2 1.5-2 3V20"/><path d="M16 24.5v.5"/>'
);
const ICON_FOLLOWS = helpIcon(
  '<path d="M13 19l6-6"/><path d="M11 15l-3 3a4 4 0 0 0 6 6l3-3M21 17l3-3a4 4 0 0 0-6-6l-3 3"/>'
);
const ICON_FILE = helpIcon(
  '<path d="M9 4h10l6 6v18H9z"/><path d="M19 4v6h6"/>'
);
const ICON_MOVED = helpIcon(
  '<circle cx="7" cy="25" r="2.5"/><circle cx="25" cy="7" r="2.5"/><path d="M9 23l14-14" stroke-dasharray="2.5 2.5"/>'
);
const ICON_MERGED = helpIcon(
  '<circle cx="7" cy="7" r="2.5"/><circle cx="7" cy="25" r="2.5"/><circle cx="25" cy="16" r="2.5"/><path d="M9 9l13 6M9 23l13-6" stroke-dasharray="2.5 2.5"/>'
);
const ICON_LIMIT = helpIcon('<path d="M6 9h20M6 16h20M6 23h10"/>');

/** A filled dot in a map status colour. */
function dot(color: string): string {
  return `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="7" fill="${color}"/></svg>`;
}

function subhead(key: Key): string {
  return `<h4 class="font-semibold text-sm mt-2">${escapeHtml(t(key))}</h4>`;
}

/** Glyph list items from `help.<page>.<item>` and `<item>Text` keys. */
function items(page: string, list: [string, string][]): string {
  return glyphList(
    list.map(([item, icon]) => ({
      icon,
      term: t(`help.${page}.${item}` as Key),
      description: t(`help.${page}.${item}Text` as Key),
    }))
  );
}

/** A small "?" button that opens a guide page through the `help` action. */
export function helpButton(page: string): string {
  return `<button type="button" class="btn btn-ghost btn-xs btn-circle align-middle ml-1" data-action="help" data-arg="${page}" title="${escapeHtml(t('shell.help'))}" aria-label="${escapeHtml(t('shell.help'))}">${renderHelpIcon('h-3.5 w-3.5')}</button>`;
}

const welcomePage: HelpPage = {
  id: 'welcome',
  label: t('help.welcome.label'),
  group: 'Getting Started',
  title: t('help.welcome.title'),
  showOnce: true,
  render: () =>
    [
      eyebrow('GTFS.zone'),
      lede(t('help.welcome.lede')),
      glyphList([
        {
          icon: ICON_LOAD,
          term: t('help.welcome.sources'),
          description: t('help.welcome.sourcesText'),
        },
        {
          icon: ICON_CHECK,
          term: t('help.welcome.changes'),
          description: t('help.welcome.changesText'),
        },
        {
          icon: ICON_MAP,
          term: t('help.welcome.links'),
          description: t('help.welcome.linksText'),
        },
      ]),
    ].join(''),
};

const changesPage: HelpPage = {
  id: 'changes',
  label: t('help.changes.label'),
  group: 'Reference',
  title: t('help.changes.title'),
  render: () =>
    [
      lede(t('help.changes.lede')),
      items('changes', [
        ['added', ICON_ADDED],
        ['removed', ICON_REMOVED],
        ['changed', ICON_CHANGED],
        ['formatting', ICON_FORMATTING],
        ['renamed', ICON_RENAMED],
        ['followsRename', ICON_FOLLOWS],
      ]),
      subhead('help.changes.files'),
      items('changes', [
        ['identical', ICON_CHECK],
        ['unknown', ICON_FILE],
      ]),
    ].join(''),
};

const renamesPage: HelpPage = {
  id: 'renames',
  label: t('help.renames.label'),
  group: 'Reference',
  title: t('help.renames.title'),
  render: () =>
    [
      lede(t('help.renames.lede')),
      items('renames', [
        ['agencies', ICON_RENAMED],
        ['routes', ICON_RENAMED],
        ['stops', ICON_RENAMED],
        ['services', ICON_RENAMED],
        ['shapes', ICON_RENAMED],
        ['trips', ICON_RENAMED],
      ]),
      subhead('help.renames.after'),
      items('renames', [
        ['suggestions', ICON_SUGGESTION],
        ['settled', ICON_CHECK],
        ['follows', ICON_FOLLOWS],
      ]),
    ].join(''),
};

const mapPage: HelpPage = {
  id: 'map',
  label: t('help.map.label'),
  group: 'Reference',
  title: t('help.map.title'),
  render: () =>
    [
      lede(t('help.map.lede')),
      items('map', [
        ['added', dot(STATUS_COLORS.added)],
        ['removed', dot(STATUS_COLORS.removed)],
        ['changed', dot(STATUS_COLORS.changed)],
        ['unchanged', dot(STATUS_COLORS.unchanged)],
        ['moved', ICON_MOVED],
        ['merged', ICON_MERGED],
        ['shapeSwap', ICON_MAP],
        ['noShape', ICON_MAP],
      ]),
      subhead('help.map.toggle'),
      items('map', [
        ['sideA', ICON_MAP],
        ['sideBoth', ICON_MAP],
        ['sideB', ICON_MAP],
      ]),
    ].join(''),
};

const exportPage: HelpPage = {
  id: 'export',
  label: t('help.export.label'),
  group: 'Reference',
  title: t('help.export.title'),
  render: () =>
    [
      lede(t('help.export.lede')),
      items('export', [
        ['v2', ICON_FILE],
        ['summary', ICON_FILE],
        ['cap', ICON_LIMIT],
      ]),
    ].join(''),
};

const ABOUT_APP: AboutApp = {
  name: 'diff.gtfs.zone',
  blurb: [t('help.about.blurb'), t('help.about.blurb2')],
  contactSubject: t('help.about.subject'),
  repo: 'gtfs-zone-diff',
  sibling: {
    name: 'edit.gtfs.zone',
    href: 'https://edit.gtfs.zone',
    note: t('help.about.sibling'),
  },
};

export const HELP_PAGES: HelpPage[] = [
  welcomePage,
  changesPage,
  renamesPage,
  mapPage,
  exportPage,
  aboutPage(ABOUT_APP),
];
