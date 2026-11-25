# Changelog

## v0.4.0 (2026-11-25)

### Feat

- **map**: draw added and removed stop lists of trips without a shape on the overview

## v0.3.0 (2026-11-25)

### Feat

- **sources**: keep both feeds in this browser so a refresh reopens them
- **groups**: detect merged and split stops
- **map**: spotlight the page's focus and dim the rest of its scope
- **map**: click on an empty spot goes up one breadcrumb
- **map**: draw the stop list as before or after when a trip gains or loses a shape

### Fix

- **map**: draw a trip whose shape_id has no points by its stops

## v0.2.1 (2026-11-25)

## v0.2.0 (2026-11-25)

### Feat

- **help**: guide pages for change kinds, renames, map and export
- **progress**: list the comparison steps with a stop button
- **export**: GTFS Diff v2 JSON and a markdown summary
- **links**: open either side in the editor or the visualizer
- **search**: search stops, routes, agencies and trips of both feeds
- **map**: draw the changes on the map per page
- **panel**: file pages list differing rows field by field
- **panel**: entity pages with both sides compared field by field
- **panel**: tree pages for home, files and grouped changes
- **hash**: name the page with an explicit type param
- **engine**: compare two feeds in one worker and list results on home

### Fix

- **engine**: paired trips and shapes with added or removed rows are changed

## v0.1.0 (2026-11-22)

### Feat

- app skeleton with a two-source picker and both feeds in the URL hash
