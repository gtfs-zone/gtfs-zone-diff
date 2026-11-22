/**
 * Row pairs as markup: a field table with A and B side by side, changed
 * text highlighted word by word (or character by character for single
 * tokens), foreign keys linked, and a trip's stop_times as one table.
 */

import { diffChars, diffWordsWithSpace } from 'diff';
import { entityLink } from 'gtfs-zone-web-common/gtfs/entity-render';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type { EntityStatus, FieldDiff, RecordDiff } from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import type { PageContext } from './page-context';
import { entityPage } from './result-text';

const DEL = 'bg-error/25 rounded-sm line-through decoration-error/60';
const INS = 'bg-success/25 rounded-sm no-underline';

const STATUS_BADGE: Record<EntityStatus, string> = {
  added: 'badge-success',
  removed: 'badge-error',
  changed: 'badge-warning',
  renamed: 'badge-info',
  followsRename: 'badge-info',
  formatting: 'badge-ghost',
  unchanged: 'badge-ghost',
};

export function entityStatusBadge(status: EntityStatus): string {
  return `<span class="badge badge-sm ${STATUS_BADGE[status]}">${escapeHtml(
    t(`status.${status}`)
  )}</span>`;
}

/** Row tint by status. */
const ROW_TINT: Record<EntityStatus, string> = {
  added: 'bg-success/10',
  removed: 'bg-error/10',
  changed: 'bg-warning/10',
  renamed: '',
  followsRename: '',
  formatting: '',
  unchanged: '',
};

function placeholder(key: 'field.noColumn' | 'field.empty'): string {
  return `<span class="opacity-40">(${escapeHtml(t(key))})</span>`;
}

/** A value as text, or a link when it names an entity. */
function value(
  ctx: PageContext,
  v: string | null,
  ref: FieldDiff['ref']
): string {
  if (v === null) {
    return placeholder('field.noColumn');
  }
  if (v === '') {
    return placeholder('field.empty');
  }
  return ref
    ? entityLink<PageLocation>(ctx, entityPage(ref, v), v)
    : escapeHtml(v);
}

/** Both values with their differing parts marked. */
function inlineDiff(a: string, b: string): { a: string; b: string } {
  const parts =
    /\s/.test(a) || /\s/.test(b) ? diffWordsWithSpace(a, b) : diffChars(a, b);
  let ha = '';
  let hb = '';
  for (const p of parts) {
    const v = escapeHtml(p.value);
    if (p.added) {
      hb += `<ins class="${INS}">${v}</ins>`;
    } else if (p.removed) {
      ha += `<del class="${DEL}">${v}</del>`;
    } else {
      ha += v;
      hb += v;
    }
  }
  return { a: ha, b: hb };
}

/** A and B cells of a differing field. */
function cells(ctx: PageContext, f: FieldDiff): { a: string; b: string } {
  if (f.cell === 'changed' && !f.ref && f.a && f.b) {
    return inlineDiff(f.a, f.b);
  }
  return { a: value(ctx, f.a, f.ref), b: value(ctx, f.b, f.ref) };
}

function note(f: FieldDiff): string {
  if (f.cell === 'formatting') {
    return t('field.formatting');
  }
  if (f.cell === 'renamed') {
    return t('field.renamed');
  }
  return '';
}

function fieldName(f: FieldDiff): string {
  const n = note(f);
  return `<td class="align-top font-mono opacity-60 whitespace-nowrap">${escapeHtml(f.name)}${
    n
      ? `<span class="block font-sans text-[10px] opacity-80">${escapeHtml(n)}</span>`
      : ''
  }</td>`;
}

function fieldRow(ctx: PageContext, f: FieldDiff): string {
  if (f.cell === 'equal') {
    return `<tr>${fieldName(f)}<td class="break-all" colspan="2">${value(ctx, f.a, f.ref)}</td></tr>`;
  }
  const c = cells(ctx, f);
  const tint = f.cell === 'changed' ? ' class="bg-warning/10"' : '';
  return `<tr${tint}>${fieldName(f)}<td class="break-all align-top">${c.a}</td><td class="break-all align-top">${c.b}</td></tr>`;
}

/** One side's row, for a record only in A or only in B. */
function sideTable(ctx: PageContext, rec: RecordDiff, side: 'a' | 'b'): string {
  const rows = rec.fields
    .map(
      (f) =>
        `<tr>${fieldName(f)}<td class="break-all">${value(ctx, f[side], f.ref)}</td></tr>`
    )
    .join('');
  return `<table class="table table-xs ${ROW_TINT[rec.status]}"><tbody>${rows}</tbody></table>`;
}

