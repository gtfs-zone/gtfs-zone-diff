/**
 * Entity reads from the diff worker, one per page, kept for the session
 * they came from. Their crumb labels feed the breadcrumb chain.
 */

import type { TreeCrumbSource } from 'gtfs-zone-web-common/gtfs/breadcrumbs';
import type { CrumbLabels, EntityView, PageEntity } from '../engine/types';
import type { DiffSession } from './diff-client';

export type EntityState =
  | { status: 'loading' }
  | { status: 'done'; view: EntityView }
  | { status: 'failed'; message: string };

export class EntityCache implements TreeCrumbSource {
  private session: DiffSession | null = null;
  private entries = new Map<string, EntityState>();
  private labels: CrumbLabels = { agency: {}, route: {}, trip: {}, stop: {} };

  /** `onLoaded` runs when a read lands, to redraw the page and its crumbs. */
  constructor(private onLoaded: () => void) {}

  /** The read for a page, started on first ask. Null without a session. */
  get(
    session: DiffSession | null,
    type: PageEntity,
    id: string
  ): EntityState | null {
    if (session !== this.session) {
      this.session = session;
      this.entries.clear();
      this.labels = { agency: {}, route: {}, trip: {}, stop: {} };
    }
    if (!session) {
      return null;
    }
    const key = `${type}:${id}`;
    const have = this.entries.get(key);
    if (have) {
      return have;
    }
    const state: EntityState = { status: 'loading' };
    this.entries.set(key, state);
    session.call('entity', type, id).then(
      (view) => {
        if (this.session !== session) {
          return;
        }
        this.entries.set(key, { status: 'done', view });
        for (const k of ['agency', 'route', 'trip', 'stop'] as const) {
          Object.assign(this.labels[k], view.crumbs[k]);
        }
        this.onLoaded();
      },
      (err: unknown) => {
        if (this.session !== session) {
          return;
        }
        console.error(`[EntityCache] ${key} failed`, err);
        this.entries.set(key, {
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
        this.onLoaded();
      }
    );
    return state;
  }

  agency(agencyId: string): { label: string } | null {
    return this.labels.agency[agencyId] ?? null;
  }

  route(routeId: string): { label: string; agency_id: string | null } | null {
    return this.labels.route[routeId] ?? null;
  }

  trip(tripId: string): { label: string; route_id: string } | null {
    return this.labels.trip[tripId] ?? null;
  }

  stop(
    stopId: string
  ): { label: string; location_type?: number; parent_station?: string } | null {
    return this.labels.stop[stopId] ?? null;
  }
}
