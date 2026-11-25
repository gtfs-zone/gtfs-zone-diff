/**
 * The two feeds being compared, and their half of the URL hash.
 *
 * Scheme: `a=<source>&b=<source>&cors=a,b`. A source is `feed:<feedId>` for a
 * catalog feed, `upload:<id>` for an uploaded zip stored in this browser, or
 * a schedule URL. `cors` lists the URL sides fetched through the CORS proxy,
 * `none` when neither is; a missing `cors` proxies both. Catalog sources
 * always go through the proxy, as the load modal does. An upload enters the
 * hash once it is stored; until then it has no id.
 */

import {
  feedByUrl,
  loadFeedCatalog,
  usableUrl,
  type CatalogFeed,
} from 'gtfs-zone-web-common/gtfs/feed-catalog';
import type { FeedSelection } from 'gtfs-zone-web-common/gtfs/feed-selection';
import { t } from '../i18n/messages';
import { parseCache } from './feed-cache';

export type Side = 'a' | 'b';

export const SIDES: readonly Side[] = ['a', 'b'];

export type Source =
  | { kind: 'catalog'; feedId: string; url: string; label: string }
  | { kind: 'url'; url: string; useCors: boolean; label: string }
  /** An uploaded zip, before it is stored. */
  | { kind: 'file'; file: File; label: string }
  /** An uploaded zip stored in this browser, by its `ParseCache` id. */
  | { kind: 'upload'; id: string; label: string }
  /**
   * A hash value that cannot be loaded: a `feed:` id the catalog does not
   * list (or could not be loaded), or an `upload:` id this browser lacks.
   * `param` is the value as the hash had it.
   */
  | { kind: 'missing'; param: string; name: string; reason: string };

export type Sources = Record<Side, Source | null>;

const CATALOG_PREFIX = 'feed:';
const UPLOAD_PREFIX = 'upload:';

/** The host and last path segment, as a label for a bare URL. */
function labelForUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? `${u.host}/${last}` : u.host;
  } catch {
    return url;
  }
}

function catalogSource(feed: CatalogFeed): Source | null {
  const url = usableUrl(feed, 'scheduled');
  if (!url) {
    return null;
  }
  return { kind: 'catalog', feedId: feed.feedId, url, label: feed.name };
}

/** The source of a stored upload, or `missing` when this browser lacks it. */
export function uploadSource(id: string): Source {
  const entry = parseCache.get(id);
  if (entry?.kind !== 'upload') {
    console.warn(`[sources] stored upload ${id} is not in this browser`);
    return {
      kind: 'missing',
      param: UPLOAD_PREFIX + id,
      name: entry?.label ?? id,
      reason: t('source.uploadMissing'),
    };
  }
  return { kind: 'upload', id, label: entry.label };
}

/** The hash params for both sides; empty when neither is linkable. */
export function sourcesToParams(sources: Sources): Record<string, string> {
  const params: Record<string, string> = {};
  const cors: Side[] = [];
  let anyUrl = false;
  for (const side of SIDES) {
    const src = sources[side];
    if (src?.kind === 'catalog') {
      params[side] = CATALOG_PREFIX + src.feedId;
    } else if (src?.kind === 'upload') {
      params[side] = UPLOAD_PREFIX + src.id;
    } else if (src?.kind === 'missing') {
      params[side] = src.param;
    } else if (src?.kind === 'url') {
      params[side] = src.url;
      anyUrl = true;
      if (src.useCors) {
        cors.push(side);
      }
    }
  }
  if (anyUrl) {
    params.cors = cors.length > 0 ? cors.join(',') : 'none';
  }
  return params;
}

/**
 * Both sides read from a hash string (no leading `#`). Catalog ids wait for
 * the catalog; an id it does not list comes back as `missing`.
 */
export async function paramsToSources(hash: string): Promise<Sources> {
  const params = new URLSearchParams(hash);
  const corsParam = params.get('cors');
  const cors = new Set(
    corsParam === null ? SIDES : corsParam.split(',').filter(Boolean)
  );

  const read = async (side: Side): Promise<Source | null> => {
    const value = params.get(side);
    if (!value) {
      return null;
    }
    if (value.startsWith(UPLOAD_PREFIX)) {
      return uploadSource(value.slice(UPLOAD_PREFIX.length));
    }
    if (!value.startsWith(CATALOG_PREFIX)) {
      return {
        kind: 'url',
        url: value,
        useCors: cors.has(side),
        label: labelForUrl(value),
      };
    }
    const feedId = value.slice(CATALOG_PREFIX.length);
    let feeds: CatalogFeed[];
    try {
      feeds = await loadFeedCatalog();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[sources] catalog unavailable for ${feedId}:`, err);
      return {
        kind: 'missing',
        param: value,
        name: feedId,
        reason: t('source.catalogFailed', { reason }),
      };
    }
    const feed = feeds.find((f) => f.feedId === feedId);
    const src = feed ? catalogSource(feed) : null;
    if (!src) {
      console.warn(`[sources] no schedule in the catalog for ${feedId}`);
      return {
        kind: 'missing',
        param: value,
        name: feedId,
        reason: t('source.notInCatalog'),
      };
    }
    return src;
  };

  const [a, b] = await Promise.all([read('a'), read('b')]);
  return { a, b };
}

/**
 * The source a load modal selection names. A URL the catalog lists as a
 * feed's schedule becomes that catalog feed, so the link carries its id.
 */
export function selectionToSource(sel: FeedSelection): Source | null {
  const s = sel.scheduled;
  if (!s) {
    return null;
  }
  if (s.kind === 'file') {
    return { kind: 'file', file: s.file, label: s.label };
  }
  const feed = feedByUrl(s.url);
  if (feed && usableUrl(feed, 'scheduled') === s.url) {
    const src = catalogSource(feed);
    if (src) {
      return src;
    }
  }
  return {
    kind: 'url',
    url: s.url,
    useCors: s.useCors,
    label: s.label || labelForUrl(s.url),
  };
}

/** The selection the load modal opens seeded with for this source. */
export function sourceToSelection(src: Source | null): FeedSelection | null {
  if (!src || src.kind === 'missing' || src.kind === 'upload') {
    return null;
  }
  if (src.kind === 'file') {
    return {
      scheduled: { kind: 'file', file: src.file, label: src.label },
      realtime: null,
    };
  }
  return {
    scheduled: {
      kind: 'url',
      url: src.url,
      useCors: src.kind === 'catalog' ? true : src.useCors,
      label: src.label,
    },
    realtime: null,
  };
}
