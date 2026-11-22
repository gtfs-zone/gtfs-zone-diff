# AGENTS.md

Static frontend at diff.gtfs.zone that compares two GTFS feeds in the
browser. Built on gtfs-zone-web-common, laid out like gtfs-zone-rt-viewer.

- **Verification**: no Playwright or other browser automation. Stop at
  `pnpm check` / `pnpm build` and hand off; the user checks in the browser.
- **UI**: conventions live in gtfs-zone-web-common's `AGENTS.md`.
- **Data**: both feeds are loaded and compared client side; no backend.

## Commands

```bash
pnpm dev          # dev server on :8092
pnpm check        # typecheck, lint, knip
pnpm vuln         # osv-scanner vulnerability gate
```

Deployed to GitHub Pages from `v*` tags.

## Architecture

- `src/modules/sources.ts`: the two sources (catalog feed, URL, upload) and
  their hash params, `a=`, `b=` and `cors=`.
- `src/modules/source-picker.ts`: web-common's load modal for one side,
  with "Your feeds" from `ParseCache('diff')`.
- `src/modules/page-state.ts`, `src/types/page-state.ts`: the page half of
  the hash (`file`, `stop`, `route`, `trip`, ...), on web-common's
  `PageStateManager`.
- `src/modules/panel-view.ts`: the right panel.
- `src/map-controller.ts`: the shell map (basemap, navigation, stored view).

## Conventions

- **Commits**: Conventional Commits, enforced by the `commit-msg` hook. Never add
  Co-Authored-By trailers. Setup is in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Cross-repo work**: sibling gtfs.zone repos live under the same parent
  directory and may be read and edited when a change spans repos.
- **Plans**: `CURRENT_PLAN.md` holds the roadmap. It is neither tracked nor
  gitignored: never stage or commit it.
- **i18n**: every UI string goes in `src/i18n/catalog.en.ts`, with `fr` and
  `de` alongside. GTFS file, field and enum names are never translated.
