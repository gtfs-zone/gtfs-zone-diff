/**
 * Main-thread handle on one comparison. Each run gets a new diff worker;
 * `release` terminates it, which frees both feeds.
 */

import type { DiffApi, DiffReply, DiffRequest } from '../engine/diff.worker';
import type {
  CompareInput,
  CompareOptions,
  CompareProgress,
  DiffResult,
  Side,
  SideStored,
} from '../engine/types';

export class CompareFailedError extends Error {
  constructor(
    readonly side: Side | null,
    message: string
  ) {
    super(message);
    this.name = 'CompareFailedError';
  }
}

export class DiffSession {
  private worker = new Worker(
    new URL('../engine/diff.worker.ts', import.meta.url),
    {
      type: 'module',
    }
  );
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private released = false;
  /** Resolves with the result once both feeds are loaded and compared. */
  readonly done: Promise<DiffResult>;

  constructor(
    a: CompareInput,
    b: CompareInput,
    options: CompareOptions,
    onProgress: (p: CompareProgress) => void,
    onStored: (sides: Record<Side, SideStored>) => void
  ) {
    this.done = new Promise<DiffResult>((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<DiffReply>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            onProgress(msg.progress);
            break;
          case 'done':
            console.log('[DiffSession] compared', msg.result.timings);
            resolve(msg.result);
            break;
          case 'stored':
            onStored(msg.sides);
            break;
          case 'failed':
            reject(new CompareFailedError(msg.side, msg.message));
            break;
          case 'result':
          case 'call-error': {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.type === 'result') {
              p?.resolve(msg.value);
            } else {
              p?.reject(new Error(msg.message));
            }
            break;
          }
        }
      };
      this.worker.onerror = (e) => {
        // A worker killed for memory reports no message.
        reject(
          new CompareFailedError(
            null,
            e.message ||
              'The comparison stopped without an error (it ran out of memory, or failed to start).'
          )
        );
      };
    });
    const req: DiffRequest = { type: 'compare', a, b, options };
    this.worker.postMessage(req);
    console.log('[DiffSession] started');
  }

  call<K extends keyof DiffApi>(
    method: K,
    ...args: Parameters<DiffApi[K]>
  ): Promise<ReturnType<DiffApi[K]>> {
    if (this.released) {
      return Promise.reject(new Error(`[DiffSession] ${method} after release`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const req: DiffRequest = { type: 'call', id, method, args };
      this.worker.postMessage(req);
    });
  }

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      p.reject(new Error('[DiffSession] released'));
    }
    this.pending.clear();
    console.log('[DiffSession] released');
  }
}
