/**
 * The changes on the map: one GeoJSON source, lines and stops coloured by
 * status (added green, removed red, changed amber, unchanged grey), A-side
 * geometry of a changed entity and moved, merged or split stop lines dashed, and an A / B /
 * both filter on the feed each feature comes from. The page's focus is drawn
 * wider and on top, the rest dimmed; a hovered panel row does the same for
 * its features.
 */

import type { FeatureCollection } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { onMapClick } from 'gtfs-zone-web-common/map/click-away';
import type { MapFeatureProps, MapGeometry } from '../engine/types';

export type MapSide = 'a' | 'b' | 'both';

const SOURCE = 'diff';
const CASING_LAYER = 'diff-casing';
const LINES_LAYER = 'diff-lines';
const WAS_LAYER = 'diff-was';
const STOPS_LAYER = 'diff-stops';
const PICK_LAYERS = [STOPS_LAYER, LINES_LAYER, WAS_LAYER];
const PICK_RADIUS_PX = 5;

/** Context opacity and focus widths, as web-common's LayerManager spotlight. */
const DIM_LINE = 0.2;
const DIM_STOP = 0.15;
const FOCUS_LINE_BUMP = 1.35;
const FOCUS_CASING_BUMP = 1.3;

/** Global state: some features are context, or a panel row is hovered. */
const SPOTLIT = 'diffSpotlit';
const HOVERING = 'diffHovering';

/** A page a panel row links to, matched against feature `page` and `id`. */
export interface MapHover {
  page: MapFeatureProps['page'];
  id: string;
}

export const STATUS_COLORS = {
  added: '#16a34a',
  removed: '#dc2626',
  changed: '#d97706',
  unchanged: '#6b7280',
} as const;

const statusColor = [
  'match',
  ['get', 'status'],
  'added',
  STATUS_COLORS.added,
  'removed',
  STATUS_COLORS.removed,
  'changed',
  STATUS_COLORS.changed,
  STATUS_COLORS.unchanged,
] as unknown as ExpressionSpecification;

/** Focus above context, changes above unchanged, additions on top. */
const sortKey = [
  '+',
  ['case', ['get', 'focus'], 10, 0],
  ['match', ['get', 'status'], 'added', 3, 'removed', 2, 'changed', 1, 0],
] as unknown as ExpressionSpecification;

const isUnchanged = ['==', ['get', 'status'], 'unchanged'];
const isHovered = ['boolean', ['feature-state', 'hover'], false];
const isHovering = ['==', ['global-state', HOVERING], true];
const isSpotlit = ['==', ['global-state', SPOTLIT], true];

/** Full opacity for the hovered row, else for the focus while none is. */
const opacity = (full: number, dim: number): ExpressionSpecification =>
  [
    'case',
    isHovered,
    full,
    isHovering,
    full * dim,
    ['get', 'focus'],
    full,
    full * dim,
  ] as unknown as ExpressionSpecification;

/** Wider for the hovered row, else for the focus while some is context. */
const bump = (factor: number): unknown[] => [
  'case',
  ['any', isHovered, ['all', isSpotlit, ['!', isHovering], ['get', 'focus']]],
  factor,
  1,
];
const IS_LINE = ['==', ['geometry-type'], 'LineString'];

/** The A side of an entity that differs between the feeds, or a move line. */
const WAS = [
  'any',
  ['==', ['get', 'kind'], 'move'],
  [
    'all',
    ['==', ['get', 'kind'], 'line'],
    ['==', ['get', 'status'], 'changed'],
    ['==', ['get', 'side'], 'a'],
  ],
];

const widthByZoom = (
  narrow: number,
  wide: number,
  factor = 1
): ExpressionSpecification =>
  [
    'interpolate',
    ['linear'],
    ['zoom'],
    8,
    ['*', bump(factor), ['case', isUnchanged, narrow * 0.6, narrow]],
    16,
    ['*', bump(factor), ['case', isUnchanged, wide * 0.6, wide]],
  ] as unknown as ExpressionSpecification;

function sideFilter(side: MapSide): unknown[] {
  return side === 'both'
    ? ['literal', true]
    : [
        'all',
        ['!=', ['get', 'kind'], 'move'],
        ['in', ['get', 'side'], ['literal', [side, 'both']]],
      ];
}

export class MapLayers {
  private data: MapGeometry | null = null;
  private side: MapSide = 'both';
  /** Feature ids per `page:id`, for hover feature-state. */
  private byPage = new Map<string, number[]>();
  private hovered: number[] = [];

  constructor(
    private map: MapLibreMap,
    private onPick: (props: MapFeatureProps) => void,
    private onEmpty: () => void
  ) {}

