/**
 * Loads one side into a FeedStore, and reads its zip central directory from
 * the tail of the same stream, so a URL is downloaded once.
 */

import { streamGtfsZip } from 'gtfs-zone-web-common/gtfs/store/csv-stream';
import { FeedStore } from 'gtfs-zone-web-common/gtfs/store/feed-store';
import {
  readZipIndex,
  type ZipByteReader,
  type ZipEntryInfo,
} from 'gtfs-zone-web-common/util/zip-index';
import type { LoadedSide } from './pair';

/** Bytes kept from the end of the archive; the central directory must fit. */
const TAIL_BYTES = 4 << 20;

/** The last bytes of a stream, as a reader over the whole archive's offsets. */
class Tail {
  private chunks: Uint8Array[] = [];
  private kept = 0;
  total = 0;

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.kept += chunk.length;
    this.total += chunk.length;
    while (
      this.chunks.length > 1 &&
      this.kept - this.chunks[0].length >= TAIL_BYTES
    ) {
      this.kept -= this.chunks.shift()!.length;
    }
  }

  reader(): ZipByteReader {
    const bytes = new Uint8Array(this.kept);
    let at = 0;
    for (const c of this.chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    const start = this.total - bytes.length;
    return {
      size: this.total,
      read: async (offset, length) => {
        if (offset < start) {
          throw new Error('[load] central directory is not in the kept tail');
        }
        return bytes.subarray(offset - start, offset - start + length);
      },
    };
  }
}

export interface SideSource {
  stream: ReadableStream<Uint8Array>;
  /** Nested archive path, one per level (`a.zip#b.zip`). */
  innerPaths: string[];
  /** The archive itself, when local; its index is read from it directly. */
  blob?: Blob;
  onBytes?: (read: number) => void;
  onTable?: (table: string) => void;
}

/** Entries by name; a nested archive's index is not read. */
async function zipIndex(
  src: SideSource,
  tail: Tail
): Promise<Map<string, ZipEntryInfo> | null> {
  if (src.innerPaths.length > 0) {
    return null;
  }
  try {
    const entries = await readZipIndex(src.blob ?? tail.reader());
    const out = new Map<string, ZipEntryInfo>();
    for (const e of entries) {
      if (!e.isDirectory) {
        // Tables are matched by base name, as the parser does.
        out.set(e.name.split('/').pop()!, e);
      }
    }
    return out;
  } catch (err) {
    console.warn(
      '[load] zip index unreadable; files compared by rows only',
      err
    );
    return null;
  }
}

export async function loadSide(src: SideSource): Promise<LoadedSide> {
  const store = new FeedStore({ stopTimes: 'full' });
  const tail = new Tail();
  const tee = src.blob
    ? src.stream
    : src.stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            tail.push(chunk);
            ctl.enqueue(chunk);
          },
        })
      );
  let lastTable = '';
  const stream = await streamGtfsZip(tee, store.sinkFor, {
    innerPaths: src.innerPaths,
    trim: true,
    onOtherFile: store.addFile,
    onBytes: src.onBytes,
    onTableBytes: (table) => {
      if (table !== lastTable) {
        lastTable = table;
        src.onTable?.(table);
      }
    },
  });
  store.finish();
  const zip = await zipIndex(src, tail);
  return { store, stream, zip };
}
