/** Opens the shared load modal for one side and turns its result into a source. */

import { ParseCache } from 'gtfs-zone-web-common/gtfs/parse-cache';
import { showLoadModal } from 'gtfs-zone-web-common/ui/load-modal';
import { CONFIG } from '../config';
import { t } from '../i18n/messages';
import {
  selectionToSource,
  sourceToSelection,
  type Side,
  type Source,
} from './sources';

const parseCache = new ParseCache(CONFIG.PARSE_CACHE_APP);

/** The stored entry as a URL source, or null when it is gone. */
function storedSource(id: string): Source | null {
  const entry = parseCache.get(id);
  if (!entry) {
    console.warn(`[picker] stored feed ${id} is gone`);
    return null;
  }
  const extra = entry.extra as { useCors?: boolean } | undefined;
  return selectionToSource({
    scheduled: {
      kind: 'url',
      url: entry.sourceUrl,
      useCors: extra?.useCors ?? true,
      label: entry.label,
    },
    realtime: null,
  });
}

/**
 * Pick the feed for `side`, seeded with its current source. Resolves to the
 * new source, or undefined when the modal was dismissed.
 */
export async function pickSource(
  side: Side,
  current: Source | null
): Promise<Source | null | undefined> {
  const result = await showLoadModal(sourceToSelection(current), {
    realtime: false,
    notice:
      current?.kind === 'missing'
        ? t('picker.missingNotice', {
            side: side.toUpperCase(),
            reason: current.reason,
          })
        : undefined,
    library: {
      feeds: parseCache.offers(null),
      onDelete: (id) => parseCache.delete(id),
    },
  });
  if (!result) {
    return undefined;
  }
  switch (result.kind) {
    case 'selection':
    case 'update':
      return selectionToSource(result.selection);
    case 'stored':
      return storedSource(result.id);
    case 'offer':
      throw new Error(`[picker] unexpected app offer ${result.id}`);
  }
}
