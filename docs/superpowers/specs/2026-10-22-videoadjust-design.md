# videoadjust design

Date: 2026-10-22

## Intent

Videos from phones and cameras are often too large to send by message or
email. videoadjust shrinks a video in the browser so it can be sent, without
uploading it anywhere. It joins the owner's other fully client-side apps
(rastertrace, forgeview, pdfmerge, pdfprotect): static files, private, local,
hosted on GitHub Pages or Cloudflare Pages.

## Goals

- Drag and drop (or pick) one video; the app reads it and proposes settings.
- Auto-detect settings that make the output as small as possible while
  preserving visible quality where possible.
- Every auto-picked setting can be overridden: trim start/end, resolution,
  frame rate, container, video codec, quality or bitrate, audio codec, audio
  bitrate, or audio removed.
- Default output is the most compatible format across platforms and devices:
  MP4, H.264 video, AAC audio.
- Easy trim: a visual start/end control with preview, usable by touch.
- Before/after comparison of original and output: file size, resolution,
  bitrate, duration, and visual comparison of the video itself.
- Works well on phone, tablet and desktop (as rastertrace does), including
  iPhone/iPad Safari.
- Estimated output size shown before export; actual size shown after.

## Non-goals (v1)

- Batch processing of multiple files.
- Editing beyond trim (crop, filters, text, joining clips, subtitles).
- Destination presets tied to specific services' size limits. The goal is
  "smallest at good quality", not "fit under N MB". A target-size mode can
  come later.
- A full ffmpeg feature set. The ffmpeg-like scope is shrink, trim, and
  format/codec conversion.

## Anti-goals

- Any upload, telemetry, or third-party network call with user media.
- Output that fails to play on common phones or mail clients by default.
- Upscaling, or silently producing a file larger than the original without
  telling the user.
- Crashing the tab on large phone videos (memory blow-ups).
- Third-party code from unreputable sources, unmaintained packages, or
  licences incompatible with a public static site.

## Constraints