/**
 * A record's fields: differing ones in a three-column table, equal ones
 * folded below, or the one side's row when the other has none.
 */
export function recordTable(ctx: PageContext, rec: RecordDiff): string {
  if (rec.status === 'added') {
    return sideTable(ctx, rec, 'b');
  }
  if (rec.status === 'removed') {
    return sideTable(ctx, rec, 'a');
  }
  const differ = rec.fields.filter((f) => f.cell !== 'equal');
  const equal = rec.fields.filter((f) => f.cell === 'equal');
  const head = `<thead><tr><th>${escapeHtml(t('field.name'))}</th><th>A</th><th>B</th></tr></thead>`;
  const table =
    differ.length > 0
      ? `<table class="table table-xs">${head}<tbody>${differ
          .map((f) => fieldRow(ctx, f))
          .join('')}</tbody></table>`
      : `<p class="text-xs opacity-70">${escapeHtml(t('field.allEqual'))}</p>`;
  const folded =
    equal.length > 0
      ? `<details class="text-xs"${differ.length === 0 ? ' open' : ''}>
          <summary class="cursor-pointer opacity-70">${escapeHtml(
            t('field.unchanged', { count: equal.length })
          )}</summary>
          <table class="table table-xs mt-1"><tbody>${equal
            .map((f) => fieldRow(ctx, f))
            .join('')}</tbody></table>
        </details>`
      : '';
  return `<div class="flex flex-col gap-2">${table}${folded}</div>`;
}

// ---------- stop_times ----------

const ST_MAIN = new Set([
  'stop_sequence',
  'stop_id',
  'arrival_time',
  'departure_time',
]);

function field(rec: RecordDiff, name: string): FieldDiff | undefined {
  return rec.fields.find((f) => f.name === name);
}

/** One cell of the stop_times table: the value, or "A -> B" when it differs. */
function stCell(ctx: PageContext, rec: RecordDiff, name: string): string {
  const f = field(rec, name);
  if (!f) {
    return '';
  }
  if (rec.status === 'added' || rec.status === 'removed') {
    return value(ctx, rec.status === 'added' ? f.b : f.a, f.ref);
  }
  if (f.cell === 'equal') {
    return value(ctx, f.a, f.ref);
  }
  const c = cells(ctx, f);
  return `${c.a} -&gt; ${c.b}`;
}

/** Other differing stop_times fields of a row, as "name: A -> B" lines. */
function stExtra(ctx: PageContext, rec: RecordDiff): string {
  if (rec.status === 'added' || rec.status === 'removed') {
    return '';
  }
  return rec.fields
    .filter((f) => !ST_MAIN.has(f.name) && f.cell !== 'equal')
    .map((f) => {
      const c = cells(ctx, f);
      return `<span class="block opacity-70"><span class="font-mono">${escapeHtml(
        f.name
      )}</span>: ${c.a} -&gt; ${c.b}</span>`;
    })
    .join('');
}

export function stopTimesTable(
  ctx: PageContext,
  records: RecordDiff[]
): string {
  if (records.length === 0) {
    return `<p class="text-xs opacity-70">${escapeHtml(t('entity.noStopTimes'))}</p>`;
  }
  const rows = records
    .map((rec) => {
      const status =
        rec.status === 'unchanged'
          ? ''
          : ` title="${escapeHtml(t(`status.${rec.status}`))}"`;
      return `<tr class="${ROW_TINT[rec.status]}"${status}>
        <td class="align-top tabular-nums">${stCell(ctx, rec, 'stop_sequence')}</td>
        <td class="align-top break-all">${stCell(ctx, rec, 'stop_id')}${stExtra(ctx, rec)}</td>
        <td class="align-top tabular-nums whitespace-nowrap">${stCell(ctx, rec, 'arrival_time')}</td>
        <td class="align-top tabular-nums whitespace-nowrap">${stCell(ctx, rec, 'departure_time')}</td>
      </tr>`;
    })
    .join('');
  return `<div class="overflow-x-auto"><table class="table table-xs">
    <thead><tr>
      <th>${escapeHtml(t('stopTimes.sequence'))}</th>
      <th>${escapeHtml(t('stopTimes.stop'))}</th>
      <th>${escapeHtml(t('stopTimes.arrival'))}</th>
      <th>${escapeHtml(t('stopTimes.departure'))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}
