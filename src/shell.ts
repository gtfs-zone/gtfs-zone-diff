/**
 * Mounts the shared app shell. Imported first by `index.ts`, so the markup
 * exists before any other module looks up an element id.
 */

import { mountAppShell } from 'gtfs-zone-web-common/ui/app-shell';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from './i18n/messages';
import { helpButton } from './modules/help-pages';
import { STATUS_COLORS, type MapSide } from './modules/map-layers';

const SIDES: { side: MapSide; label: string; tip: string }[] = [
  { side: 'a', label: t('map.sideA'), tip: t('map.sideATip') },
  { side: 'both', label: t('map.sideBoth'), tip: t('map.sideBothTip') },
  { side: 'b', label: t('map.sideB'), tip: t('map.sideBTip') },
];

const LEGEND = (['added', 'removed', 'changed'] as const)
  .map(
    (s) =>
      `<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${STATUS_COLORS[s]}"></span>${escapeHtml(t(`status.${s}`))}</span>`
  )
  .join('');

/** A / both / B toggle and the status colours, hidden until there is a result. */
const MAP_SIDE_CONTROL = `
  <div id="map-side-card" class="hidden card card-bordered bg-base-100 shadow-lg p-1 pointer-events-auto flex-shrink-0">
    <div class="flex items-center gap-2">
      <div class="join" role="group" aria-label="${escapeHtml(t('map.side'))}">
        ${SIDES.map(
          ({ side, label, tip }) =>
            `<button type="button" class="join-item btn btn-sm${side === 'both' ? ' btn-active' : ''}" data-map-side="${side}" title="${escapeHtml(tip)}" aria-pressed="${side === 'both'}">${escapeHtml(label)}</button>`
        ).join('')}
      </div>
      <div class="hidden sm:flex items-center gap-2 text-xs">${LEGEND}</div>
      ${helpButton('map')}
    </div>
  </div>`;

mountAppShell({
  brandPrefix: 'diff',
  brandSuffix: '.gtfs.zone',
  panelPlaceholder: t('shell.loading'),
  mapControlsExtra: MAP_SIDE_CONTROL,
  dock: [
    { id: 'dock-browse', label: t('shell.compare'), active: true },
    { id: 'dock-help', label: t('shell.help') },
  ],
});

// Shown once both feeds are compared.
document.getElementById('map-search-card')?.classList.add('hidden');
