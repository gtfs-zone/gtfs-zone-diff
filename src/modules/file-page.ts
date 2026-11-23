/** One file: how it differs, row counts, and which columns changed. */

import {
  entityLink,
  prop,
  propList,
} from 'gtfs-zone-web-common/gtfs/entity-render';
import { entityRow } from 'gtfs-zone-web-common/gtfs/entity-row';
import {
  listSection,
  type TreePage,
  type TreeSection,
} from 'gtfs-zone-web-common/gtfs/tree-page';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type { FileDiff, RowChange, RowChangeKind } from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import type { DiffSession } from './diff-client';
import { doneResult, waitingPage, type PageContext } from './page-context';
import {
  changedFieldsTable,
  entityStatusBadge,
  rowValuesLine,
} from './record-view';
import {
  entityPage,
  fileTitle,
  fmt,
  headerLine,
  statusBadge,
} from './result-text';

type Key = Parameters<typeof t>[0];

function countRows(rows: [Key, number][]): string {
  return propList(
    rows
      .filter(([, n]) => n > 0)
      .map(([key, n]) => prop(t(key), escapeHtml(fmt(n))))
  );
}

interface ColumnCount {
  column: string;
  changed: number;
  formatting: number;
}

function columnCounts(f: FileDiff): ColumnCount[] {
  const names = new Set([
    ...Object.keys(f.changedCells),
    ...Object.keys(f.formattingCells),
  ]);
  return [...names]
    .map((column) => ({
      column,
      changed: f.changedCells[column] ?? 0,
      formatting: f.formattingCells[column] ?? 0,
    }))
    .sort((x, y) => y.changed - x.changed || y.formatting - x.formatting);
}

function columnSublabel(c: ColumnCount): string {
  const parts: string[] = [];
  if (c.changed > 0) {
    parts.push(t('results.changed', { count: c.changed }));
  }
  if (c.formatting > 0) {
    parts.push(t('results.formatting', { count: c.formatting }));
  }
  return parts.join(', ');
}

const ROW_KINDS: readonly RowChangeKind[] = [
  'added',
  'removed',
  'changed',
  'renamed',
  'followsRename',
  'formatting',
];

/** Rows searched on their text only when a full read stays small. */
const SEARCH_MAX = 2000;

function isRowKind(kind: string | undefined): kind is RowChangeKind {
  return (ROW_KINDS as readonly string[]).includes(kind ?? '');
}

/** "All" and one tab per kind present, each a link to the filtered page. */
function kindTabs(
  ctx: PageContext,
  f: FileDiff,
  kind: RowChangeKind | undefined
): string {
  const total = ROW_KINDS.reduce((n, k) => n + (f.records[k] ?? 0), 0);
  const tab = (
    k: RowChangeKind | undefined,
    label: string,
    n: number
  ): string =>
    entityLink<PageLocation>(
      ctx,
      k
        ? { type: 'file', file: f.file, kind: k }
        : { type: 'file', file: f.file },
      `${label} ${fmt(n)}`,
      `tab whitespace-nowrap${k === kind ? ' tab-active' : ''}`
    );
  const tabs = ROW_KINDS.filter((k) => (f.records[k] ?? 0) > 0).map((k) =>
    tab(k, t(`file.count.${k}`), f.records[k] ?? 0)
  );
  if (tabs.length < 2) {
    return '';
  }
  return `<div role="tablist" class="tabs tabs-box tabs-xs flex-wrap">${tab(
    undefined,
    t('file.rows.all'),
    total
  )}${tabs.join('')}</div>`;
}

/** Row counts per kind of a trip or shape record, as one line. */
function rowsLine(rows: RowChange['rows']): string {
  return ROW_KINDS.filter((k) => (rows?.[k] ?? 0) > 0)
    .map((k) => `${t(`file.count.${k}`)} ${fmt(rows![k]!)}`)
    .join(', ');
}

