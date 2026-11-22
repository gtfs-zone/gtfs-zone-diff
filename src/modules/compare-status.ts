/** Where the comparison is: waiting for feeds, running, failed or done. */

import { formatBytes } from 'gtfs-zone-web-common/gtfs/feed-download';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';
import type { CompareProgress, DiffResult, Side } from '../engine/types';

export type CompareState =
  | { status: 'idle' }
  | { status: 'running'; progress: CompareProgress | null }
  | { status: 'done'; result: DiffResult }
  | { status: 'failed'; side: Side | null; message: string };

function progressText(p: CompareProgress | null): string {
  if (!p) {
    return t('shell.loading');
  }
  if (p.stage === 'load') {
    const side = (p.side ?? 'a').toUpperCase();
    const head = p.table
      ? t('compare.loadingTable', { side, table: p.table })
      : t('compare.loading', { side });
    const read = formatBytes(p.bytes ?? 0);
    const bytes = p.total
      ? t('compare.bytesOf', { read, total: formatBytes(p.total) })
      : read;
    return `${head} (${bytes})`;
  }
  if (p.stage === 'rows') {
    return t('compare.stage.rows', { table: p.table ?? '' });
  }
  return t(`compare.stage.${p.stage}`);
}

function renderRunning(p: CompareProgress | null): string {
  const pct =
    p?.stage === 'load' && p.total
      ? Math.min(100, (100 * (p.bytes ?? 0)) / p.total)
      : null;
  const bar =
    pct === null
      ? '<progress class="progress progress-primary w-full"></progress>'
      : `<progress class="progress progress-primary w-full" value="${pct.toFixed(1)}" max="100"></progress>`;
  return `
    <div class="flex flex-col gap-2">
      <p class="text-sm">${escapeHtml(progressText(p))}</p>
      ${bar}
    </div>`;
}

function renderFailed(side: Side | null, message: string): string {
  const text = side
    ? t('compare.failedSide', { side: side.toUpperCase(), message })
    : t('compare.failed', { message });
  return `
    <div role="alert" class="alert alert-error text-sm flex flex-col items-start gap-2">
      <span class="break-words">${escapeHtml(text)}</span>
      <button class="btn btn-sm" data-action="retry">${t('compare.retry')}</button>
    </div>`;
}

/** The status of a comparison that is not done, or empty once it is. */
export function renderCompareStatus(state: CompareState): string {
  switch (state.status) {
    case 'idle':
      return `<p class="text-sm opacity-70">${t('compare.waiting')}</p>`;
    case 'running':
      return renderRunning(state.progress);
    case 'failed':
      return renderFailed(state.side, state.message);
    case 'done':
      return '';
  }
}