- **Self-contained (owner's decision):** everything is local and in the
  repo. No CDN scripts, web fonts, analytics, or runtime fetches from other
  origins. All libraries, WASM, fonts and icons are bundled into the build
  and served from the app's own origin. Third-party licences are collected
  in `THIRD-PARTY-LICENSES.txt`, as in rastertrace.
- **Private, no uploads (owner's decision):** user media never leaves the
  device. Enforced by CSP (`connect-src 'self'`) and an e2e test that fails
  on any request to another origin.
- **Licensing (owner's decision):** every shipped third-party component must
  have a licence that permits use in a public static site, verified per
  package and enforced by a build-time licence check. GPL-family and
  non-commercial licences are rejected.
- Static hosting only. Must run on GitHub Pages under a repository subpath
  (relative asset base) and on Cloudflare Pages.
- Cloudflare Pages caps each asset at 25 MiB.
- GitHub Pages cannot set COOP/COEP headers. The v1 engine must not need
  `SharedArrayBuffer` / cross-origin isolation.
- Dependencies from GitHub or other reputable sources, actively maintained,
  current versions, licence recorded in the README.

## Decisions

### Owner's decisions

- Auto settings by default, user override for everything.
- Optimise for smallest size while preserving quality, not a size target.
- Most compatible format by default.
- Main features: shrink, trim, original vs new comparison.
- Phone, tablet and desktop all supported.
- Plans and mockups are reviewed on phone/tablet, so mockups are delivered
  as images (PNG).

### Builder's calls made during design (owner may revise)

- **Stack:** vanilla TypeScript + Vite, Vitest unit tests, Playwright e2e
  with `@axe-core/playwright`, matching jiffyedit and imagemarkup. Current
  stable versions at build time. Use the package manager of the most recent
  sibling with a Pages workflow (forgeview uses pnpm); record the choice in
  the README.
- **Engine:** [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0,
  1.61.x as of Oct 2026) on WebCodecs. Its Conversion API covers trim,
  resize, frame rate, codec, quality/bitrate, audio settings, and packet
  copy where no re-encode is needed. Reads MP4, MOV, MKV, WebM, Ogg, TS.
- **No ffmpeg.wasm in v1.** It needs ~31 MB cores (over the Cloudflare
  asset cap), its published cores are GPL-2.0-or-later, it is many times
  slower than hardware encode, and multithreading needs cross-origin
  isolation. Revisit only for confirmed input formats WebCodecs cannot
  decode.
- **AAC gap:** WebCodecs AAC encode is missing in Firefox, on Chrome desktop
  Linux, and in Safari before 26. Use
  [`@mediabunny/aac-encoder`](https://mediabunny.dev/guide/extensions/aac-encoder)
  as the fallback, after an artifact-level licence check of its embedded
  FFmpeg code (must be LGPL-compatible). If it fails the check, fall back to
  copying the source audio when it is already AAC, else Opus in MP4 with a
  compatibility warning.
- **Capability probing:** never trust a static browser matrix. Probe
  `VideoEncoder.isConfigSupported()` and `AudioEncoder.isConfigSupported()`
  for the exact codec string, dimensions and rate, and only offer what the
  running browser supports. Unsupported choices are shown disabled with a
  reason.
- **Override set:** containers MP4 and WebM. MP4 video: H.264 (default),
  HEVC, AV1. WebM video: VP9, AV1. Audio: AAC (MP4 default), Opus (WebM
  default, also allowed in MP4), or none. Only probed-supported options are
  enabled.
- **No H.264 encoder:** do not switch silently. Explain that the most
  compatible format is unavailable in this browser, and offer the best
  probed alternative (HEVC MP4, then VP9/AV1 WebM) with a compatibility
  warning naming where it may not play.
- **Large files:** read input with Mediabunny `BlobSource` (chunked, no full
  load). Write output with `StreamTarget` to a user-chosen file via the File
  System Access API where available; elsewhere (iOS Safari, Firefox) use
  `BufferTarget` or an OPFS-staged write, with a clear size warning when the
  expected output is large relative to device memory.
- **Offline:** web manifest plus a service worker that precaches the build,
  following rastertrace. Network-free after first load.
- **CI (owner's decision):** a `Tests` workflow on every push and pull
  request (licence check, typecheck, lint, format, unit, e2e, build, asset
  size), with README badges, matching rastertrace. Deploy runs only after
  tests pass on `main`.
- **Hosting:** GitHub Actions Pages workflow (test, build with relative base,
  deploy) like forgeview, plus a Cloudflare `_headers` file with security
  headers like pdfmerge/pdfprotect. CSP allows only self, `blob:`, and
  workers.

## Auto settings ("smallest, quality preserved")

The builder tunes the exact numbers. The rules:

1. Never upscale. Cap the long edge at 1920 when the source is larger, and
   offer 1280 and 854 as one-tap "smaller" steps. Keep aspect ratio and
   rotation metadata; force even dimensions.
2. Frame rate: keep it if it is at or below 30 fps; reduce 50/60+ fps to
   half (25/30). Never raise it.
3. Video: H.264 (High profile where supported, else Main), quality-driven
   rather than fixed bitrate. Use a bits-per-pixel-per-frame target derived
   from output resolution and fps, and never exceed the source video bitrate.
4. Audio: AAC-LC, 128 kbps stereo by default, 96 kbps for mono or speech-like
   low-bitrate sources. Never exceed the source audio bitrate. If the source
   audio is already AAC at or below target, copy it without re-encoding.
5. If the source is already H.264/AAC MP4 and already at or below target
   settings, say so and offer trim-only (packet copy when the trim start
   allows it; Mediabunny re-encodes on a non-zero trim start).
6. Estimated size = (video bitrate + audio bitrate) x trimmed duration. Show
   it as a range, labelled as an estimate.
7. If the output ends up larger than the input, tell the user and offer
   the smaller resolution step.

## Screens and flow

One page, three states, single column on phones, two columns on wide
screens.

1. **Drop.** Large drop zone with a "choose video" button (opens the native
   picker, which matters on iOS). States that nothing leaves the device.
2. **Prepare.** Video preview with a trim bar under it: draggable start/end
   handles sized for touch, frame thumbnails, current time readouts, and
   "set start/end at playhead" buttons. Beside or below: a summary card
   ("1080p, H.264/AAC MP4, est. 18-24 MB, from 212 MB") with one big Export
   button. An "Adjust" disclosure exposes all overrides, each showing the
   auto value and a reset.
3. **Result.** Progress (percentage, elapsed, estimate, cancel), then the
   comparison: size, resolution, bitrate, codec, duration for original vs
   new, the reduction percentage, and visual comparison. Visual comparison
   uses synced playback with a draggable wipe slider over a single viewport,
   plus a paused-frame mode for close inspection. Download/Save, Share
   (Web Share API with files, where supported, for phones), and "try
   smaller" / "start over".

Mockups are delivered as PNG images for the owner to review before UI work.

## Errors and limits

- **Size target (owner's decision):** handle whatever the browser can
  safely process on iPhone, iPad, Android and desktop; files do not need to
  be massive. Design and test for inputs up to 2 GB (about 10 minutes of 4K
  phone video). Above 2 GB, warn that the device may run out of memory and
  let the user continue. Refuse only when the device cannot store the output
  (storage estimate or save target unavailable), with the reason shown.

- Unsupported input (no decoder for its codec): say which codec and which
  browsers can handle it; do not fail silently.
- Encoder unavailable for a chosen setting: disable the option with a reason.
- Out of memory or tab kill risk: warn before starting on very large inputs
  on mobile; keep memory bounded through streaming.
- Cancel must stop work and release resources.

## Testing

- Unit tests (Vitest) for the auto-settings rules, size estimation, codec
  string building, and capability filtering, using recorded probe results.
- E2E (Playwright, Chromium and WebKit, desktop and mobile viewports) with
  small fixture clips: drop, trim, export, comparison, accessibility via axe.
- Manual device check on iPhone and iPad Safari before release, recorded in
  the README.

## Left to the builder

- Exact bitrate/bpp constants and quality ladder.
- Component structure, styling and design tokens (no shared package exists
  across sibling apps; derive a look suited to the product, not a template).
- Thumbnail strip generation approach.
- Licence audit result for the AAC fallback.

## Research sources

- Mediabunny: https://mediabunny.dev/guide/converting-media-files,
  https://mediabunny.dev/guide/supported-formats-and-codecs
- ffmpeg.wasm: https://ffmpegwasm.netlify.app/docs/faq/,
  https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/packages/core/package.json
- WebCodecs codec selection: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
- Cloudflare Pages limits/headers: https://developers.cloudflare.com/pages/platform/limits/,
  https://developers.cloudflare.com/pages/configuration/headers/
