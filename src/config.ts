/** Application-wide constants. */
export const CONFIG = {
  // Per-device map preferences, not part of a shared link.
  MAP_VIEW_KEY: 'diff.map.view',
  MAP_APPEARANCE_KEY: 'diff.map.appearance',
  /** Names the "Your feeds" index in localStorage. */
  PARSE_CACHE_APP: 'diff',
} as const;
