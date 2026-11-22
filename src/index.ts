// Mounts the shell markup; must stay the first import.
import './shell';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadFeedCatalog } from 'gtfs-zone-web-common/gtfs/feed-catalog';
import { BottomSheetController } from 'gtfs-zone-web-common/ui/bottom-sheet';
import {
  setHelpPages,
  showHelpModal,
  showHelpPageOnce,
} from 'gtfs-zone-web-common/ui/help-modal';
import {
  HELP_GROUP_ORDER,
  setHelpRuntimeData,
} from 'gtfs-zone-web-common/ui/help-pages';
import {
  renderDockIcons,
  renderNavbarActions,
} from 'gtfs-zone-web-common/ui/navbar-actions';
import { notify } from 'gtfs-zone-web-common/ui/notification-system';
import {
  PanelResizer,
  restorePanelWidth,
} from 'gtfs-zone-web-common/ui/panel-resizer';
import { ThemeController } from 'gtfs-zone-web-common/ui/theme-controller';
import { t } from './i18n/messages';
import { MapController } from './map-controller';
import { HELP_PAGES } from './modules/help-pages';
import { DOCK_ICONS, NAVBAR_ACTIONS } from './modules/navbar-action-list';
import { createPageStateManager } from './modules/page-state';
import { renderPanel } from './modules/panel-view';
import { pickSource } from './modules/source-picker';
import {
  paramsToSources,
  sourcesToParams,
  type Side,
  type Sources,
} from './modules/sources';
import type { PageState } from './types/page-state';

// --- Shell -------------------------------------------------------------------

renderNavbarActions(document.getElementById('navbar-actions')!, NAVBAR_ACTIONS);
renderDockIcons(DOCK_ICONS);
document.title = t('app.title');

const appContainer = document.querySelector<HTMLElement>('.app-container')!;
restorePanelWidth(appContainer);
notify.initialize();
new ThemeController().initialize();

const mapCtrl = new MapController();
try {
  mapCtrl.initialize('map');
} catch (e) {
  console.error('[map] failed to initialize:', e);
  document.getElementById('map')!.innerHTML =
    `<div class="h-full flex items-center justify-center p-6 text-center text-sm opacity-70">${t('app.noWebgl')}</div>`;
}
new PanelResizer(appContainer, mapCtrl);

setHelpPages(HELP_PAGES, HELP_GROUP_ORDER);
setHelpRuntimeData({ version: __APP_VERSION__, shortcuts: [] });
document.getElementById('app-version')!.textContent = __APP_VERSION__;

// --- State -------------------------------------------------------------------

const pages = createPageStateManager();
const panel = document.getElementById('panel-content')!;
let sources: Sources = { a: null, b: null };

function render(): void {
  panel.innerHTML = renderPanel(pages.getPageState(), sources);
}

/** Replace both sources and write them to the hash. */
function setSources(next: Sources): void {
  sources = next;
  pages.setFeedParams(sourcesToParams(sources));
  render();
}

function navigate(state: PageState): void {
  pages.setPageState(state);
}

function openHelp(page?: string): void {
  navigate({ ...pages.getPageState(), modal: { type: 'help', page } });
}

async function showHelpFor(state: PageState): Promise<void> {
  if (state.modal?.type !== 'help') {
    return;
  }
  await showHelpModal(state.modal.page);
  await pages.clearModal();
}

pages.addNavigationHandler(({ to }) => {
  render();
  void showHelpFor(to);
});

/** True when the hash names other sources than the ones held. */
function sourcesChangedInHash(): boolean {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const held = sourcesToParams(sources);
  return ['a', 'b', 'cors'].some(
    (key) => (params.get(key) ?? undefined) !== held[key]
  );
}

// A hand-edited address bar can name other feeds; uploads are dropped then.
window.addEventListener('hashchange', () => {
  if (!sourcesChangedInHash()) {
    return;
  }
  void paramsToSources(window.location.hash.slice(1)).then((next) => {
    sources = next;
    pages.setFeedParams(sourcesToParams(sources), false);
    render();
  });
});

async function pick(side: Side): Promise<void> {
  const next = await pickSource(side, sources[side]);
  if (next !== undefined) {
    setSources({ ...sources, [side]: next });
  }
}

panel.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) {
    return;
  }
  const side = el.dataset.side as Side | undefined;
  switch (el.dataset.action) {
    case 'pick':
      if (side) {
        void pick(side);
      }
      break;
    case 'clear':
      if (side) {
        setSources({ ...sources, [side]: null });
      }
      break;
    case 'swap':
      setSources({ a: sources.b, b: sources.a });
      break;
    case 'home':
      navigate({ type: 'home' });
      break;
  }
});

document
  .getElementById('help-btn')!
  .addEventListener('click', () => openHelp());

new BottomSheetController(document.getElementById('right-panel')!, [
  { id: 'dock-browse' },
  { id: 'dock-help', snap: null, onSelect: () => openHelp() },
]);

// --- Boot --------------------------------------------------------------------

async function boot(): Promise<void> {
  // In flight while the hash is read, so the picker opens with rows.
  void loadFeedCatalog().catch((err: unknown) =>
    console.warn('[boot] feed catalog unavailable:', err)
  );
  const pending = pages.pendingStateFromURL();
  sources = await paramsToSources(window.location.hash.slice(1));
  pages.setFeedParams(sourcesToParams(sources), false);
  pages.adoptState(pending);
  pages.syncHash();
  render();

  if (pending.modal?.type === 'help') {
    await showHelpFor(pending);
  } else {
    await showHelpPageOnce('welcome', {
      continueLabel: t('help.welcome.start'),
    });
  }
}

void boot();
