/**
 * Links from one side into the editor and the viewer, focused on the same
 * entity where the target app has a page for it. Only URL and catalog
 * sources can be linked.
 */

import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { CONFIG } from '../config';
import type { PageEntity } from '../engine/types';
import { t } from '../i18n/messages';
import type { Source } from './sources';

/** An entity on one side: its id there, and its route for a trip. */
export interface LinkFocus {
  type: PageEntity;
  id: string;
  route_id?: string;
}

function sourceUrl(
  src: Source | null
): { url: string; useCors: boolean } | null {
  switch (src?.kind) {
    case 'catalog':
      return { url: src.url, useCors: true };
    case 'url':
      return { url: src.url, useCors: src.useCors };
    default:
      return null;
  }
}

/** The editor's focus params. It has no trip or shape page: a trip opens its route. */
function editorFocus(focus: LinkFocus | undefined): [string, string] | null {
  switch (focus?.type) {
    case 'agency':
    case 'route':
    case 'stop':
    case 'service':
      return [focus.type, focus.id];
    case 'trip':
      return focus.route_id ? ['route', focus.route_id] : null;
    default:
      return null;
  }
}

/** The viewer's focus params, `type=` plus the id. */
function viewerFocus(focus: LinkFocus | undefined): [string, string][] {
  switch (focus?.type) {
    case 'feed_info':
      return [['type', 'feed_info']];
    case 'agency':
    case 'route':
    case 'trip':
    case 'stop':
      return [
        ['type', focus.type],
        [focus.type, focus.id],
      ];
    default:
      return [];
  }
}

function editorUrl(src: Source | null, focus?: LinkFocus): string | null {
  const s = sourceUrl(src);
  if (!s) {
    return null;
  }
  const params = new URLSearchParams({ load: s.url });
  const f = editorFocus(focus);
  if (f) {
    params.set(f[0], f[1]);
  }
  return `${CONFIG.EDITOR_BASE}/#${params.toString()}`;
}

function viewerUrl(src: Source | null, focus?: LinkFocus): string | null {
  const s = sourceUrl(src);
  if (!s) {
    return null;
  }
  const params = new URLSearchParams({
    scheduled: s.url,
    cors: s.useCors ? 's' : 'none',
  });
  for (const [k, v] of viewerFocus(focus)) {
    params.set(k, v);
  }
  return `${CONFIG.VIEWER_BASE}/#${params.toString()}`;
}

/** "Open in editor" / "Open in visualizer" buttons, or '' when the side has no URL. */
export function appLinkButtons(src: Source | null, focus?: LinkFocus): string {
  const links = [
    [editorUrl(src, focus), t('links.openEditor')],
    [viewerUrl(src, focus), t('links.openViewer')],
  ]
    .filter((l): l is [string, string] => l[0] !== null)
    .map(
      ([href, label]) =>
        `<a class="btn btn-xs btn-outline" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    );
  return links.length > 0
    ? `<div class="flex flex-wrap gap-2">${links.join('')}</div>`
    : '';
}
