/**
 * The diff worker: loads both feeds, one after the other, into this one
 * worker, compares them, then serves paged reads of the details. Terminating
 * the worker is what frees both feeds.
 *
 * A side is restored from a stored base when its input names one that still
 * applies; otherwise it is parsed, and saved as a new base once the
 * comparison is done, so a refresh restores it.
 */

import { splitInnerZipPath } from 'gtfs-zone-web-common/gtfs/feed-url-resolve';
import {
  describeHttpError,
  describeNetworkError,
} from 'gtfs-zone-web-common/gtfs/feed-selection';
import {
  responseValidators,
  saveBaseFile,
  validatorsMatch,
} from 'gtfs-zone-web-common/gtfs/store/opfs-base';
import { isQuotaError } from 'gtfs-zone-web-common/util/storage';
import { compare, type Comparison } from './compare';
import { loadSide, restoreSide, sideExtra, type SideSource } from './load';
import type { LoadedSide } from './pair';
import type {
  CompareInput,
  CompareOptions,
  CompareProgress,
  DiffResult,
  Side,
  SideStored,
  StoredBase,
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
  | { type: 'stored'; sides: Record<Side, SideStored> }
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
  searchIndex: () => requireComparison().searchIndex(),
  exportV2: (...args: Parameters<Comparison['exportV2']>) =>
    requireComparison().exportV2(...args),
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

/** A side loaded, and the base it was restored from, if any. */
interface Loaded {
  side: LoadedSide;
  restored: string | null;
  validators: SideStored['validators'];
}

/** Restore a stored base, posting a progress step for it. */
async function restore(stored: StoredBase, side: Side): Promise<Loaded> {
  console.log(`[DiffWorker] ${side}: restoring ${stored.base}`);
  post({
    type: 'progress',
    progress: { stage: 'load', side, bytes: 0, total: null },
  });
  return {
    side: await restoreSide(stored),
    restored: stored.base,
    validators: null,
  };
}

/** Restore a base the input offers, or null when it cannot be read. */
async function tryRestore(
  stored: StoredBase,
  side: Side
): Promise<Loaded | null> {
  try {
    return await restore(stored, side);
  } catch (err) {
    console.warn(`[DiffWorker] ${side}: ${stored.base} unusable; parsing`, err);
    return null;
  }
}

async function fetchSide(
  url: string
): Promise<{ res: Response; body: ReadableStream<Uint8Array> }> {
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
  return { res, body: res.body };
}

async function load(input: CompareInput, side: Side): Promise<Loaded> {
  if ('stored' in input) {
    return restore(input.stored, side);
  }
  if ('file' in input) {
    const reused = input.reuse && (await tryRestore(input.reuse, side));
    if (reused) {
      return reused;
    }
    console.log(`[DiffWorker] ${side}: reading ${input.file.name}`);
    const loaded = await loadSide({
      stream: input.file.stream(),
      innerPaths: [],
      blob: input.file,
      ...progressHooks(side, input.file.size),
    });
    return { side: loaded, restored: null, validators: null };
  }
  const { url, innerPaths } = splitInnerZipPath(input.url);
  console.log(`[DiffWorker] ${side}: fetching ${url}`);
  let { res, body } = await fetchSide(url);
  const validators = responseValidators(res);
  if (input.reuse && validatorsMatch(input.reuse, validators)) {
    await body
      .cancel()
      .catch((e: unknown) => console.warn('[DiffWorker] cancel failed', e));
    console.log(`[DiffWorker] ${side}: ${url} unchanged`);
    const reused = await tryRestore(input.reuse, side);
    if (reused) {
      return { ...reused, validators };
    }
    ({ res, body } = await fetchSide(url));
  }
  const len = res.headers.get('Content-Length');
  const loaded = await loadSide({
    stream: body,
    innerPaths,
    ...progressHooks(side, len ? Number(len) : null),
  });
  return { side: loaded, restored: null, validators: responseValidators(res) };
}

/** Save a parsed side as `saveAs`, or report the base it was restored from. */
async function keep(input: CompareInput, loaded: Loaded): Promise<SideStored> {
  const c = loaded.side.store.counts();
  const out: SideStored = {
    base: loaded.restored,
    restored: loaded.restored !== null,
    bytes: 0,
    validators: loaded.validators,
    counts: { routes: c.routes ?? 0, stops: c.stops ?? 0, trips: c.trips ?? 0 },
    extra: sideExtra(loaded.side),
    error: null,
  };
  if (loaded.restored) {
    return out;
  }
  try {
    out.bytes = await saveBaseFile(
      loaded.side.store,
      loaded.side.stream,
      input.saveAs
    );
    out.base = input.saveAs;
  } catch (err) {
    console.error(`[DiffWorker] saving ${input.saveAs} failed`, err);
    out.error = {
      message: err instanceof Error ? err.message : String(err),
      quota: isQuotaError(err),
    };
  }
  return out;
}

async function run(
  msg: Extract<DiffRequest, { type: 'compare' }>
): Promise<void> {
  if (comparison) {
    throw new Error('[DiffWorker] already compared; use a new worker');
  }
  const t0 = performance.now();
  const loaded: Loaded[] = [];
  for (const side of ['a', 'b'] as const) {
    try {
      loaded.push(await load(msg[side], side));
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
  comparison = compare(
    loaded[0].side,
    loaded[1].side,
    msg.options,
    (progress) => post({ type: 'progress', progress })
  );
  comparison.result.timings.load = Math.round(t1 - t0);
  post({ type: 'done', result: comparison.result });
  // Saved after the result is shown; reads queue behind it meanwhile.
  const a = await keep(msg.a, loaded[0]);
  const b = await keep(msg.b, loaded[1]);
  post({ type: 'stored', sides: { a, b } });
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