/** One differing row: its status and key, then what differs. */
function changeRow(ctx: PageContext, c: RowChange): string {
  const page = c.owner ? entityPage(c.owner.kind, c.owner.id) : null;
  if (c.rows) {
    return entityRow<PageLocation>(ctx, {
      state: page ?? undefined,
      label: c.key,
      sublabel: rowsLine(c.rows),
      badgeHtml: entityStatusBadge(c.kind),
    });
  }
  const key = c.key || t('file.rows.noKey');
  const label = page
    ? entityLink<PageLocation>(ctx, page, key)
    : escapeHtml(key);
  const body =
    c.kind === 'added'
      ? rowValuesLine(ctx, c.fields, 'b')
      : c.kind === 'removed'
        ? rowValuesLine(ctx, c.fields, 'a')
        : changedFieldsTable(ctx, c.fields);
  return `<li class="py-2 px-2 border-b border-base-200 space-y-1 text-xs">
    <div class="flex items-center gap-2">${entityStatusBadge(c.kind)}<span class="font-mono break-all">${label}</span></div>
    ${body}
  </li>`;
}

function rowsTitle(f: FileDiff): string {
  if (f.match === 'stop_times') {
    return t('file.rows.trips');
  }
  if (f.match === 'shapes') {
    return t('file.rows.shapes');
  }
  return t('file.rows');
}

function rowsSection(
  ctx: PageContext,
  session: DiffSession,
  f: FileDiff,
  kind: RowChangeKind | undefined
): TreeSection {
  const count = kind
    ? (f.records[kind] ?? 0)
    : ROW_KINDS.reduce((n, k) => n + (f.records[k] ?? 0), 0);
  return listSection(
    rowsTitle(f),
    {
      name: `rows ${f.file} ${kind ?? 'all'}`,
      items: {
        count,
        page: (start, end) =>
          session.call('rowChanges', f.file, start, end - start, kind),
      },
      row: (c) => changeRow(ctx, c),
      searchText:
        count <= SEARCH_MAX
          ? (c) =>
              `${c.key} ${c.fields.map((x) => `${x.a ?? ''} ${x.b ?? ''}`).join(' ')}`
          : undefined,
      empty: t('file.rows.empty'),
    },
    { body: kindTabs(ctx, f, kind) }
  );
}

export function filePage(
  ctx: PageContext,
  file: string,
  kindParam?: string
): TreePage {
  const head = { eyebrow: t('crumb.file'), title: fileTitle(file), id: file };
  const done = doneResult(ctx);
  if (!done) {
    return waitingPage(ctx, head);
  }
  const f = done.result.files.find((x) => x.file === file);
  const kind = isRowKind(kindParam) ? kindParam : undefined;
  if (!f) {
    return {
      ...head,
      sections: [
        { body: `<p class="text-sm opacity-70">${t('file.notInEither')}</p>` },
      ],
    };
  }
  const g = f.grouped;
  const header = headerLine(f);
  return {
    ...head,
    titleExtra: statusBadge(f.status),
    sections: [
      {
        body: propList([
          prop(t('file.match'), escapeHtml(t(`file.match.${f.match}`))),
          f.keyFields.length > 0
            ? prop(
                t('file.key'),
                `<span class="font-mono">${escapeHtml(f.keyFields.join(', '))}</span>`
              )
            : '',
          prop(t('file.bytes'), escapeHtml(t(`file.bytes.${f.bytes}`))),
          header ? prop(t('file.columns'), escapeHtml(header)) : '',
          f.padded.a + f.padded.b > 0
            ? prop(
                t('file.padded'),
                escapeHtml(
                  t('file.paddedValue', {
                    a: f.padded.a,
                    b: f.padded.b,
                  })
                )
              )
            : '',
        ]),
      },
      {
        title: t('file.grouped'),
        body: countRows([
          ['file.count.added', g.added],
          ['file.count.removed', g.removed],
          ['file.count.changed', g.changed],
          ['file.count.renamed', g.renamed],
          ['file.count.followsRename', g.followsRename],
          ['file.count.formatting', g.formatting],
          ['file.count.unchanged', g.unchanged],
        ]),
      },
      ...(f.table ? [rowsSection(ctx, done.session, f, kind)] : []),
      {
        title: t('file.raw'),
        body: `<p class="text-xs opacity-60">${t('file.rawNote')}</p>${countRows(
          [
            ['file.count.added', f.raw.added],
            ['file.count.removed', f.raw.removed],
            ['file.count.changed', f.raw.changed],
            ['file.count.unchanged', f.raw.unchanged],
          ]
        )}`,
      },
      listSection(t('file.changedColumns'), {
        name: `columns ${file}`,
        items: columnCounts(f),
        row: (c) =>
          entityRow<PageLocation>(ctx, {
            label: c.column,
            sublabel: columnSublabel(c),
          }),
        searchText: (c) => c.column,
        empty: t('file.noChangedColumns'),
      }),
    ],
  };
}
