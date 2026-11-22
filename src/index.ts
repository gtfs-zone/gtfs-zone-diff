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
import {
  CompareFailedError,
  compareInput,
  DiffSession,
} from './modules/diff-client';
import type { CompareState } from './modules/compare-status';
import type { PageContext } from './modules/page-context';
import { createPanel, crumbsFor } from './modules/panel-view';
import { pickSource } from './modules/source-picker';
import {
  paramsToSources,
  sourcesToParams,
  type Side,
  type Sources,
} from './modules/sources';
import type { PageLocation, PageState } from './types/page-state';

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
let sources: Sources = { a: null, b: null };
let session: DiffSession | null = null;
/** The sources the running or finished comparison was started with. */
let compared: Sources = { a: null, b: null };
let compareState: CompareState = { status: 'idle' };

function context(): PageContext {
  return {
    sources,
    compare: compareState,
    session,
    href: (state: PageLocation) => `#${pages.buildHash(state)}`,
  };
}

const panel = createPanel(document.getElementById('panel-content')!, {
  context,
  navigate: (state) => navigate(state),
  action: (action, arg) => onAction(action, arg),
});

/** Show the current page from the top, with its trail. */
function render(): void {
  const state = pages.getPageState();
  panel.show(state, crumbsFor(context(), state));
}

/** Redraw the current page in place: its data changed, not the page. */
function refresh(): void {
  const state = pages.getPageState();
  panel.setBreadcrumbs(crumbsFor(context(), state));
  panel.queueRender();
}

function setCompareState(next: CompareState): void {
  compareState = next;
  refresh();
}

/**
 * Compare the current sources in a new worker, releasing the previous one.
 * Does nothing when they are the ones already compared, unless `force`.
 */
function startCompare(force = false): void {
  if (!force && compared.a === sources.a && compared.b === sources.b) {
    return;
  }
  session?.release();
  session = null;
  compared = { ...sources };
  const a = compareInput(sources.a);
  const b = compareInput(sources.b);
  if (!a || !b) {
    compareState = { status: 'idle' };
    return;
  }
  const own = new DiffSession(a, b, {}, (progress) => {
    if (session === own) {
      setCompareState({ status: 'running', progress });
    }
  });
  session = own;
  compareState = { status: 'running', progress: null };
  own.done.then(
    (result) => {
      if (session === own) {
        setCompareState({ status: 'done', result });
      }
    },
    (err: unknown) => {
      if (session !== own) {
        return;
      }
      console.error('[compare] failed', err);
      own.release();
      setCompareState({
        status: 'failed',
        side: err instanceof CompareFailedError ? err.side : null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  );
}

/** Replace both sources and write them to the hash. */
function setSources(next: Sources): void {
  sources = next;
  pages.setFeedParams(sourcesToParams(sources));
  startCompare();
  refresh();
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
    startCompare();
    refresh();
  });
});

async function pick(side: Side): Promise<void> {
  const next = await pickSource(side, sources[side]);
  if (next !== undefined) {
    setSources({ ...sources, [side]: next });
  }
}

function onAction(action: string, arg: string): void {
  const side = arg === 'a' || arg === 'b' ? (arg as Side) : null;
  switch (action) {
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
    case 'retry':
      startCompare(true);
      refresh();
      break;
  }
}

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
  startCompare();
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
