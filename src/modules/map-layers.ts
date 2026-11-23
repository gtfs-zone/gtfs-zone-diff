/**
 * The changes on the map: one GeoJSON source, lines and stops coloured by
 * status (added green, removed red, changed amber, unchanged grey), A-side
 * geometry of a changed entity and moved-stop lines dashed, and an A / B /
 * both filter on the feed each feature comes from.
 */

import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
} from 'maplibre-gl';
import type { MapFeatureProps, MapGeometry } from '../engine/types';

export type MapSide = 'a' | 'b' | 'both';

const SOURCE = 'diff';
const CASING_LAYER = 'diff-casing';
const LINES_LAYER = 'diff-lines';
const WAS_LAYER = 'diff-was';
const STOPS_LAYER = 'diff-stops';
const PICK_LAYERS = [STOPS_LAYER, LINES_LAYER, WAS_LAYER];
const PICK_RADIUS_PX = 5;

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

/** Changes above unchanged context, additions on top. */
const sortKey = [
  'match',
  ['get', 'status'],
  'added',
  3,
  'removed',
  2,
  'changed',
  1,
  0,
] as unknown as ExpressionSpecification;

const isUnchanged = ['==', ['get', 'status'], 'unchanged'];
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

const widthByZoom = (narrow: number, wide: number): ExpressionSpecification =>
  [
    'interpolate',
    ['linear'],
    ['zoom'],
    8,
    ['case', isUnchanged, narrow * 0.6, narrow],
    16,
    ['case', isUnchanged, wide * 0.6, wide],
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

  constructor(
    private map: MapLibreMap,
    private onPick: (props: MapFeatureProps) => void
  ) {}

  /** Add the source and layers; again after a basemap change dropped them. */
  rebuild(): void {
    const map = this.map;
    if (map.getSource(SOURCE)) {
      return;
    }
    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: this.data?.features ?? [] },
    });
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
        'line-opacity': 0.8,
        'line-width': widthByZoom(4, 9),
      },
    });
    map.addLayer({
      id: WAS_LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-join': 'round', 'line-sort-key': sortKey },
      paint: {
        'line-color': statusColor,
        'line-width': widthByZoom(1.5, 4),
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
        'line-width': widthByZoom(2, 6),
      },
    });
    // The A position of a moved stop is hollow; its B position is filled.
    const hollow = [
      'all',
      ['==', ['get', 'side'], 'a'],
      ['==', ['get', 'status'], 'changed'],
    ];
    map.addLayer({
      id: STOPS_LAYER,
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: {
        'circle-radius': widthByZoom(3.5, 7),
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
    const map = this.map;
    const hit = (point: { x: number; y: number }): MapGeoJSONFeature[] =>
      map.getSource(SOURCE)
        ? map.queryRenderedFeatures(
            [
              [point.x - PICK_RADIUS_PX, point.y - PICK_RADIUS_PX],
              [point.x + PICK_RADIUS_PX, point.y + PICK_RADIUS_PX],
            ],
            { layers: PICK_LAYERS }
          )
        : [];
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = hit(e.point).length > 0 ? 'pointer' : '';
    });
    map.on('click', (e) => {
      const found = hit(e.point);
      const top =
        found.find((f) => f.layer.id === STOPS_LAYER) ?? found[0] ?? null;
      if (top) {
        this.onPick(top.properties as MapFeatureProps);
      }
    });
  }

  setData(data: MapGeometry | null): void {
    this.data = data;
    const src = this.map.getSource<GeoJSONSource>(SOURCE);
    src?.setData({ type: 'FeatureCollection', features: data?.features ?? [] });
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
