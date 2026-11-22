/**
 * Mounts the shared app shell. Imported first by `index.ts`, so the markup
 * exists before any other module looks up an element id.
 */

import { mountAppShell } from 'gtfs-zone-web-common/ui/app-shell';
import { t } from './i18n/messages';

mountAppShell({
  brandPrefix: 'diff',
  brandSuffix: '.gtfs.zone',
  panelPlaceholder: t('shell.loading'),
  dock: [
    { id: 'dock-browse', label: t('shell.compare'), active: true },
    { id: 'dock-help', label: t('shell.help') },
  ],
});

// Nothing to search until both feeds are loaded.
document.getElementById('map-search-card')?.classList.add('hidden');
