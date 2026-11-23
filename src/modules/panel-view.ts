/** The right panel: a tree page per state, with its breadcrumbs. */

import {
  treeCrumbs,
  type TreeCrumbSource,
} from 'gtfs-zone-web-common/gtfs/breadcrumbs';
import {
  TreePageHost,
  type TreePage,
} from 'gtfs-zone-web-common/gtfs/tree-page';
import type { BreadcrumbItem } from 'gtfs-zone-web-common/ui/breadcrumb-trail';
import { t } from '../i18n/messages';
import type { PageLocation, PageState } from '../types/page-state';
import { entityPageFor, locationId } from './entity-page';
import { filePage } from './file-page';
import { groupPage } from './group-page';
import { homePage } from './home-page';
import { comparisonLabel } from './result-text';
import { doneResult, type PageContext } from './page-context';
import { fileTitle, groupLabel } from './result-text';

/** Bare ids, while no comparison is done. */
const NO_LABELS: TreeCrumbSource = {
  agency: () => null,
  route: () => null,
  trip: () => null,
  stop: () => null,
};

function page(ctx: PageContext, loc: PageLocation): TreePage {
  switch (loc.type) {
    case 'home':
      return homePage(ctx);
    case 'file':
      return filePage(ctx, loc.file, loc.kind);
    case 'group':
      return groupPage(ctx, loc.group);
    default:
      return entityPageFor(ctx, loc);
  }
}

/** Home, then the page's place in the tree. Home itself has no trail. */
export function crumbsFor(
  ctx: PageContext,
  loc: PageLocation
): BreadcrumbItem<PageLocation>[] {
  if (loc.type === 'home') {
    return [];
  }
  const root: BreadcrumbItem<PageLocation> = {
    typeLabel: t('crumb.comparison'),
    label: comparisonLabel(ctx.sources),
    pageState: { type: 'home' },
  };
  const own = (
    typeLabel: string,
    label: string
  ): BreadcrumbItem<PageLocation>[] => [
    root,
    { typeLabel, label, pageState: loc },
  ];
  switch (loc.type) {
    case 'file':
      return own(t('crumb.file'), fileTitle(loc.file));
    case 'group': {
      const g = doneResult(ctx)?.result.groups.find((x) => x.id === loc.group);
      return own(t('crumb.group'), g ? groupLabel(g) : loc.group);
    }
    case 'service':
      return own(t('crumb.service'), loc.service_id);
    case 'shape':
      return own(t('crumb.shape'), loc.shape_id);
    default:
      // Starts the page's read, whose labels fill the chain once it lands.
      if (!doneResult(ctx)) {
        return [root, ...treeCrumbs(NO_LABELS, loc)];
      }
      ctx.entities.get(ctx.session, loc.type, locationId(loc));
      return [root, ...treeCrumbs(ctx.entities, loc)];
  }
}

export interface PanelHooks {
  context: () => PageContext;
  navigate: (state: PageState) => void;
  action: (action: string, arg: string) => void;
}

export function createPanel(
  host: HTMLElement,
  hooks: PanelHooks
): TreePageHost<PageState> {
  const panel = new TreePageHost<PageState>(host, {
    navigate: hooks.navigate,
    href: (state) => hooks.context().href(state),
    page: (state) => page(hooks.context(), state),
    action: hooks.action,
  });
  panel.initialize();
  return panel;
}
