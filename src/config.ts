/** Application-wide constants. */
export const CONFIG = {
  // Per-device map preferences, not part of a shared link.
  MAP_VIEW_KEY: 'diff.map.view',
  MAP_APPEARANCE_KEY: 'diff.map.appearance',
  /** Names the "Your feeds" index in localStorage. */
  PARSE_CACHE_APP: 'diff',
  // Sibling apps a side can be opened in. Prod on purpose: a shared link
  // should land on the stable public app.
  EDITOR_BASE: 'https://edit.gtfs.zone',
  VIEWER_BASE: 'https://viz.rt.gtfs.zone',
} as const;
