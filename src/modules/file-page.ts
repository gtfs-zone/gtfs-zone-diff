/** One file: how it differs, row counts, and which columns changed. */

import { prop, propList } from 'gtfs-zone-web-common/gtfs/entity-render';
import { entityRow } from 'gtfs-zone-web-common/gtfs/entity-row';
import {
  listSection,
  type TreePage,
} from 'gtfs-zone-web-common/gtfs/tree-page';
import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';
import type { FileDiff } from '../engine/types';
import { t } from '../i18n/messages';
import type { PageLocation } from '../types/page-state';
import { doneResult, waitingPage, type PageContext } from './page-context';
import { fileTitle, fmt, headerLine, statusBadge } from './result-text';

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

export function filePage(ctx: PageContext, file: string): TreePage {
  const head = { eyebrow: t('crumb.file'), title: fileTitle(file), id: file };
  const done = doneResult(ctx);
  if (!done) {
    return waitingPage(ctx, head);
  }
  const f = done.result.files.find((x) => x.file === file);
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
