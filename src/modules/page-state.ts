import { PageStateManager } from 'gtfs-zone-web-common/ui/page-state-manager';
import { createPageStateCodec } from 'gtfs-zone-web-common/ui/page-state-schema';
import type { ModalState, PageLocation, PageState } from '../types/page-state';

/** The hash names the page with an explicit `type` param; an unknown type falls back to home. */
const codec = createPageStateCodec<PageLocation, ModalState>({
  typeParam: 'type',
  pages: {
    file: { file: 'file' },
    agency: { agency_id: 'agency' },
    route: { route_id: 'route' },
    trip: { trip_id: 'trip' },
    stop: { stop_id: 'stop' },
    service: { service_id: 'service' },
    shape: { shape_id: 'shape' },
  },
  modals: {
    help: { page: { param: 'modal_page', optional: true } },
  },
});

/** The page half of the hash; the sources are its feed params. */
export function createPageStateManager(): PageStateManager<PageState> {
  return new PageStateManager<PageState>({ codec, enableUrlSync: true });
}
