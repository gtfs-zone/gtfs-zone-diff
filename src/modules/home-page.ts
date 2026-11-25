/** Home: the two sources, then the comparison's files, groups and issues. */

import { entityRow } from 'gtfs-zone-web-common/gtfs/entity-row';
import {
  listSection,
  type TreePage,
  type TreeSection,
} from 'gtfs-zone-web-common/gtfs/tree-page';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type { DiffResult, FileDiff, Group } from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import { appLinkButtons } from './app-links';
import { renderCompareStatus } from './compare-status';
import { exportCap } from './export-actions';
import { helpButton } from './help-pages';
import type { PageContext } from './page-context';
import {
  comparisonLabel,
  fileCounts,
  fileTitle,
  groupCount,
  groupLabel,
  headerLine,
  issueText,
  statusBadge,
} from './result-text';
import { SIDES, type Side, type Source, type Sources } from './sources';

function sourceCard(side: Side, src: Source | null): string {
  const title = t(side === 'a' ? 'home.sideA' : 'home.sideB');
  let body: string;
  if (!src) {
    body = `<p class="text-sm opacity-70">${t('home.noSource')}</p>`;
  } else if (src.kind === 'missing') {
    body = `
      <p class="text-sm font-semibold break-all">${escapeHtml(src.name)}</p>
      <p class="text-sm text-error">${escapeHtml(src.reason)}</p>`;
  } else {
    const detail =
      src.kind === 'file' || src.kind === 'upload'
        ? t('home.uploaded')
        : `<span class="break-all">${escapeHtml(src.url)}</span>`;
    body = `
      <p class="text-sm font-semibold break-words">${escapeHtml(src.label)}</p>
      <p class="text-xs opacity-70">${detail}</p>
      ${appLinkButtons(src)}`;
  }
  const clear = src
    ? `<button class="btn btn-ghost btn-xs" data-action="clear" data-arg="${side}">${t('home.clear')}</button>`
    : '';
  return `
    <section class="card card-bordered bg-base-100">
      <div class="card-body p-3 gap-2">
        <div class="flex items-center gap-2">
          <span class="badge badge-neutral font-mono">${side.toUpperCase()}</span>
          <h3 class="font-semibold flex-1">${title}</h3>
          ${clear}
          <button class="btn btn-primary btn-xs" data-action="pick" data-arg="${side}">
            ${t(src ? 'home.change' : 'home.choose')}
          </button>
        </div>
        ${body}
      </div>
    </section>`;
}

function sourcesBody(sources: Sources): string {
  const cards = SIDES.map((side) => sourceCard(side, sources[side])).join('');
  const swap =
    sources.a || sources.b
      ? `<button class="btn btn-sm btn-ghost" data-action="swap">${t('home.swap')}</button>`
      : '';
  const notes: string[] = [];
  const uploaded = (side: Side): boolean =>
    sources[side]?.kind === 'file' || sources[side]?.kind === 'upload';
  if (SIDES.some(uploaded)) {
    notes.push(t('home.uploadLocal'));
  }
  notes.push(t('home.yourFeedsNote'));
  return `
    <div class="flex flex-col gap-3">
      <p class="text-sm">${t('home.lede')}</p>
      ${cards}
      <div class="flex justify-end">${swap}</div>
      ${notes.map((n) => `<p class="text-xs opacity-70">${n}</p>`).join('')}
    </div>`;
}

function fileRow(ctx: PageContext, f: FileDiff): string {
  const lines = [f.file, fileCounts(f), headerLine(f)].filter(Boolean);
  return entityRow<PageLocation>(ctx, {
    state: { type: 'file', file: f.file },
    label: fileTitle(f.file),
    sublabel: lines.join(' - '),
    badgeHtml: statusBadge(f.status),
  });
}

function groupRow(ctx: PageContext, g: Group): string {
  return entityRow<PageLocation>(ctx, {
    state: { type: 'group', group: g.id },
    label: groupLabel(g),
    sublabel: groupCount(g),
  });
}

function exportSection(ctx: PageContext): TreeSection {
  const cap = exportCap();
  const busy = ctx.exporting
    ? ` disabled title="${escapeHtml(t('export.working'))}"`
    : '';
  const button = (kind: string, label: string): string =>
    `<button class="btn btn-sm" data-action="export" data-arg="${kind}"${busy}>${escapeHtml(label)}</button>`;
  return {
    title: t('export.title'),
    titleExtra: helpButton('export'),
    body: `
      <div class="flex flex-col gap-2">
        <p class="text-xs opacity-70">${t('export.lede')}</p>
        <label class="flex items-center gap-2 text-sm">
          <span class="flex-1">${t('export.cap')}</span>
          <input id="export-cap" type="number" min="0" step="1"
            class="input input-sm w-24" placeholder="${escapeHtml(t('export.capAll'))}"
            value="${cap ?? ''}">
        </label>
        <p class="text-xs opacity-60">${t('export.capNote')}</p>
        <div class="flex flex-wrap gap-2">
          ${button('v2', t('export.v2'))}
          ${button('summary', t('export.summary'))}
        </div>
      </div>`,
  };
}

function resultSections(ctx: PageContext, r: DiffResult): TreeSection[] {
  // Identical files last; the rest keep their feed order.
  const files = [
    ...r.files.filter((f) => f.status !== 'identical'),
    ...r.files.filter((f) => f.status === 'identical'),
  ];
  const changed = files.some((f) => f.status !== 'identical');
  const sec = (n: number | undefined): string => ((n ?? 0) / 1000).toFixed(1);
  const compareMs = Object.entries(r.timings)
    .filter(([k]) => !k.includes(':') && k !== 'load')
    .reduce((n, [, v]) => n + v, 0);
  const sections: TreeSection[] = [];
  if (!r.completeness.ok) {
    sections.push({
      body: `<div role="alert" class="alert alert-error text-sm">${t('compare.incomplete')}</div>`,
    });
  }
  sections.push(
    listSection(
      t('results.files'),
      {
        name: 'files',
        items: files,
        row: (f) => fileRow(ctx, f),
        searchText: (f) => `${fileTitle(f.file)} ${f.file}`,
        empty: t('results.noFiles'),
      },
      {
        titleExtra: helpButton('changes'),
        body: changed
          ? ''
          : `<p class="text-sm opacity-70">${t('results.noChanges')}</p>`,
      }
    ),
    listSection(
      t('results.groups'),
      {
        name: 'groups',
        items: r.groups,
        row: (g) => groupRow(ctx, g),
        searchText: groupLabel,
        empty: t('results.noGroups'),
      },
      { titleExtra: helpButton('renames') }
    )
  );
  sections.push(exportSection(ctx));
  if (r.issues.length > 0) {
    sections.push({
      title: t('results.issues'),
      body: `<ul class="list-disc pl-5 text-xs flex flex-col gap-1">${r.issues
        .map((i) => `<li class="break-words">${escapeHtml(issueText(i))}</li>`)
        .join('')}</ul>`,
    });
  }
  sections.push({
    body: `<p class="text-xs opacity-60">${t('compare.timings', {
      load: sec(r.timings.load),
      compare: sec(compareMs),
    })}</p>`,
  });
  return sections;
}

export function homePage(ctx: PageContext): TreePage {
  const status = renderCompareStatus(ctx.compare);
  return {
    eyebrow: t('crumb.comparison'),
    title: comparisonLabel(ctx.sources),
    sections: [
      { body: sourcesBody(ctx.sources) },
      ...(ctx.compare.status === 'done'
        ? resultSections(ctx, ctx.compare.result)
        : [{ body: status }]),
    ],
  };
}
