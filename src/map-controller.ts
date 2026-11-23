import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as maplibregl from 'maplibre-gl';
import {
  AutoZoom,
  renderAutoZoomControl,
  syncAutoZoomControl,
  wireAutoZoomControl,
} from 'gtfs-zone-web-common/map/auto-zoom';
import {
  BasemapControl,
  initialMapStyle,
  onBasemapChanged,
  type MapAppearance,
} from 'gtfs-zone-web-common/map/basemap-control';
import { MAP_MAX_ZOOM } from 'gtfs-zone-web-common/map/basemap-styles';
import { fitPadding } from 'gtfs-zone-web-common/map/fit-padding';
import type { PanelResizeTarget } from 'gtfs-zone-web-common/ui/panel-resizer';
import { CONFIG } from './config';
import type { MapFeatureProps, MapGeometry } from './engine/types';
import { MapLayers, type MapSide } from './modules/map-layers';

interface MapView {
  center: [number, number];
  zoom: number;
}

const DEFAULT_VIEW: MapView = { center: [10, 30], zoom: 1.5 };
const VIEW_SAVE_DEBOUNCE = 500;
const RESIZE_SETTLE_MS = 350;
const FIT_PADDING_PX = 48;
const FIT_MAX_ZOOM = 16;
const FIT_DURATION_MS = 600;

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

/**
 * The shell's map: basemap, navigation, the stored camera, and the changes
 * drawn for the current page.
 */
export class MapController implements PanelResizeTarget {
  private map: maplibregl.Map | null = null;
  private layers: MapLayers | null = null;
  private shown: MapGeometry | null = null;
  private viewSave: ReturnType<typeof setTimeout> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private autoZoom = new AutoZoom(() => this.fit(true));

  constructor(private onPick: (props: MapFeatureProps) => void) {}

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

    const layers = new MapLayers(map, (props) => this.onPick(props));
    this.layers = layers;
    map.once('load', () => {
      layers.rebuild();
      layers.attachInteraction();
    });
    // setStyle drops our source and layers; re-add them on each basemap change.
    onBasemapChanged(map, () => layers.rebuild());

    const mount = document.getElementById('auto-zoom-mount');
    if (mount) {
      mount.innerHTML = renderAutoZoomControl();
      syncAutoZoomControl(this.autoZoom.isEnabled());
      wireAutoZoomControl(this.autoZoom);
    }
  }

  /**
   * Draw the changes for a page. `fit` frames them: `'always'` for the first
   * draw of a comparison, `'auto'` on navigation (only with auto-zoom on).
   */
  show(geometry: MapGeometry | null, fit: 'always' | 'auto' | 'none'): void {
    this.shown = geometry;
    this.layers?.setData(geometry);
    if (fit !== 'none') {
      this.fit(fit === 'always');
    }
  }

  setSide(side: MapSide): void {
    this.layers?.setSide(side);
  }

  private fit(always: boolean): void {
    const map = this.map;
    const bounds = this.shown?.bounds;
    if (!map || !bounds) {
      return;
    }
    const options = {
      padding: fitPadding(map, FIT_PADDING_PX),
      maxZoom: FIT_MAX_ZOOM,
      duration: FIT_DURATION_MS,
      essential: true,
    };
    const box = new maplibregl.LngLatBounds(
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]]
    );
    if (always) {
      map.fitBounds(box, options);
    } else {
      this.autoZoom.fitBounds(map, box, options);
    }
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
