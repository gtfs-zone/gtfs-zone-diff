/** Opens the shared load modal for one side and turns its result into a source. */

import { showLoadModal } from 'gtfs-zone-web-common/ui/load-modal';
import { t } from '../i18n/messages';
import { parseCache } from './feed-cache';
import {
  selectionToSource,
  sourceToSelection,
  uploadSource,
  type Side,
  type Source,
} from './sources';

/**
 * A stored entry as a source: an upload by its id, a URL feed as its URL
 * (restored by the worker while the server still has that version). Null
 * when the entry is gone.
 */
function storedSource(id: string): Source | null {
  const entry = parseCache.get(id);
  if (!entry) {
    console.warn(`[picker] stored feed ${id} is gone`);
    return null;
  }
  if (entry.kind === 'upload') {
    return uploadSource(id);
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
      feeds: parseCache.offers(current?.kind === 'upload' ? current.id : null),
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
