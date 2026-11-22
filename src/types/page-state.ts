import type { WithModal } from 'gtfs-zone-web-common/ui/page-state-schema';

/**
 * Every page diff.gtfs.zone can display: the comparison home, or one file or
 * entity focused across both feeds. Ids are matched on either side.
 */
export type PageLocation =
  | { type: 'home' }
  | { type: 'file'; file: string }
  | { type: 'group'; group: string }
  | { type: 'feed_info' }
  | { type: 'agency'; agency_id: string }
  | { type: 'route'; route_id: string }
  | { type: 'trip'; trip_id: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'service'; service_id: string }
  | { type: 'shape'; shape_id: string };

/** The modals that live in the hash; `page` is the guide page shown. */
export type ModalState = { type: 'help'; page?: string };

export type PageState = WithModal<PageLocation, ModalState>;
