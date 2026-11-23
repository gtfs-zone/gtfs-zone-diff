/**
 * The diff worker: loads both feeds, one after the other, into this one
 * worker, compares them, then serves paged reads of the details. Terminating
 * the worker is what frees both feeds.
 */

import { splitInnerZipPath } from 'gtfs-zone-web-common/gtfs/feed-url-resolve';
import {
  describeHttpError,
  describeNetworkError,
} from 'gtfs-zone-web-common/gtfs/feed-selection';
import { compare, type Comparison } from './compare';
import { loadSide, type SideSource } from './load';
import type {
  CompareInput,
  CompareOptions,
  CompareProgress,
  DiffResult,
  Side,
} from './types';

export type DiffRequest =
  | {
      type: 'compare';
      a: CompareInput;
      b: CompareInput;
      options: CompareOptions;
    }
  | { type: 'call'; id: number; method: keyof DiffApi; args: unknown[] };

export type DiffReply =
  | { type: 'progress'; progress: CompareProgress }
  | { type: 'done'; result: DiffResult }
  | { type: 'failed'; side: Side | null; message: string }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'call-error'; id: number; message: string };

let comparison: Comparison | null = null;

const api = {
  groupItems: (...args: Parameters<Comparison['groupItems']>) =>
    requireComparison().groupItems(...args),
  rowChanges: (...args: Parameters<Comparison['rowChanges']>) =>
    requireComparison().rowChanges(...args),
  entity: (...args: Parameters<Comparison['entity']>) =>
    requireComparison().entity(...args),
  mapGeometry: (...args: Parameters<Comparison['mapGeometry']>) =>
    requireComparison().mapGeometry(...args),
};

export type DiffApi = typeof api;

function requireComparison(): Comparison {
  if (!comparison) {
    throw new Error('[DiffWorker] no comparison yet');
  }
  return comparison;
}

const post = (msg: DiffReply): void =>
  (self as unknown as Worker).postMessage(msg);

const PROGRESS_INTERVAL_MS = 100;

/** Load progress for one side, at most every PROGRESS_INTERVAL_MS. */
function progressHooks(
  side: Side,
  total: number | null
): Pick<SideSource, 'onBytes' | 'onTable'> {
  let last = 0;
  let bytes = 0;
  const emit = (table?: string): void => {
    const now = performance.now();
    if (table !== undefined || now - last >= PROGRESS_INTERVAL_MS) {
      last = now;
      post({
        type: 'progress',
        progress: { stage: 'load', side, bytes, total, table },
      });
    }
  };
  return {
    onBytes: (read) => {
      bytes = read;
      emit();
    },
    onTable: (table) => emit(table),
  };
}

async function open(input: CompareInput, side: Side): Promise<SideSource> {
  if ('file' in input) {
    console.log(`[DiffWorker] ${side}: reading ${input.file.name}`);
    return {
      stream: input.file.stream(),
      innerPaths: [],
      blob: input.file,
      ...progressHooks(side, input.file.size),
    };
  }
  const { url, innerPaths } = splitInnerZipPath(input.url);
  console.log(`[DiffWorker] ${side}: fetching ${url}`);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(describeNetworkError(url, err), { cause: err });
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(describeHttpError(url, res.status, res.statusText, body));
  }
  const len = res.headers.get('Content-Length');
  return {
    stream: res.body,
    innerPaths,
    ...progressHooks(side, len ? Number(len) : null),
  };
}

async function run(
  msg: Extract<DiffRequest, { type: 'compare' }>
): Promise<void> {
  if (comparison) {
    throw new Error('[DiffWorker] already compared; use a new worker');
  }
  const t0 = performance.now();
  const loaded = [];
  for (const side of ['a', 'b'] as const) {
    try {
      loaded.push(await loadSide(await open(msg[side], side)));
    } catch (err) {
      console.error(`[DiffWorker] ${side}: load failed`, err);
      post({
        type: 'failed',
        side,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }
  const t1 = performance.now();
  comparison = compare(loaded[0], loaded[1], msg.options, (progress) =>
    post({ type: 'progress', progress })
  );
  comparison.result.timings.load = Math.round(t1 - t0);
  post({ type: 'done', result: comparison.result });
}

self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const msg = event.data;
  if (msg.type === 'compare') {
    run(msg).catch((err: unknown) => {
      console.error('[DiffWorker] compare failed', err);
      post({
        type: 'failed',
        side: null,
        message: err instanceof Error ? err.message : String(err),
      });
    });
    return;
  }
  try {
    const fn = api[msg.method] as (...a: unknown[]) => unknown;
    post({ type: 'result', id: msg.id, value: fn(...msg.args) });
  } catch (err) {
    post({
      type: 'call-error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
