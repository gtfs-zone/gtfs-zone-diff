/** What every page renders from. */

import type { TreePage } from 'gtfs-zone-web-common/gtfs/tree-page';
import type { DiffResult } from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import { renderCompareStatus, type CompareState } from './compare-status';
import type { DiffSession } from './diff-client';
import type { EntityCache } from './entity-cache';
import type { Sources } from './sources';

export interface PageContext {
  sources: Sources;
  compare: CompareState;
  /** The worker holding both feeds, while one runs or is done. */
  session: DiffSession | null;
  /** Entity reads for the pages, and the crumb labels they carry. */
  entities: EntityCache;
  href: (state: PageLocation) => string;
}

/** The result and its worker, once the comparison is done. */
export function doneResult(
  ctx: PageContext
): { result: DiffResult; session: DiffSession } | null {
  return ctx.compare.status === 'done' && ctx.session
    ? { result: ctx.compare.result, session: ctx.session }
    : null;
}

/** A page that needs the result, shown while there is none yet. */
export function waitingPage(
  ctx: PageContext,
  page: Omit<TreePage, 'sections'>
): TreePage {
  return {
    ...page,
    sections: [
      {
        body:
          renderCompareStatus(ctx.compare) ||
          `<p class="text-sm opacity-70">${t('shell.loading')}</p>`,
      },
    ],
  };
}