  /** Add the source and layers; again after a basemap change dropped them. */
  rebuild(): void {
    const map = this.map;
    if (map.getSource(SOURCE)) {
      return;
    }
    map.addSource(SOURCE, { type: 'geojson', data: this.collection() });
    this.hovered = [];
    this.applyGlobalState();
    // Filters are set by applySide.
    map.addLayer({
      id: CASING_LAYER,
      type: 'line',
      source: SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': sortKey,
      },
      paint: {
        'line-color': '#ffffff',
        'line-opacity': opacity(0.8, DIM_LINE),
        'line-width': widthByZoom(4, 9, FOCUS_CASING_BUMP),
      },
    });
    map.addLayer({
      id: WAS_LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-join': 'round', 'line-sort-key': sortKey },
      paint: {
        'line-color': statusColor,
        'line-opacity': opacity(1, DIM_LINE),
        'line-width': widthByZoom(1.5, 4, FOCUS_LINE_BUMP),
        'line-dasharray': [2, 2],
      },
    });
    map.addLayer({
      id: LINES_LAYER,
      type: 'line',
      source: SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': sortKey,
      },
      paint: {
        'line-color': statusColor,
        'line-opacity': opacity(1, DIM_LINE),
        'line-width': widthByZoom(2, 6, FOCUS_LINE_BUMP),
      },
    });
    // The A position of a moved, merged or split stop is hollow; B is filled.
    const hollow = [
      'any',
      ['==', ['get', 'hollow'], true],
      [
        'all',
        ['==', ['get', 'side'], 'a'],
        ['==', ['get', 'status'], 'changed'],
      ],
    ];
    map.addLayer({
      id: STOPS_LAYER,
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: {
        'circle-radius': widthByZoom(3.5, 7, FOCUS_LINE_BUMP),
        'circle-opacity': opacity(1, DIM_STOP),
        'circle-stroke-opacity': opacity(1, DIM_STOP),
        'circle-color': [
          'case',
          hollow,
          '#ffffff',
          statusColor,
        ] as unknown as ExpressionSpecification,
        'circle-stroke-color': [
          'case',
          hollow,
          statusColor,
          '#ffffff',
        ] as unknown as ExpressionSpecification,
        'circle-stroke-width': 1.5,
      },
    });
    this.applySide();
  }

  attachInteraction(): void {
    onMapClick(this.map, {
      layers: PICK_LAYERS,
      radiusPx: PICK_RADIUS_PX,
      onFeature: (found) => {
        const top = found.find((f) => f.layer.id === STOPS_LAYER) ?? found[0];
        if (top) {
          this.onPick(top.properties as MapFeatureProps);
        }
      },
      onEmpty: () => this.onEmpty(),
    });
  }

  setData(data: MapGeometry | null): void {
    this.data = data;
    this.byPage.clear();
    data?.features.forEach((f, i) => {
      const key = `${f.properties.page}:${f.properties.id}`;
      const ids = this.byPage.get(key);
      if (ids) {
        ids.push(i);
      } else {
        this.byPage.set(key, [i]);
      }
    });
    this.hovered = [];
    const src = this.map.getSource<GeoJSONSource>(SOURCE);
    if (src) {
      // Ids are indexes, so the old hover state would land on new features.
      this.map.removeFeatureState({ source: SOURCE });
      src.setData(this.collection());
    }
    this.applyGlobalState();
  }

  /** Light up the features a panel row links to; null clears it. */
  setHover(hover: MapHover | null): void {
    if (!this.map.getSource(SOURCE)) {
      return;
    }
    for (const id of this.hovered) {
      this.map.setFeatureState({ source: SOURCE, id }, { hover: false });
    }
    this.hovered = hover
      ? (this.byPage.get(`${hover.page}:${hover.id}`) ?? [])
      : [];
    for (const id of this.hovered) {
      this.map.setFeatureState({ source: SOURCE, id }, { hover: true });
    }
    this.map.setGlobalStateProperty(HOVERING, this.hovered.length > 0);
  }

  /** The features with their index as id, for feature-state. */
  private collection(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: (this.data?.features ?? []).map((f, i) => ({ ...f, id: i })),
    };
  }

  private applyGlobalState(): void {
    if (!this.map.getSource(SOURCE)) {
      return;
    }
    const spotlit = this.data?.features.some((f) => !f.properties.focus);
    this.map.setGlobalStateProperty(SPOTLIT, spotlit === true);
    this.map.setGlobalStateProperty(HOVERING, this.hovered.length > 0);
  }

  setSide(side: MapSide): void {
    this.side = side;
    this.applySide();
  }

  private applySide(): void {
    if (!this.map.getSource(SOURCE)) {
      return;
    }
    const side = sideFilter(this.side);
    const set = (id: string, base: unknown[]): void => {
      this.map.setFilter(id, [
        'all',
        ...base,
        side,
      ] as unknown as FilterSpecification);
    };
    set(CASING_LAYER, [IS_LINE, ['!', WAS]]);
    set(WAS_LAYER, [IS_LINE, WAS]);
    set(LINES_LAYER, [IS_LINE, ['!', WAS]]);
    set(STOPS_LAYER, [['==', ['geometry-type'], 'Point']]);
  }
}
