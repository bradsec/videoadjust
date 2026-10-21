# videoresize

Shrink and trim videos in the browser. Conversion runs locally on WebCodecs through
[Mediabunny](https://mediabunny.dev/). No video is uploaded; the page makes no requests to
other origins and its CSP only allows `'self'`, `blob:` and workers. It does not need
`SharedArrayBuffer` or COOP/COEP headers.

## Development

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev            # dev server
pnpm build          # licence check, type check, production build into dist/
pnpm test           # unit tests (vitest)
pnpm test:e2e       # Playwright (chromium, webkit, iPhone 15, iPad Pro 11)
scripts/make-fixtures.sh   # regenerate tests/fixtures (needs ffmpeg)
```

First e2e run needs browsers: `pnpm exec playwright install chromium webkit`.

## Hosting

Static output in `dist/`, with a relative base so it runs under a GitHub Pages repo subpath.
`.github/workflows/pages.yml` deploys on push to `main`. `public/_headers` carries the same CSP
for Cloudflare Pages. No asset may exceed 25 MiB (Cloudflare Pages limit).

## Licences

This project is MIT (see `LICENSE`). Production dependencies:

| Package | Licence | Source |
| --- | --- | --- |
| mediabunny | MPL-2.0 (unmodified) | https://github.com/Vanilagy/mediabunny |

Full notices are in `THIRD-PARTY-LICENSES.txt`. `pnpm check:licenses` reads
`pnpm licenses list --prod --json`, fails on any licence outside the allowlist (MIT, BSD-2/3-Clause,
ISC, Apache-2.0, 0BSD, MPL-2.0) and fails if a production package has no entry in
`THIRD-PARTY-LICENSES.txt`. It runs in `pnpm build` and in the Pages workflow.
