/** Which changes the map draws for each page, read from the diff worker. */

import type { MapController } from '../map-controller';
import type { DiffResult, MapGeometry, MapScope } from '../engine/types';
import type { PageLocation } from '../types/page-state';
import type { DiffSession } from './diff-client';
import { doneResult, type PageContext } from './page-context';
import type { MapSide } from './map-layers';

/** Geometry reads kept per comparison; the overview is the one reused most. */
const CACHE_SIZE = 8;

/** The page's own geometry, else the overview (one layer of it). */
export function mapScope(loc: PageLocation, result: DiffResult): MapScope {
  switch (loc.type) {
    case 'stop':
      return { type: 'stop', id: loc.stop_id };
    case 'trip':
      return { type: 'trip', id: loc.trip_id };
    case 'route':
      return { type: 'route', id: loc.route_id };
    case 'shape':
      return { type: 'shape', id: loc.shape_id };
    case 'file':
      if (loc.file === 'stops.txt') {
        return { type: 'overview', layer: 'stops' };
      }
      if (loc.file === 'shapes.txt') {
        return { type: 'overview', layer: 'shapes' };
      }
      return { type: 'overview' };
    case 'group': {
      const kind = result.groups.find((g) => g.id === loc.group)?.kind;
      if (kind === 'stopMoved') {
        return { type: 'overview', layer: 'moved' };
      }
      if (
        kind === 'stopMerged' ||
        kind === 'stopSplit' ||
        kind === 'stopMergeSuggestion'
      ) {
        return { type: 'overview', layer: 'merged' };
      }
      if (kind === 'shapeChanged') {
        return { type: 'overview', layer: 'shapes' };
      }
      return { type: 'overview' };
    }
    default:
      return { type: 'overview' };
  }
}

export class MapView {
  private session: DiffSession | null = null;
  private cache = new Map<string, Promise<MapGeometry>>();
  /** The scope drawn, or being read, for the current session. */
  private key: string | null = null;
  private framed = false;

  constructor(private map: MapController) {
    const card = document.getElementById('map-side-card');
    card?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-map-side]'
      );
      if (!btn) {
        return;
      }
      for (const b of card.querySelectorAll<HTMLElement>('[data-map-side]')) {
        const on = b === btn;
        b.classList.toggle('btn-active', on);
        b.setAttribute('aria-pressed', String(on));
      }
      this.map.setSide(btn.dataset.mapSide as MapSide);
    });
  }

  /** Draw what the page needs; framed only when that changes. */
  update(ctx: PageContext, loc: PageLocation): void {
    const done = doneResult(ctx);
    if (done?.session !== this.session) {
      this.session = done?.session ?? null;
      this.cache.clear();
      this.key = null;
      this.framed = false;
    }
    document.getElementById('map-side-card')?.classList.toggle('hidden', !done);
    if (!done) {
      this.map.show(null, 'none');
      return;
    }
    const scope = mapScope(loc, done.result);
    const key = JSON.stringify(scope);
    if (key === this.key) {
      return;
    }
    this.key = key;
    this.read(done.session, key, scope).then(
      (geometry) => {
        if (this.key !== key || this.session !== done.session) {
          return;
        }
        this.map.show(geometry, this.framed ? 'auto' : 'always');
        this.framed ||= geometry.bounds !== null;
      },
      (err: unknown) => console.warn('[MapView] geometry read failed', err)
    );
  }

  private read(
    session: DiffSession,
    key: string,
    scope: MapScope
  ): Promise<MapGeometry> {
    let p = this.cache.get(key);
    if (p) {
      // Most recent last, so the oldest is dropped first.
      this.cache.delete(key);
    } else {
      p = session.call('mapGeometry', scope);
      p.catch(() => this.cache.delete(key));
    }
    this.cache.set(key, p);
    if (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }
}
