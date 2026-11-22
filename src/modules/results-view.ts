/** The comparison on the home panel: progress while it runs, then the counts. */

import { formatBytes } from 'gtfs-zone-web-common/gtfs/feed-download';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import { t } from '../i18n/messages';
import type {
  CompareProgress,
  DiffResult,
  FeedIssue,
  FileDiff,
  FileStatus,
  Group,
  Side,
} from '../engine/types';

export type CompareState =
  | { status: 'idle' }
  | { status: 'running'; progress: CompareProgress | null }
  | { status: 'done'; result: DiffResult }
  | { status: 'failed'; side: Side | null; message: string };

const STATUS_BADGE: Record<FileStatus, string> = {
  added: 'badge-success',
  removed: 'badge-error',
  changed: 'badge-warning',
  formatting: 'badge-info',
  identical: 'badge-ghost',
  unknown: 'badge-ghost',
};

const fmt = (n: number): string => n.toLocaleString();

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

function fileCounts(f: FileDiff): string {
  const g = f.grouped;
  const parts: string[] = [];
  const push = (key: Parameters<typeof t>[0], count: number): void => {
    if (count > 0) {
      parts.push(t(key, { count: fmt(count) }));
    }
  };
  push('results.added', g.added);
  push('results.removed', g.removed);
  push('results.changed', g.changed);
  push('results.renamed', g.renamed);
  push('results.followsRename', g.followsRename);
  push('results.formatting', g.formatting);
  return parts.join(', ');
}

function headerLine(f: FileDiff): string {
  const h = f.header;
  if (!h) {
    return '';
  }
  const changes: string[] = [];
  if (h.added.length > 0) {
    changes.push(t('results.headerAdded', { cols: h.added.join(', ') }));
  }
  if (h.removed.length > 0) {
    changes.push(t('results.headerRemoved', { cols: h.removed.join(', ') }));
  }
  if (h.reordered) {
    changes.push(t('results.headerReordered'));
  }
  return changes.length > 0
    ? t('results.header', { changes: changes.join('; ') })
    : '';
}

function renderFile(f: FileDiff): string {
  const counts = fileCounts(f);
  const header = headerLine(f);
  return `
    <li class="py-1.5 flex flex-col gap-0.5">
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm flex-1 break-all">${escapeHtml(f.file)}</span>
        <span class="badge badge-sm ${STATUS_BADGE[f.status]}">${t(`results.status.${f.status}`)}</span>
      </div>
      ${counts ? `<p class="text-xs opacity-80">${escapeHtml(counts)}</p>` : ''}
      ${header ? `<p class="text-xs opacity-60">${escapeHtml(header)}</p>` : ''}
    </li>`;
}

function renderGroup(g: Group): string {
  const label = t(`results.group.${g.kind}`, { entity: g.entity ?? '' });
  const covers =
    g.covers !== undefined
      ? ` (${t('results.covers', { count: g.covers })})`
      : '';
  return `
    <li class="py-1 flex items-center gap-2 text-sm">
      <span class="flex-1">${escapeHtml(label)}</span>
      <span class="font-mono">${fmt(g.count)}${escapeHtml(covers)}</span>
    </li>`;
}

function issueText(i: FeedIssue): string {
  return t(`results.issue.${i.code}`, {
    side: i.side.toUpperCase(),
    count: fmt(i.count),
    file: i.file,
    detail: i.detail ?? '',
  });
}

function renderDone(r: DiffResult): string {
  // Identical files are listed last; the rest keep their feed order.
  const changed = r.files.filter((f) => f.status !== 'identical');
  const same = r.files.filter((f) => f.status === 'identical');
  const sec = (n: number | undefined): string => ((n ?? 0) / 1000).toFixed(1);
  const compareMs = Object.entries(r.timings)
    .filter(([k]) => !k.includes(':') && k !== 'load')
    .reduce((n, [, v]) => n + v, 0);
  return `
    ${r.completeness.ok ? '' : `<div role="alert" class="alert alert-error text-sm">${t('compare.incomplete')}</div>`}
    <section class="flex flex-col gap-1">
      <h3 class="font-semibold">${t('results.files')}</h3>
      ${changed.length === 0 ? `<p class="text-sm opacity-70">${t('results.noChanges')}</p>` : ''}
      <ul class="divide-y divide-base-300">${[...changed, ...same].map(renderFile).join('')}</ul>
    </section>
    <section class="flex flex-col gap-1">
      <h3 class="font-semibold">${t('results.groups')}</h3>
      ${
        r.groups.length === 0
          ? `<p class="text-sm opacity-70">${t('results.noGroups')}</p>`
          : `<ul class="divide-y divide-base-300">${r.groups.map(renderGroup).join('')}</ul>`
      }
    </section>
    ${
      r.issues.length > 0
        ? `<section class="flex flex-col gap-1">
            <h3 class="font-semibold">${t('results.issues')}</h3>
            <ul class="list-disc pl-5 text-xs flex flex-col gap-1">${r.issues
              .map(
                (i) =>
                  `<li class="break-words">${escapeHtml(issueText(i))}</li>`
              )
              .join('')}</ul>
          </section>`
        : ''
    }
    <p class="text-xs opacity-60">${t('compare.timings', { load: sec(r.timings.load), compare: sec(compareMs) })}</p>`;
}

export function renderComparison(state: CompareState): string {
  switch (state.status) {
    case 'idle':
      return `<p class="text-sm opacity-70">${t('compare.waiting')}</p>`;
    case 'running':
      return renderRunning(state.progress);
    case 'failed':
      return renderFailed(state.side, state.message);
    case 'done':
      return renderDone(state.result);
  }
}
