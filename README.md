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

On the prepare screen, drag the trim handles or use arrow keys to adjust by 0.1 seconds.
Hold Shift with an arrow key for 1-second steps. Use Start here or End here to set
a boundary at the preview playhead. The kept duration and estimated size update as you trim.
The summary card shows the estimated output range against the original size. Open Adjust to
change format, codec, resolution, frame rate, quality, or audio. Each setting has a reset button.
Unavailable codecs show why they cannot be selected. WebM uses Opus audio. The quality control
and audio bitrates stay within the source limits. If the source is already small, the summary
offers a trim-only export.

## Hosting

Static output in `dist/`, with a relative base so it runs under a GitHub Pages repo subpath.
`.github/workflows/pages.yml` deploys on push to `main`. `public/_headers` carries the same CSP
for Cloudflare Pages. No asset may exceed 25 MiB (Cloudflare Pages limit).

## Licences

This project is MIT (see `LICENSE`). Production dependencies:

| Package | Licence | Source |
| --- | --- | --- |
| mediabunny | MPL-2.0 (unmodified) | https://github.com/Vanilagy/mediabunny |
| @mediabunny/aac-encoder | MPL-2.0 (unmodified), embeds FFmpeg AAC encoder under LGPL-2.1-or-later | https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder |

### AAC fallback encoder

Browsers without a native WebCodecs AAC encoder get `@mediabunny/aac-encoder`, registered with
its documented `registerAacEncoder()` call. The app loads it with a dynamic `import()` only after
`canEncodeAudio('aac')` returns false, so it ships as a separate same-origin chunk, registered
once per page. The WASM is embedded in that JavaScript chunk, as the upstream package ships it.
`THIRD-PARTY-LICENSES.txt` explains how to rebuild with your own FFmpeg build.

Licence audit (version 1.62.0, 2026-10-22):

- The npm package declares MPL-2.0 and its `LICENSE` is the MPL-2.0 text. Its WASM is FFmpeg
  (libavcodec and libavutil) linked with an MPL-2.0 bridge (`src/bridge.c`).
- The FFmpeg build flags in the package README, identical in the upstream repository, are
  `--disable-everything --disable-autodetect --enable-avcodec --enable-encoder=aac`. No
  `--enable-gpl`, `--enable-nonfree` or `--enable-libfdk-aac`. That selects only FFmpeg's native
  AAC encoder, which is LGPL-2.1-or-later (header of `libavcodec/aacenc.c`). FFmpeg's
  `LICENSE.md` states that GPL parts are off unless `--enable-gpl` is passed.
- No fdk-aac and no GPL code, so the package passes the allowlist rule "LGPL-2.1+ only for
  separately loaded, unmodified WASM chunks with source link". The chunk is the unmodified npm
  release, bundled and re-minified by Vite.
- The upstream package does not record which FFmpeg version it was built from.

The npm metadata reports MPL-2.0, so the embedded LGPL code is not visible to `pnpm licenses`.
`scripts/check-licenses.mjs` keeps an explicit per-package exception (`LGPL_WASM_EXCEPTIONS`):
LGPL-2.1-or-later is accepted for `@mediabunny/aac-encoder` only, and for no other package. The
dependency is pinned to the audited version; re-run the audit before upgrading it.

Full notices, including the MPL-2.0 and LGPL-2.1 texts, are in `THIRD-PARTY-LICENSES.txt`. The build
copies it to `dist/THIRD-PARTY-LICENSES.txt` and the page footer links to it. `pnpm check:licenses` reads
`pnpm licenses list --prod --json`, fails on any licence outside the allowlist (MIT, BSD-2/3-Clause,
ISC, Apache-2.0, 0BSD, MPL-2.0, plus the per-package LGPL exception above) and fails if a production package has no entry in
`THIRD-PARTY-LICENSES.txt`. It runs in `pnpm build` and in the Pages workflow.
