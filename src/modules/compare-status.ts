/** Where the comparison is: waiting for feeds, running, failed or done. */

import { formatBytes } from 'gtfs-zone-web-common/gtfs/feed-download';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';
import type { CompareProgress, DiffResult, Side } from '../engine/types';

/** The steps of a comparison, in the order the worker runs them. */
const STEPS = ['loadA', 'loadB', 'files', 'renames', 'rows', 'groups'] as const;
type Step = (typeof STEPS)[number];

/** When each step started, in `performance.now()` milliseconds. */
export type StepStarts = Partial<Record<Step, number>>;

export type CompareState =
  | { status: 'idle' }
  | {
      status: 'running';
      progress: CompareProgress | null;
      started: StepStarts;
    }
  | { status: 'cancelled' }
  | { status: 'done'; result: DiffResult }
  | { status: 'failed'; side: Side | null; message: string };

function stepOf(p: CompareProgress | null): Step {
  if (!p) {
    return 'loadA';
  }
  if (p.stage === 'load') {
    return p.side === 'b' ? 'loadB' : 'loadA';
  }
  return p.stage;
}

/** `started` with the step of `p` stamped now, when it is a new one. */
export function stampStep(
  started: StepStarts,
  p: CompareProgress | null
): StepStarts {
  const step = stepOf(p);
  return step in started ? started : { ...started, [step]: performance.now() };
}

/** The current step's detail line: bytes read, or the table. */
function detailText(p: CompareProgress | null): string {
  if (p?.stage === 'load') {
    const read = formatBytes(p.bytes ?? 0);
    const bytes = p.total
      ? t('compare.bytesOf', { read, total: formatBytes(p.total) })
      : read;
    return p.table ? `${p.table} (${bytes})` : bytes;
  }
  if (p?.stage === 'rows' && p.table) {
    return p.count
      ? t('compare.tableOf', {
          table: p.table,
          n: (p.index ?? 0) + 1,
          count: p.count,
        })
      : p.table;
  }
  return '';
}

/** Percent done of the current step, or null when it cannot be told. */
function percent(p: CompareProgress | null): number | null {
  if (p?.stage === 'load' && p.total) {
    return Math.min(100, (100 * (p.bytes ?? 0)) / p.total);
  }
  if (p?.stage === 'rows' && p.count) {
    return (100 * (p.index ?? 0)) / p.count;
  }
  return null;
}

const ICON_DONE =
  '<svg class="size-4 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7"/></svg>';
const ICON_CURRENT =
  '<span class="loading loading-spinner loading-xs shrink-0 text-primary" aria-hidden="true"></span>';
const ICON_PENDING =
  '<span class="size-4 shrink-0 flex items-center justify-center" aria-hidden="true"><span class="size-1.5 rounded-full bg-current opacity-40"></span></span>';

function seconds(ms: number): string {
  return t('compare.seconds', { s: (ms / 1000).toFixed(1) });
}

function stepRow(
  step: Step,
  current: number,
  i: number,
  started: StepStarts,
  p: CompareProgress | null
): string {
  const label = escapeHtml(t(`compare.step.${step}`));
  if (i < current) {
    const start = started[step];
    const end = started[STEPS[i + 1]];
    const took =
      start !== undefined && end !== undefined
        ? `<span class="ml-auto text-xs opacity-60 tabular-nums">${seconds(end - start)}</span>`
        : '';
    return `<li class="flex items-center gap-2">${ICON_DONE}<span>${label}</span>${took}</li>`;
  }
  if (i > current) {
    return `<li class="flex items-center gap-2 opacity-50">${ICON_PENDING}<span>${label}</span></li>`;
  }
  const detail = detailText(p);
  return `
    <li class="flex flex-col gap-0.5" aria-current="step">
      <span class="flex items-center gap-2 font-medium">${ICON_CURRENT}<span>${label}</span></span>
      ${detail ? `<span class="pl-6 text-xs opacity-70 break-all">${escapeHtml(detail)}</span>` : ''}
    </li>`;
}

/** Id of the element holding the steps, patched in place on each progress. */
export const PROGRESS_ID = 'compare-progress';

/** The steps and the current step's bar. */
export function renderProgress(
  p: CompareProgress | null,
  started: StepStarts
): string {
  const current = STEPS.indexOf(stepOf(p));
  const pct = percent(p);
  const bar =
    pct === null
      ? '<progress class="progress progress-primary w-full"></progress>'
      : `<progress class="progress progress-primary w-full" value="${pct.toFixed(1)}" max="100"></progress>`;
  return `
    <ol class="flex flex-col gap-1.5 text-sm" aria-label="${escapeHtml(t('compare.steps'))}">
      ${STEPS.map((s, i) => stepRow(s, current, i, started, p)).join('')}
    </ol>
    ${bar}`;
}

// The Stop button sits outside the patched element, so a click on it is
// never lost to a re-render.
function renderRunning(p: CompareProgress | null, started: StepStarts): string {
  return `
    <div class="flex flex-col gap-3">
      <div id="${PROGRESS_ID}" class="flex flex-col gap-3">${renderProgress(p, started)}</div>
      <div>
        <button class="btn btn-sm" data-action="cancel">${t('compare.cancel')}</button>
      </div>
    </div>`;
}

function renderCancelled(): string {
  return `
    <div class="flex flex-col items-start gap-2">
      <p class="text-sm opacity-70">${t('compare.cancelled')}</p>
      <button class="btn btn-sm" data-action="retry">${t('compare.again')}</button>
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
      return renderRunning(state.progress, state.started);
    case 'cancelled':
      return renderCancelled();
    case 'failed':
      return renderFailed(state.side, state.message);
    case 'done':
      return '';
  }
}
