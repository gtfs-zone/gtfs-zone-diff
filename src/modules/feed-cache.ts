/**
 * The parsed feeds diff keeps in this browser ("Your feeds"), and how each
 * side's worker input reuses them. The diff worker saves and restores the
 * base files; this records them in the `ParseCache` index on the main thread.
 * Only the two feeds in use are kept.
 */

import { maybeProxy } from 'gtfs-zone-web-common/gtfs/feed-selection';
import {
  newBaseName,
  ParseCache,
  uploadKey,
  type CachedFeed,
} from 'gtfs-zone-web-common/gtfs/parse-cache';
import { CONFIG } from '../config';
import type {
  CompareInput,
  Side,
  SideExtra,
  SideStored,
} from '../engine/types';
import type { Source, Sources } from './sources';

export const parseCache = new ParseCache(CONFIG.PARSE_CACHE_APP);

/** What diff keeps in an entry's `extra`. */
interface EntryExtra extends SideExtra {
  /** A URL side's CORS proxy setting, for "Your feeds". */
  useCors?: boolean;
}

function entryExtra(entry: CachedFeed): EntryExtra | null {
  const extra = entry.extra as Partial<EntryExtra> | undefined;
  return extra?.loadedAt ? (extra as EntryExtra) : null;
}

/** The worker input for a source, or null when it cannot be loaded. */
export function compareInput(src: Source | null): CompareInput | null {
  const saveAs = newBaseName();
  switch (src?.kind) {
    case 'catalog':
    case 'url': {
      const url = maybeProxy(src.url, src.kind === 'catalog' || src.useCors);
      const known = parseCache.forUrl(url);
      const extra = known && entryExtra(known);
      return {
        saveAs,
        url,
        reuse:
          known && extra
            ? {
                base: known.id,
                extra,
                lastModified: known.lastModified,
                etag: known.etag,
              }
            : undefined,
      };
    }
    case 'file': {
      const known = parseCache.forUpload(src.file);
      const extra = known && entryExtra(known);
      return {
        saveAs,
        file: src.file,
        reuse: known && extra ? { base: known.id, extra } : undefined,
      };
    }
    case 'upload': {
      const known = parseCache.get(src.id);
      const extra = known && entryExtra(known);
      if (!known || !extra) {
        console.warn(`[FeedCache] ${src.id} is no longer stored`);
        return null;
      }
      return { saveAs, stored: { base: known.id, extra } };
    }
    default:
      return null;
  }
}

/** The entry fields that name where a side came from. */
function origin(
  src: Source
): Pick<CachedFeed, 'kind' | 'url' | 'sourceUrl' | 'uploadKey'> | null {
  switch (src.kind) {
    case 'catalog':
    case 'url': {
      const useCors = src.kind === 'catalog' || src.useCors;
      return {
        kind: 'url',
        url: maybeProxy(src.url, useCors),
        sourceUrl: src.url,
        uploadKey: '',
      };
    }
    case 'file':
      return {
        kind: 'upload',
        url: '',
        sourceUrl: '',
        uploadKey: uploadKey(src.file),
      };
    default:
      return null;
  }
}

/**
 * Record both sides once the worker has stored them, then drop every other
 * entry. Returns the entry id holding each side, or null when it was not
 * stored.
 */
export async function recordSides(
  sources: Sources,
  stored: Record<Side, SideStored>
): Promise<Record<Side, string | null>> {
  const ids: Record<Side, string | null> = { a: null, b: null };
  for (const side of ['a', 'b'] as const) {
    const src = sources[side];
    const s = stored[side];
    if (!src || src.kind === 'missing' || !s.base) {
      continue;
    }
    const label = src.label;
    const useCors =
      src.kind === 'catalog'
        ? true
        : src.kind === 'url'
          ? src.useCors
          : undefined;
    const extra: EntryExtra = { ...s.extra, useCors };
    const known = parseCache.get(s.base);
    if (s.restored && known) {
      const validators = s.validators ?? known;
      parseCache.add({
        ...known,
        label,
        lastModified: validators.lastModified,
        etag: validators.etag,
        lastOpened: Date.now(),
        extra,
      });
      ids[side] = known.id;
      continue;
    }
    const from = origin(src);
    if (!from) {
      continue;
    }
    const now = Date.now();
    parseCache.add({
      id: s.base,
      ...from,
      label,
      lastModified: s.validators?.lastModified ?? null,
      etag: s.validators?.etag ?? null,
      bytes: s.bytes,
      ...s.counts,
      savedAt: now,
      lastOpened: now,
      extra,
    });
    ids[side] = s.base;
  }
  await parseCache.keepOnly(
    [ids.a, ids.b].filter((id): id is string => id !== null)
  );
  console.log('[FeedCache] kept', ids);
  return ids;
}
