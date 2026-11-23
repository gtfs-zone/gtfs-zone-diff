/**
 * Export downloads: GTFS Diff v2 JSON, built in the worker, and a markdown
 * summary built here from the result and the first items of each group.
 */

import { t } from '../i18n/messages';
import type { DiffResult, Side } from '../engine/types';
import type { DiffSession } from './diff-client';
import { itemRow } from './group-page';
import {
  comparisonLabel,
  fileCounts,
  fileTitle,
  groupCount,
  groupLabel,
  headerLine,
  issueText,
} from './result-text';
import { SIDES, type Source, type Sources } from './sources';

const CAP_KEY = 'gtfs-zone-diff.exportCap';
/** Items listed per group in the summary. */
const SUMMARY_ITEMS = 20;

/** The stored row cap per file, or null for every row. */
export function exportCap(): number | null {
  try {
    const v = localStorage.getItem(CAP_KEY);
    return v === null || v === '' ? null : Math.max(0, Math.floor(Number(v)));
  } catch {
    return null;
  }
}

export function setExportCap(raw: string): void {
  const n = raw.trim() === '' ? NaN : Number(raw);
  try {
    if (Number.isFinite(n) && n >= 0) {
      localStorage.setItem(CAP_KEY, String(Math.floor(n)));
    } else {
      localStorage.removeItem(CAP_KEY);
    }
  } catch {
    // Storage blocked: the cap applies to this export only.
  }
}

/** How a source is named in an export: its URL, or the file's name. */
function sourceName(src: Source | null): string {
  switch (src?.kind) {
    case 'catalog':
    case 'url':
      return src.url;
    case 'file':
      return src.file.name;
    case 'missing':
      return src.feedId;
    default:
      return '';
  }
}

function slug(src: Source | null): string {
  const name = !src ? '' : src.kind === 'missing' ? src.feedId : src.label;
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'feed'
  );
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A markdown table cell: one line, pipes escaped. */
function cell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

async function summaryMarkdown(
  result: DiffResult,
  session: DiffSession,
  sources: Sources
): Promise<string> {
  const out: string[] = [`# ${comparisonLabel(sources)}`, ''];
  for (const side of SIDES) {
    const src = sources[side];
    const s = result.sides[side];
    const name = sourceName(src);
    const label = src && src.kind !== 'missing' ? src.label : name;
    out.push(
      `## ${t(side === 'a' ? 'home.sideA' : 'home.sideB')}: ${label}`,
      ''
    );
    if (name && name !== label) {
      out.push(`- ${name}`);
    }
    if (s.window) {
      out.push(
        `- ${t('summary.window', { start: s.window.start, end: s.window.end })}`
      );
    }
    if (s.agencies.length > 0) {
      out.push(`- ${t('summary.agencies', { names: s.agencies.join(', ') })}`);
    }
    out.push('');
  }
  if (!result.completeness.ok) {
    out.push(`> ${t('compare.incomplete')}`, '');
  }

  const changed = result.files.filter((f) => f.status !== 'identical');
  const identical = result.files.length - changed.length;
  out.push(`## ${t('results.files')}`, '');
  if (changed.length === 0) {
    out.push(t('results.noChanges'), '');
  } else {
    out.push(
      `| ${t('summary.file')} | ${t('summary.status')} | ${t('summary.changes')} |`,
      '| --- | --- | --- |'
    );
    for (const f of changed) {
      const changes = [fileCounts(f), headerLine(f)].filter(Boolean).join('; ');
      out.push(
        `| ${cell(fileTitle(f.file))} (\`${f.file}\`) | ${t(
          `results.status.${f.status}`
        )} | ${cell(changes)} |`
      );
    }
    out.push('');
    if (identical > 0) {
      out.push(t('summary.identical', { count: identical }), '');
    }
  }

  if (result.groups.length > 0) {
    out.push(`## ${t('results.groups')}`, '');
    for (const g of result.groups) {
      out.push(`### ${groupLabel(g)} (${groupCount(g)})`, '');
      const items = await session.call('groupItems', g.id, 0, SUMMARY_ITEMS);
      for (const item of items) {
        const row = itemRow(g, item);
        out.push(`- ${row.label}${row.sublabel ? `: ${row.sublabel}` : ''}`);
      }
      if (g.count > items.length) {
        out.push(`- ${t('summary.more', { count: g.count - items.length })}`);
      }
      out.push('');
    }
  }

  if (result.issues.length > 0) {
    out.push(`## ${t('results.issues')}`, '');
    for (const i of result.issues) {
      out.push(`- ${issueText(i)}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** Builds one export and downloads it. */
export async function runExport(
  kind: 'v2' | 'summary',
  result: DiffResult,
  session: DiffSession,
  sources: Sources
): Promise<void> {
  const base = `gtfs-diff-${slug(sources.a)}-vs-${slug(sources.b)}`;
  const t0 = performance.now();
  if (kind === 'v2') {
    const names = Object.fromEntries(
      SIDES.map((side) => [side, sourceName(sources[side])])
    ) as Record<Side, string>;
    const blob = await session.call('exportV2', {
      cap: exportCap(),
      sources: names,
    });
    download(blob, `${base}.json`);
    console.log(
      `[export] v2: ${blob.size} bytes in ${Math.round(performance.now() - t0)} ms`
    );
  } else {
    const text = await summaryMarkdown(result, session, sources);
    download(
      new Blob([text], { type: 'text/markdown;charset=utf-8' }),
      `${base}.md`
    );
    console.log(`[export] summary: ${text.length} characters`);
  }
}
