# VideoAdjust

[![Tests](https://github.com/bradsec/videoadjust/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/bradsec/videoadjust/actions/workflows/tests.yml)
[![Version](https://img.shields.io/github/package-json/v/bradsec/videoadjust)](package.json)
[![License: MIT](https://img.shields.io/github/license/bradsec/videoadjust)](LICENSE)
[![Live site](https://img.shields.io/website?url=https%3A%2F%2Fvideoadjust.com%2F&label=videoadjust.com)](https://videoadjust.com/)

Compress, convert, resize, trim and extract audio from videos. Fast, private, and processed entirely in your browser. Nothing is uploaded.

Pick a video, trim it, choose a tool and its settings, then export. Video output defaults to MP4 with H.264 video and
AAC audio; WebM (VP9, AV1, Opus) is also available. Frames are never upscaled and the frame rate
is never raised. Conversion runs locally on WebCodecs through
[Mediabunny](https://mediabunny.dev/). No ffmpeg.wasm.

Live site: https://videoadjust.com/

## Privacy

No video is uploaded and nothing is sent anywhere. The page is static, has no analytics, web fonts or
CDN assets, and makes no requests to other origins. Its CSP only allows `'self'`, `blob:` and
workers. `scripts/check-no-remote.mjs` (`pnpm check:remote`, part of `pnpm build`) fails the build if
any built file contains a URL outside a short, commented allowlist (spec links in bundled comments). It does not need `SharedArrayBuffer` or COOP/COEP
headers.

## Theme

The app is dark for everyone, whatever the system colour scheme. The "Light theme" switch in the header
turns on the light theme. The choice is the only thing the app stores: `localStorage` key
`videoadjust-theme`, value `light` or `dark`. If storage is blocked the app stays dark and the switch
still works for the open page. `public/theme-init.js` applies the saved theme before first paint; it is
a separate same-origin file because the CSP blocks inline scripts.

## Browser support

Support is probed at runtime from what the browser reports (WebCodecs encoders per codec, native or
fallback AAC, save picker, file sharing). The app disables what a browser cannot do and says why;
this README does not claim any specific browser version works. What the e2e suite saw in this
repository (Playwright's bundled Chromium and WebKit engines, 1280x720 probe):

| Engine              | H.264 | HEVC | AV1 | VP9 | AAC                         | Opus | Save picker |
| ------------------- | ----- | ---- | --- | --- | --------------------------- | ---- | ----------- |
| Chromium (headless) | yes   | no   | yes | yes | yes, via the fallback chunk | yes  | yes         |
| WebKit              | yes   | yes  | yes | yes | yes, native                 | yes  | no          |

Firefox and Chrome on Linux have no native WebCodecs AAC encoder, so the app lazy-loads the
`@mediabunny/aac-encoder` chunk (about 1 MB) the first time it needs AAC. The service worker caches
that chunk too, so export still works offline there. Firefox, Safari on real iPhone and iPad
hardware, and other browsers are not covered by the automated tests; see "Manual device check".

## Size guidance

Designed and tested for inputs up to 2 GB. Above 2 GB the app warns and lets you continue. Where there
is no save picker (iOS Safari, Firefox) the output stays in memory until you download or share it, and a
large estimate asks before it starts.

## Offline

A service worker (`public/sw.js`, registered only in production builds) precaches every built file,
including the lazy AAC and MP3 encoder chunks. Navigations are network-first, revalidated with the server (so the host's max-age cannot serve an
old page), with the cache used when offline or after 4 s; hashed assets are cache-first. The previous
version's cache is kept until the next update so an open tab can still load the AAC chunk. The build fills in the file list and
a cache version at build time.

## Development

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev            # dev server
pnpm build          # licence check, type check, production build into dist/, remote-URL check
pnpm typecheck      # TypeScript check
pnpm lint           # ESLint
pnpm format:check   # Prettier check
pnpm format         # format supported files
pnpm check:size     # fail if any dist/ file exceeds 25 MiB
pnpm check:remote   # alone: scan dist/ for remote request targets
scripts/make-icons.sh   # regenerate public/ icons from scripts/icons/*.svg (needs inkscape, ImageMagick)
pnpm test           # unit tests (vitest)
pnpm test:e2e       # Playwright (chromium, webkit, iPhone 15, iPad Pro 11)
scripts/make-fixtures.sh   # regenerate tests/fixtures (needs ffmpeg)
```

First e2e run needs browsers: `pnpm exec playwright install chromium webkit`.

On the prepare screen, choose Shrink video or Extract audio from the tabs under the header (in the
header centre on wide screens). The estimate and the Export or Extract audio button sit together
in a dock: fixed to the bottom of the screen on phones (under 700px wide), and at the foot of the
settings panel on wider screens. Extract audio is unavailable when
the source has no usable audio track. Both tools use the same trim. Drag the trim handles or use
arrow keys to adjust by 0.1 seconds.
Hold Shift with an arrow key for 1-second steps. Use Start here or End here to set
a boundary at the preview playhead. The kept duration and summary estimate update as you trim.
If the browser cannot play the preview, the handles and thumbnails still work. Start here and
End here are disabled because they need a playhead.
Shrink's summary card shows the estimated output range against the original size. Open Adjust to
change format, codec, resolution, frame rate, quality, or audio. Each setting has a reset button.
Unavailable codecs show why they cannot be selected. WebM uses Opus audio. The quality control
and audio bitrates stay within the source limits. Quality keeps the same percentage when you
change codec, resolution, or frame rate. Reset Quality returns to 100% for the current video
settings. If the source is already small, the summary
offers Export trimmed copy, which keeps the source video and audio tracks. Select Re-encode anyway
to use the adjustment controls.

Extract audio defaults to MP3. Open Adjust to choose MP3, M4A (AAC), or WAV, plus bitrate and
mono or stereo where available. M4A copies the source audio without re-encoding when the source
is AAC at or below the target bitrate; otherwise it encodes AAC at the target. MP3 and WAV are
always encoded. WAV is 16-bit PCM with no bitrate control, so files are large. The audio summary
shows the estimated size and kept duration.

Export saves straight to a file you pick where the browser supports a save picker (Chromium).
Elsewhere the new file stays in memory until you download or share it; a large in-memory export
asks before it starts. The progress screen shows percent, elapsed and remaining time, and bytes
written; Cancel returns to the prepare screen with your settings, and says when a partial file
may remain at the chosen location. The result screen compares original and new in a table and,
for in-memory exports, with a wipe view (drag the divider or use the arrow keys on it; Frame mode
steps one frame at a time). If the new file is not smaller, the result says so and Make it smaller
moves to the next smaller size, or lowers quality one step when no smaller size is left.

## Hosting

Cloudflare Pages, using its Git integration on this repo. Build settings:

- Build command: `pnpm build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION=22`
- Production branch: `main`
- Custom domain: `videoadjust.com`

`public/_headers` supplies the security headers (CSP and others). The output uses a relative base,
so it also runs under a subpath. No asset may exceed 25 MiB (Cloudflare Pages limit);
`pnpm check:size` verifies every built file.

`.github/workflows/tests.yml` runs checks, unit tests, browser tests and a build on pushes and pull
requests. Cloudflare deploys on every push to `main` independently of the Tests workflow, so a red
Tests run does not block a deploy.

## Licences

This project is MIT (see `LICENSE`). Production dependencies:

| Package                           | Licence                                                                 | Source                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| mediabunny                        | MPL-2.0 (unmodified)                                                    | https://github.com/Vanilagy/mediabunny                                                          |
| @mediabunny/aac-encoder           | MPL-2.0 (unmodified), embeds FFmpeg AAC encoder under LGPL-2.1-or-later | https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder                           |
| @mediabunny/mp3-encoder           | MPL-2.0 (unmodified), embeds LAME 3.100 under LGPL-2.0-or-later         | https://github.com/Vanilagy/mediabunny/tree/main/packages/mp3-encoder                           |
| @types/dom-webcodecs              | MIT (type declarations only, not shipped)                               | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-webcodecs              |
| @types/dom-mediacapture-transform | MIT (type declarations only, not shipped)                               | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-mediacapture-transform |

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

### MP3 fallback encoder

MP3 always uses the bundled LAME encoder, `@mediabunny/mp3-encoder`, registered with its
documented `registerMp3Encoder()` call, even where WebCodecs reports native MP3 support. The
native encoder is not trusted: in Playwright WebKit it ignored the requested bitrate and cut off
the end of the audio. The app loads the encoder with a dynamic `import()` on the first MP3 export,
so it ships as a separate same-origin chunk that the capability probe never loads. The WASM and the encode worker
(a `blob:` worker, allowed by the CSP) are embedded in that chunk.

Licence audit (version 1.62.0, 2026-10-22):

- The npm package declares MPL-2.0. Its WASM is LAME 3.100, whose source headers grant the GNU
  Library General Public License version 2 or any later version (LGPL-2.0-or-later).
- The build uses `--disable-decoder --disable-frontend`, so LAME's GPL mpglib decoder is absent.
- `scripts/check-licenses.mjs` lists `@mediabunny/mp3-encoder` in `LGPL_WASM_EXCEPTIONS`, so
  LGPL is accepted for it and for `@mediabunny/aac-encoder` only. Re-run the audit before upgrading.
- LAME asks for acknowledgement and a link to https://lame.sourceforge.io/, given here and in
  `THIRD-PARTY-LICENSES.txt`.

Full notices, including the MPL-2.0, LGPL-2.1 and LGPL-2.0 texts, are in `THIRD-PARTY-LICENSES.txt`. The build
copies it to `dist/THIRD-PARTY-LICENSES.txt` and the page footer links to it. `pnpm check:licenses` reads
`pnpm licenses list --prod --json`, fails on any licence outside the allowlist (MIT, BSD-2/3-Clause,
ISC, Apache-2.0, 0BSD, MPL-2.0, plus the per-package LGPL exception above) and fails if a production package has no entry in
`THIRD-PARTY-LICENSES.txt`. It runs in `pnpm build` and in the Tests workflow.

## Manual device check

Playwright cannot drive real touch dragging or the iOS share sheet, so the owner checks these on
real hardware before a release. Record each result; leave a line empty until it has been run.

Steps: open the live site, drop a recent phone video (portrait, rotation metadata), drag the trim
handles by touch, export, compare, then share or download. Turn on airplane mode after the first
load and confirm the page still opens. Then switch to Extract audio, extract MP3 and M4A, and
confirm the result plays and can be shared or downloaded, also in airplane mode for MP3.

- iPhone (model, iOS version, date):
  - Result:
  - Extract audio (MP3, M4A, WAV):
- iPad (model, iPadOS version, date):
  - Result:
  - Extract audio (MP3, M4A, WAV):
