# gtfs-zone-diff

Static frontend at https://diff.gtfs.zone that compares two GTFS feeds.

- Pick feed A and feed B from a URL, an upload, the gtfs.zone feed catalog or
  the feeds stored in this browser
- The address bar holds both feeds and the focused file or entity, so a link
  reopens the same comparison (uploads excepted)

Built on gtfs-zone-web-common.

## Development

```bash
pnpm install
pnpm dev          # dev server on :8092
pnpm check        # typecheck, lint, knip
pnpm build
```

## License

AGPL-3.0-or-later. See [LICENSE.txt](LICENSE.txt).
