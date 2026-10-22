# videoadjust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, offline-capable browser app that shrinks one video at a time (auto settings, overrides, trim) and compares original vs output, with no upload.

**Architecture:** Pure TypeScript core modules (source probe, capability probe, auto settings, size estimate, output sink, conversion) wrap Mediabunny on WebCodecs. Thin vanilla-DOM UI modules render three states (drop, prepare, result) driven by one app controller. Everything bundles with Vite into `dist/` and deploys to GitHub Pages or Cloudflare Pages.

**Tech Stack:** TypeScript (strict), Vite, Mediabunny, `@mediabunny/aac-encoder` (conditional on licence audit), Vitest, Playwright + `@axe-core/playwright`, pnpm. Current stable versions at build time.

**Spec:** `docs/superpowers/specs/2026-10-22-videoadjust-design.md`

## Global Constraints

- Everything local and self-contained in the repo: no CDN scripts, web fonts, analytics, or runtime fetches to other origins. Libraries, WASM, fonts, icons bundled and served same-origin.
- Third-party licences collected in `THIRD-PARTY-LICENSES.txt`; licence and source recorded in README for each dependency.
- Licence allowlist for every shipped (production) dependency: MIT, BSD-2/3-Clause, ISC, Apache-2.0, 0BSD, MPL-2.0 (unmodified files only; keep its notice and link the upstream source), LGPL-2.1+ only for separately loaded, unmodified WASM chunks with source link. GPL, AGPL, SSPL, fdk-aac, "non-commercial" and unlicensed code are rejected. Dev-only tools may use any OSI licence. Sources: npm packages whose repository is on GitHub with recent releases.
- No user media leaves the device. CSP allows only `'self'`, `blob:`, and workers.
- Must not require `SharedArrayBuffer` or COOP/COEP.
- Relative Vite `base` (`./`) so it runs under a GitHub Pages repo subpath.
- No asset over 25 MiB (Cloudflare Pages cap).
- No ffmpeg.wasm.
- Default output: MP4, H.264, AAC.
- Never upscale. Long-edge cap 1920; smaller steps 1280 and 854. Even dimensions.
- Frame rate: keep if <= 30; halve if >= 50. Never raise.
- Audio default AAC-LC 128 kbps stereo, 96 kbps mono. Never exceed source audio bitrate.
- Design and test for inputs up to 2 GB; above 2 GB warn and allow continue.
- Phone, tablet, desktop; iPhone/iPad Safari first-class.
- Mockups delivered to the owner as PNG images and approved before UI tasks.
- Do not commit or push unless the owner asks (owner's global rule overrides the per-task "Commit" steps: stage and stop, or commit only once authorised).
- No emojis, no em dashes in code, comments, docs.

## Review Focus

1. **Portrait phone video with rotation metadata** (90/270). Expect correct on-screen orientation, long-edge cap applied to the displayed long edge, and preview/compare not sideways. Test: Task 2 `autoSettings` portrait case; Task 12 e2e with `portrait-rot90.mp4`.
2. **Video with no audio track** (screen recordings, some camera clips). Expect export to work, audio settings hidden, estimate excludes audio. Test: Task 2 `no-audio` case; Task 6 conversion with `noaudio.mp4`.
3. **Trim handles crossing or past duration** (drag end before start, touch overshoot). Expect clamp so `0 <= start < end <= duration` with a minimum span of 0.1 s. Test: Task 9 `clampTrim` unit tests.
4. **Output not smaller than input** (already-compressed clip). Expect the user is told and offered the next smaller step, not a silent bigger file. Test: Task 2 `alreadyOptimal` and Task 11 result-state test.
5. **No `showSaveFilePicker` (iOS Safari, Firefox)** with a large output. Expect in-memory fallback with a warning when estimate exceeds the memory threshold, never a crash path without warning. Test: Task 5 `chooseSink` cases.

---

## File Structure

```
index.html                    app shell, CSP meta
vite.config.ts                base './', worker format 'es'
src/main.ts                   bootstrap, register SW
src/core/types.ts             shared types (below)
src/core/autoSettings.ts      pure rules: source + caps -> Settings
src/core/estimate.ts          pure size estimate
src/core/capabilities.ts      WebCodecs probing, AAC fallback registration
src/core/source.ts            read File with Mediabunny -> SourceInfo
src/core/sink.ts              choose output target (file stream / memory)
src/core/convert.ts           Settings -> Mediabunny Conversion, progress, cancel
src/ui/app.ts                 state machine: drop | prepare | working | result
src/ui/dropZone.ts
src/ui/trimBar.ts             + clampTrim (pure, exported)
src/ui/settingsPanel.ts
src/ui/progress.ts
src/ui/compare.ts             wipe slider, synced playback
src/ui/format.ts              bytes/bitrate/duration formatting (pure)
src/styles/tokens.css, app.css
public/site.webmanifest, sw.js, icons, _headers, robots.txt
scripts/make-fixtures.sh      generates test clips with system ffmpeg (dev only)
tests/fixtures/*.mp4|webm     small generated clips, committed
tests/unit/*.test.ts
e2e/*.spec.ts
docs/mockups/*.png
.github/workflows/pages.yml
README.md, LICENSE, THIRD-PARTY-LICENSES.txt
```

### Shared types (`src/core/types.ts`, created in Task 2)

```ts
export type Container = 'mp4' | 'webm';
export type VideoCodecId = 'avc' | 'hevc' | 'av1' | 'vp9';
export type AudioCodecId = 'aac' | 'opus';

export interface SourceInfo {
  name: string;
  sizeBytes: number;
  durationSec: number;
  containerMime: string;
  video: null | {
    codec: string | null;      // Mediabunny codec id, null if unknown
    decodable: boolean;
    displayWidth: number;      // after rotation
    displayHeight: number;
    rotation: 0 | 90 | 180 | 270;
    fps: number;
    bitrate: number | null;    // bits/s, estimated from packet stats
  };
  audio: null | {
    codec: string | null;
    decodable: boolean;
    channels: number;
    sampleRate: number;
    bitrate: number | null;
  };
}

export interface Capabilities {
  video: Record<VideoCodecId, boolean>;   // probed at 1280x720 30fps
  audio: Record<AudioCodecId, boolean>;   // native or via fallback
  aacViaFallback: boolean;
  fileStreamSave: boolean;                // window.showSaveFilePicker
  shareFiles: boolean;                    // navigator.canShare({files})
}

export interface Settings {
  container: Container;
  trim: { start: number; end: number };
  video: null | { codec: VideoCodecId; width: number; height: number; fps: number; bitrate: number };
  audio: null | { codec: AudioCodecId; bitrate: number; channels: number; copy: boolean };
}

export interface AutoResult {
  settings: Settings;
  alreadyOptimal: boolean;      // spec rule 5
  sizeSteps: number[];          // long-edge options <= source, e.g. [1920, 1280, 854]
  notes: string[];              // user-facing reasons, e.g. "No H.264 encoder in this browser"
}
```

---

### Task 1: Scaffold, tooling, hosting

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `src/main.ts`, `public/_headers`, `public/robots.txt`, `.github/workflows/pages.yml`, `.gitignore`, `LICENSE`, `README.md`, `THIRD-PARTY-LICENSES.txt`, `scripts/make-fixtures.sh`, `tests/fixtures/*`
- Test: `tests/unit/smoke.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:** Produces scripts `pnpm dev`, `pnpm build` (`tsc --noEmit && vite build`), `pnpm test` (vitest run), `pnpm test:e2e`.

- [ ] **Step 1:** `pnpm init`; add dev deps `typescript vite vitest @playwright/test @axe-core/playwright`, dep `mediabunny`. Copy tsconfig strictness and Playwright project layout from `../jiffyedit` (Chromium, WebKit, plus `devices['iPhone 15']` and `devices['iPad Pro 11']` projects).
- [ ] **Step 2:** `vite.config.ts`: `base: './'`, `worker: { format: 'es' }`, `build.assetsInlineLimit: 0`.
- [ ] **Step 3:** `index.html` with CSP meta `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'`. `public/_headers` mirrors CSP plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, following `../../pdfprojects/pdfmerge/_headers`.
- [ ] **Step 4:** `scripts/make-fixtures.sh` generates with `ffmpeg -f lavfi testsrc2`/`sine`, each under 1 MB, 3 s unless noted: `land-1080p30-aac.mp4`, `land-4k60-aac.mp4` (2 s), `portrait-rot90.mp4` (1080x1920 coded 1920x1080 with `-metadata:s:v rotate=90`, or display matrix), `noaudio.mp4`, `mono-aac.mp4`, `vp9-opus.webm`, `small-h264-lowbitrate.mp4` (640x360, 300 kbps). Run it; commit outputs.
- [ ] **Step 5:** smoke tests: unit test asserts `vite.config.ts` exports `base === './'`; e2e loads `/`, asserts title `videoadjust` and zero axe violations; also asserts no request leaves the origin (`page.on('request')` host check).
- [ ] **Step 6:** `.github/workflows/pages.yml` modelled on `../forgeview/.github/workflows/pages.yml`: pnpm install, `pnpm test`, `pnpm build`, upload `dist`, deploy.
- [ ] **Step 7:** Add `scripts/check-licenses.mjs` and `pnpm check:licenses`: reads `pnpm licenses list --prod --json`, fails on any licence outside the Global Constraints allowlist, and fails if any production package lacks an entry in `THIRD-PARTY-LICENSES.txt`. Run it in `pnpm build` and in the Pages workflow. Unit test it with a fixture JSON containing one `GPL-3.0` package (expect exit 1) and one all-MIT list (expect exit 0).
- [ ] **Step 8:** Run `pnpm build && pnpm test && pnpm test:e2e`. Expected: all pass; `find dist -size +25M` prints nothing.
- [ ] **Step 9:** Stage; commit only if authorised: `chore: scaffold videoadjust`.

### Task 2: Auto settings rules (pure)

**Files:** Create `src/core/types.ts`, `src/core/autoSettings.ts`; Test `tests/unit/autoSettings.test.ts`

**Interfaces:**
- Produces: `autoSettings(src: SourceInfo, caps: Capabilities): AutoResult`; `scaleToLongEdge(w: number, h: number, longEdge: number): { width: number; height: number }`; `targetVideoBitrate(codec: VideoCodecId, w: number, h: number, fps: number): number`; exported constants `LONG_EDGE_CAP = 1920`, `SIZE_STEPS = [1920, 1280, 854]`, `BPP: Record<VideoCodecId, number> = { avc: 0.07, hevc: 0.045, av1: 0.04, vp9: 0.05 }`, `AUDIO_STEREO_BPS = 128_000`, `AUDIO_MONO_BPS = 96_000`.

- [ ] **Step 1: Write failing tests** (`fakeSource()` / `allCaps()` helpers in the test file):
  - `3840x2160@60` avc source -> video `{ codec: 'avc', width: 1920, height: 1080, fps: 30 }`, container `'mp4'`, audio `{ codec: 'aac', bitrate: 128000, channels: 2 }`.
  - `1280x720@30` -> width 1280 (no upscale), fps 30.
  - portrait display `1080x1920`, rotation 90 -> `width: 1080, height: 1920` (cap applies to displayed long edge, already <= 1920).
  - portrait `2160x3840` -> `1080x1920`.
  - odd `1921x1081` -> both dimensions even.
  - fps 50 -> 25; fps 24 -> 24; fps 59.94 -> 29.97.
  - `targetVideoBitrate('avc', 1920, 1080, 30)` === `Math.round(1920*1080*30*0.07)`; result clamped to `src.video.bitrate` when source lower.
  - mono source -> audio bitrate 96000, channels 1.
  - source audio aac at 96 kbps stereo -> `audio.copy === true`, bitrate 96000.
  - `video: null` source (no video) handled: `settings.video === null`; `audio: null` source -> `settings.audio === null`.
  - `small-h264-lowbitrate` style source (avc/aac mp4, 640x360, bitrate below target) -> `alreadyOptimal === true`.
  - caps with `avc: false, hevc: true` -> codec `'hevc'`, container `'mp4'`, `notes` contains `"H.264"`; caps with only `vp9` -> container `'webm'`, audio codec `'opus'`.
  - caps with `aac: false, opus: true`, source audio not aac -> audio `opus` in mp4 and a note mentioning compatibility.
  - `sizeSteps` for 1280-wide source === `[1280, 854]`; for 4K === `[1920, 1280, 854]`.
  - trim defaults to `{ start: 0, end: src.durationSec }`.
- [ ] **Step 2:** `pnpm vitest run tests/unit/autoSettings.test.ts` -> FAIL, module not found.
- [ ] **Step 3:** Implement. Video codec fallback order `avc, hevc, vp9, av1`; container `mp4` for avc/hevc/av1 unless only vp9 is available. fps rule: `fps >= 50 ? fps / 2 : fps`. Dimensions: scale, then round each down to even.
- [ ] **Step 4:** Run tests -> PASS.
- [ ] **Step 5:** Stage; commit if authorised: `feat: auto settings rules`.

### Task 3: Size estimate and formatting (pure)

**Files:** Create `src/core/estimate.ts`, `src/ui/format.ts`; Test `tests/unit/estimate.test.ts`, `tests/unit/format.test.ts`

**Interfaces:** Produces `estimateBytes(s: Settings): { low: number; high: number; mid: number }`; `formatBytes(n: number): string`; `formatBitrate(bps: number): string`; `formatDuration(sec: number): string`.

- [ ] **Step 1: Failing tests:** `mid = ((video?.bitrate ?? 0) + (audio?.bitrate ?? 0)) * (end - start) / 8 * 1.01`; `low = mid * 0.85`, `high = mid * 1.15`. Zero-length trim -> 0s. `formatBytes(18_400_000)` -> `"18.4 MB"` (decimal units); `formatBitrate(4_350_000)` -> `"4.35 Mbps"`; `formatDuration(75.5)` -> `"1:15.5"`.
- [ ] **Step 2:** Run -> FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run -> PASS.
- [ ] **Step 5:** Stage/commit: `feat: size estimate and formatting`.

### Task 4: Capability probing and AAC fallback

**Files:** Create `src/core/capabilities.ts`; Modify `THIRD-PARTY-LICENSES.txt`, `README.md`; Test `tests/unit/capabilities.test.ts`, `e2e/capabilities.spec.ts`

**Interfaces:**
- Produces: `probeCapabilities(deps?: ProbeDeps): Promise<Capabilities>`; `type ProbeDeps = { canEncodeVideo: typeof import('mediabunny').canEncodeVideo; canEncodeAudio: typeof import('mediabunny').canEncodeAudio; registerAacFallback: () => Promise<boolean>; win: Pick<Window, 'showSaveFilePicker'> & { navigator: Navigator } }` (defaults to real implementations).

- [ ] **Step 1: Licence audit (gate).** Inspect the published `@mediabunny/aac-encoder` package: its `package.json` licence, the embedded FFmpeg/fdk components, and build config. Pass only if all embedded code is LGPL-2.1+ or more permissive (fdk-aac fails). Record result and reasoning in README "Licences". If it fails, `registerAacFallback` returns `false` and is not installed as a dependency.
- [ ] **Step 2: Failing unit tests** with stub deps: native aac `true` -> `aacViaFallback: false`; native aac `false`, fallback `true` -> `audio.aac: true, aacViaFallback: true`; both false -> `audio.aac: false`; probe for each video codec uses `{ width: 1280, height: 720, frameRate: 30 }`; a rejecting `canEncodeVideo` counts as `false` (no throw); `fileStreamSave` reflects `'showSaveFilePicker' in win`; `shareFiles` uses `navigator.canShare?.({ files: [new File([], 'x.mp4', { type: 'video/mp4' })] }) === true`.
- [ ] **Step 3:** Run -> FAIL.
- [ ] **Step 4:** Implement. Load the AAC encoder with dynamic `import()` so its WASM is a separate same-origin chunk fetched only when needed. Use the registration call named in the package docs; verify name in its README.
- [ ] **Step 5:** e2e (Chromium + WebKit): page exposes `window.__caps` in dev/test builds only; assert `video.avc === true` on Chromium.
- [ ] **Step 6:** Run unit + e2e -> PASS. Check `dist` asset sizes < 25 MiB.
- [ ] **Step 7:** Stage/commit: `feat: capability probing with AAC fallback`.

### Task 5: Source reading and output sink

**Files:** Create `src/core/source.ts`, `src/core/sink.ts`; Test `tests/unit/sink.test.ts`, `e2e/source.spec.ts`

**Interfaces:**
- Produces: `readSource(file: File): Promise<{ info: SourceInfo; input: import('mediabunny').Input }>` (uses `new Input({ source: new BlobSource(file), formats: ALL_FORMATS })`, track `displayWidth/displayHeight/rotation`, `computePacketStats()` for fps and bitrate, `canDecode()` for `decodable`). Throws `UnsupportedSourceError` with `codec` field when no video and no audio track decodes.
- Produces: `chooseSink(opts: { estimateBytes: number; fileStreamSave: boolean; deviceMemoryGB?: number }): SinkPlan`; `type SinkPlan = { kind: 'file-stream' } | { kind: 'memory'; warn: boolean }`; `MEMORY_WARN_FRACTION = 0.25`; `openSink(plan: SinkPlan, suggestedName: string, mime: string): Promise<{ target: import('mediabunny').Target; finish(): Promise<Blob | null> }>` (`StreamTarget` on `FileSystemWritableFileStream` with `chunked: true` for file-stream, `BufferTarget` for memory; `finish` returns the Blob for memory, `null` for file-stream).

- [ ] **Step 1: Failing unit tests for `chooseSink`:** `fileStreamSave: true` -> `file-stream`; false with estimate 100 MB and deviceMemory 4 -> `memory, warn: false`; false with estimate 1.5 GB and deviceMemory 4 -> `warn: true`; deviceMemory undefined -> assume 2 GB.
- [ ] **Step 2:** Run -> FAIL; implement; run -> PASS.
- [ ] **Step 3: e2e** `source.spec.ts`: load each fixture via `setInputFiles` into a test-only harness page `e2e/harness.html` (excluded from build) and assert: `land-4k60-aac.mp4` -> 3840x2160, fps ~60; `portrait-rot90.mp4` -> displayWidth < displayHeight; `noaudio.mp4` -> `audio === null`; a renamed text file -> `UnsupportedSourceError`.
- [ ] **Step 4:** Run -> PASS.
- [ ] **Step 5:** Stage/commit: `feat: source reading and output sink`.

### Task 6: Conversion

**Files:** Create `src/core/convert.ts`; Test `tests/unit/convert.test.ts`, `e2e/convert.spec.ts`

**Interfaces:**
- Consumes: `Settings`, `readSource().input`, `openSink()`.
- Produces: `startConversion(args: { input: Input; settings: Settings; target: Target; onProgress(p: number, bytesWritten: number): void }): { done: Promise<void>; cancel(): Promise<void> }`; `toConversionOptions(s: Settings): ConversionOptions` (exported for unit test).

- [ ] **Step 1: Failing unit test** `tests/unit/convert.test.ts` for `toConversionOptions`: maps `trim`, `video.width/height` with `fit: 'contain'`, `frameRate`, `codec`, `quality: new Quality({ bitrate })` (check `bitrate` field), `audio.discard` when `audio === null`, audio `forceTranscode: false` when `copy`, `video.discard` when `video === null`; output format `Mp4OutputFormat({ fastStart: false })` for file-stream and `'in-memory'` for memory, `WebMOutputFormat` for webm.
- [ ] **Step 2:** Run -> FAIL; implement; run -> PASS.
- [ ] **Step 3:** Implement `startConversion`: `Conversion.init`, reject with `ConversionInvalidError` listing `conversion.discardedTracks` reasons when `!conversion.isValid`; subscribe `target.on('write')` for bytes; `cancel` calls `conversion.cancel()`.
- [ ] **Step 4: e2e** via harness: `land-1080p30-aac.mp4` -> output decodes, duration within 0.1 s; trim 0.5..2.0 -> duration ~1.5 s; `noaudio.mp4` converts; `land-4k60-aac.mp4` -> output 1920x1080 @ ~30 fps; cancel mid-run rejects with `ConversionCanceledError`.
- [ ] **Step 5:** Run -> PASS.
- [ ] **Step 6:** Stage/commit: `feat: conversion pipeline`.

### Task 7: Mockups and visual direction (owner gate)

**Files:** Create `docs/mockups/mockup.html`, `docs/mockups/{phone,tablet,desktop}-{drop,prepare,result}.png`, `src/styles/tokens.css`

- [ ] **Step 1:** Load frontend-design skill. Build static HTML mockups of the three states (spec "Screens and flow") using real tokens in `tokens.css`: light and dark, touch targets >= 44 px, system font stack (no web fonts), icons as inline SVG bundled locally.
- [ ] **Step 2:** Render PNGs with Playwright at 390x844, 820x1180, 1440x900, light and dark for the prepare state.
- [ ] **Step 3:** Send PNGs to the owner. Stop until approved; apply feedback; re-render.
- [ ] **Step 4:** Stage/commit: `docs: approved UI mockups`.

### Task 8: App shell and drop zone

**Files:** Create `src/ui/app.ts`, `src/ui/dropZone.ts`, `src/styles/app.css`; Modify `src/main.ts`, `index.html`; Test `e2e/drop.spec.ts`

**Interfaces:**
- Produces: `type AppState = { kind: 'drop' } | { kind: 'prepare'; file: File; source: SourceInfo; auto: AutoResult; settings: Settings } | { kind: 'working'; ... ; progress: number } | { kind: 'result'; ...; output: { blob: Blob | null; sizeBytes: number; url: string | null } }`; `createApp(root: HTMLElement, deps: { probeCapabilities; readSource; startConversion; openSink }): { dispatch(a: AppAction): void }`.

- [ ] **Step 1: Failing e2e:** drop zone visible with text stating files stay on device; `setInputFiles` on the hidden input with `land-1080p30-aac.mp4` moves to prepare state showing name and `1080p`; dropping a non-video shows an error naming the problem and stays in drop; a >2 GB file (synthetic `File` via `page.evaluate`, size check only) shows the memory warning with a Continue button.
- [ ] **Step 2:** Run -> FAIL; implement; run -> PASS (all Playwright projects).
- [ ] **Step 3:** Stage/commit: `feat: app shell and drop zone`.

### Task 9: Trim bar

**Files:** Create `src/ui/trimBar.ts`; Test `tests/unit/trim.test.ts`, `e2e/trim.spec.ts`

**Interfaces:** Produces `clampTrim(t: { start: number; end: number }, duration: number, moved: 'start' | 'end'): { start: number; end: number }`, `MIN_TRIM_SPAN = 0.1`; `mountTrimBar(el, opts: { duration: number; value; video: HTMLVideoElement; thumbnails: (count: number) => Promise<HTMLCanvasElement[]>; onChange(t) })`.

- [ ] **Step 1: Failing unit tests:** end dragged below start -> `end = start + 0.1`; start dragged past end -> `start = end - 0.1`; negatives -> 0; past duration -> duration; duration < 0.1 -> `{0, duration}`.
- [ ] **Step 2:** Run -> FAIL; implement `clampTrim`; run -> PASS.
- [ ] **Step 3:** Implement the bar: Pointer Events (mouse, touch, pen), handles with `role="slider"`, `aria-valuemin/max/now`, arrow keys step 0.1 s, shift+arrow 1 s; "Set start/end at playhead" buttons; thumbnails from Mediabunny `CanvasSink.canvasesAtTimestamps` (8 on phone, 12 otherwise). Preview loops within the trim range.
- [ ] **Step 4: Failing-then-passing e2e:** keyboard moves start by 0.1 s; touch drag on iPhone project updates the readout; estimate updates on trim change.
- [ ] **Step 5:** Stage/commit: `feat: trim bar`.

### Task 10: Summary card and settings panel

**Files:** Create `src/ui/settingsPanel.ts`; Test `e2e/settings.spec.ts`

**Interfaces:** Produces `mountSettings(el, opts: { auto: AutoResult; caps: Capabilities; source: SourceInfo; value: Settings; onChange(s: Settings) })`.

- [ ] **Step 1: Failing e2e:** summary shows `1080p · H.264/AAC MP4 · est. X-Y MB from Z MB`; "Adjust" disclosure reveals size steps (from `sizeSteps`), fps, container, video codec, quality slider (bitrate 25%-150% of auto), audio codec/bitrate (64/96/128/160 kbps, capped at source), "Remove audio"; each control has "Reset to auto"; codec options not in `caps` are disabled with a visible reason; picking WebM switches audio to Opus; choosing a non-H.264 codec shows the compatibility warning; `alreadyOptimal` shows the "already small" message with trim-only export.
- [ ] **Step 2:** Run -> FAIL; implement; run -> PASS.
- [ ] **Step 3:** Stage/commit: `feat: settings panel`.

### Task 11: Progress, result and comparison

**Files:** Create `src/ui/progress.ts`, `src/ui/compare.ts`; Test `tests/unit/sync.test.ts`, `e2e/result.spec.ts`

**Interfaces:** Produces `mountProgress(el, { onCancel })` with `update(p, bytes, elapsedMs)`; `mountCompare(el, { original: string; output: string; originalInfo: SourceInfo; outputInfo: SourceInfo })`; pure `needsResync(masterT: number, slaveT: number): boolean` with `DRIFT_SEC = 0.1`.

- [ ] **Step 1: Failing unit test:** `needsResync(1.0, 1.05) === false`, `needsResync(1.0, 1.2) === true`.
- [ ] **Step 2:** Implement; PASS.
- [ ] **Step 3:** Implement progress (percent, elapsed, remaining estimate, live bytes, Cancel returning to prepare with settings kept) and result: stats table original vs new (size, resolution, fps, codec, bitrate, duration, reduction %). Compare: two stacked `<video>` in one viewport, top clipped with `clip-path: inset(0 0 0 X%)`, draggable divider (pointer + keyboard slider), one play control drives both with `requestVideoFrameCallback`/`timeupdate` resync via `needsResync`; "Frame" mode pauses both and steps 1 frame with buttons. Output info comes from `readSource(outputBlob)` for memory sinks; for file-stream sinks use the settings and bytes written, and compare playback is skipped with a note (no Blob to play).
- [ ] **Step 4:** Actions: Download (memory sink; `<a download>` with object URL), Share (`navigator.share({ files })` when `shareFiles`), "Make it smaller" (next `sizeSteps` entry, back to prepare), "Start over" (revoke object URLs). If output >= input size, show the message and highlight "Make it smaller".
- [ ] **Step 5: Failing-then-passing e2e:** full flow on `land-1080p30-aac.mp4` reaches result with reduction shown and two videos; wipe slider keyboard moves divider; `small-h264-lowbitrate.mp4` forced re-encode at a higher bitrate shows the "not smaller" message; Cancel returns to prepare.
- [ ] **Step 6:** Stage/commit: `feat: progress, result and comparison`.

### Task 12: Offline, manifest, docs, release checks

**Files:** Create `public/sw.js`, `public/site.webmanifest`, icons; Modify `src/main.ts`, `README.md`, `THIRD-PARTY-LICENSES.txt`; Test `e2e/offline.spec.ts`, `e2e/devices.spec.ts`

- [ ] **Step 1:** Service worker following `../rastertrace/sw.js`: precache the Vite build manifest list (generate the list at build with a small Vite plugin in `vite.config.ts` that writes `precache.json`), cache-first same-origin, versioned cache name from package version, delete old caches on activate.
- [ ] **Step 2: e2e offline:** load once, `context.setOffline(true)`, reload, app renders and converts a fixture.
- [ ] **Step 3: e2e devices:** iPhone 15 and iPad projects run the full flow with `portrait-rot90.mp4`; screenshot of compare shows portrait orientation (assert video element `videoWidth < videoHeight`); axe has zero violations in each state.
- [ ] **Step 4:** README: what it does, privacy statement, browser support (from probing, not claims), size guidance (2 GB), dev commands, deploy (GitHub Pages workflow, Cloudflare Pages build command `pnpm build`, output `dist`), licences table. Generate `THIRD-PARTY-LICENSES.txt` from installed production deps.
- [ ] **Step 5:** Full verification: `pnpm build && pnpm test && pnpm test:e2e`; `find dist -size +25M` empty; `grep -rE "https?://" dist --include=*.js --include=*.html` shows no third-party origins in fetch/script/link use.
- [ ] **Step 6:** Manual check on a real iPhone and iPad (owner): drop a recent phone video, trim, export, share. Record results in README.
- [ ] **Step 7:** Stage/commit: `feat: offline support and release docs`.

### Task 13: CI tests workflow, lint/format, README badges

Owner request: CI badges, testing and integration similar to github.com/bradsec/rastertrace (`../rastertrace/.github/workflows/tests.yml`, README badge row).

**Files:** Create `.github/workflows/tests.yml`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`; Modify `package.json`, `.github/workflows/pages.yml`, `README.md`, source files only as needed to pass lint/format.

**Interfaces:** Produces scripts `pnpm typecheck` (`tsc --noEmit`), `pnpm lint` (eslint), `pnpm format:check` (prettier --check), `pnpm check:size` (fails if any `dist` file > 25 MiB).

- [ ] **Step 1:** Add ESLint (flat config, `typescript-eslint`) and Prettier as dev deps, current stable versions; config modelled on `../rastertrace` and `../../pdfprojects/pdfmerge/eslint.config.js`. Run `pnpm format` once and fix lint errors without changing behaviour.
- [ ] **Step 2:** `tests.yml` named `Tests`, on `push`, `pull_request`, `workflow_dispatch`; pnpm cache; steps: `pnpm install --frozen-lockfile`, `pnpm check:licenses`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm exec playwright install --with-deps chromium webkit`, `pnpm test:e2e`, `pnpm build`, `pnpm check:size`. Upload the Playwright report as an artifact on failure.
- [ ] **Step 3:** `pages.yml` deploys only from `main` and only after tests pass (`workflow_run` on `Tests` success, or a `needs:` on a reused test job; pick one, no duplicate suites).
- [ ] **Step 4:** README top badge row in rastertrace's format: `Tests` workflow badge (`https://github.com/bradsec/videoadjust/actions/workflows/tests.yml/badge.svg?branch=main`), package.json version, licence, live site (`https://videoadjust.com/`).
- [ ] **Step 5:** Verify locally: `pnpm check:licenses && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e && pnpm build && pnpm check:size` all pass; `actionlint` on both workflows if installed, else `node -e` YAML parse.
- [ ] **Step 6:** Commit: `ci: tests workflow, lint, format and badges`.
