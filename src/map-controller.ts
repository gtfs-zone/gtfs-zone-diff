import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as maplibregl from 'maplibre-gl';
import {
  BasemapControl,
  initialMapStyle,
  type MapAppearance,
} from 'gtfs-zone-web-common/map/basemap-control';
import { MAP_MAX_ZOOM } from 'gtfs-zone-web-common/map/basemap-styles';
import type { PanelResizeTarget } from 'gtfs-zone-web-common/ui/panel-resizer';
import { CONFIG } from './config';

interface MapView {
  center: [number, number];
  zoom: number;
}

const DEFAULT_VIEW: MapView = { center: [10, 30], zoom: 1.5 };
const VIEW_SAVE_DEBOUNCE = 500;
const RESIZE_SETTLE_MS = 350;

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota: the view just won't persist.
  }
}

/** The shell's map: basemap, navigation and the stored camera. */
export class MapController implements PanelResizeTarget {
  private map: maplibregl.Map | null = null;
  private viewSave: ReturnType<typeof setTimeout> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  initialize(container: string): void {
    const view = readStored<MapView>(CONFIG.MAP_VIEW_KEY) ?? DEFAULT_VIEW;
    const appearance =
      readStored<MapAppearance>(CONFIG.MAP_APPEARANCE_KEY) ?? {};

    // maplibre resolves its worker relative to its own module URL, which
    // breaks once Vite bundles it; point it at a Vite-built copy.
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
    const map = new maplibregl.Map({
      container,
      style: initialMapStyle(appearance),
      center: view.center,
      zoom: view.zoom,
      maxZoom: MAP_MAX_ZOOM,
    });
    // `#map-controls` covers the top strip and the basemap FAB bottom-right.
    map.addControl(new maplibregl.NavigationControl(), 'bottom-left');
    new BasemapControl(map, {
      initial: appearance,
      onAppearanceChange: (next) =>
        writeStored(CONFIG.MAP_APPEARANCE_KEY, next),
    });
    map.on('moveend', () => this.queueViewSave());
    this.map = map;
  }

  private queueViewSave(): void {
    if (this.viewSave) {
      clearTimeout(this.viewSave);
    }
    this.viewSave = setTimeout(() => {
      if (!this.map) {
        return;
      }
      const c = this.map.getCenter();
      writeStored(CONFIG.MAP_VIEW_KEY, {
        center: [c.lng, c.lat],
        zoom: this.map.getZoom(),
      } satisfies MapView);
      this.viewSave = null;
    }, VIEW_SAVE_DEBOUNCE);
  }

  resizeNow(): void {
    this.map?.resize();
  }

  /** Resize once a CSS transition settles. */
  forceMapResize(): void {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => this.map?.resize(), RESIZE_SETTLE_MS);
  }
}
