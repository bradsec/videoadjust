# Extract audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Extract audio tool (MP3 default, M4A, WAV) behind a "Shrink video | Extract audio" tab switch after a video is loaded.

**Architecture:** A new DOM-free core module holds audio-extract settings and rules, parallel to the Shrink rules, so Shrink's `Settings` and `validateSettings` stay untouched. `startConversion` stops depending on `Settings` and takes ready-made conversion options, so both tools share one conversion, sink and progress path. The controller adds a `tool` field and per-tool settings to the loaded state; the UI adds a tab control, an audio settings panel and an audio result with a player.

**Tech Stack:** TypeScript 6, Vite, Mediabunny 1.62.0, `@mediabunny/mp3-encoder` 1.62.0, Vitest, Playwright + axe. pnpm.

**Spec:** `docs/superpowers/specs/2026-10-22-videomate-extract-audio-design.md` (builds on `docs/superpowers/specs/2026-10-22-videoresize-design.md`). Mockups: `docs/mockups/*-prepare-audio*.png`, `*-result-audio.png`, `phone-prepare-no-audio.png`, source `docs/mockups/mockup.html`.

## Global Constraints

- Everything local: no CDN, fonts or runtime fetches from other origins. CSP stays `connect-src 'self'`. `pnpm build` must pass `check:remote`.
- `@mediabunny/mp3-encoder` pinned exactly at `1.62.0` (matches `mediabunny` 1.62.0). It embeds LAME (LGPL). Allowed only through the per-package LGPL exception in `scripts/check-licenses.mjs`, loaded as a lazy same-origin chunk, precached, with a source link in `THIRD-PARTY-LICENSES.txt`.
- Audio formats: `mp3` (default), `m4a` (AAC), `wav` (16-bit PCM). Extensions `.mp3`, `.m4a`, `.wav`; MIME `audio/mpeg`, `audio/mp4`, `audio/wav`. Output name `<base>-audio.<ext>`.
- Auto bitrate: 128 kbps stereo, 96 kbps mono, never above source audio bitrate, floored at 64 kbps. Bitrate steps 64, 96, 128, 160, 192, 320 kbps.
- M4A copies source packets when source is AAC and source bitrate is at or below target.
- Trim is shared by both tools. Switching tabs keeps each tool's settings. "Start over" resets both.
- Tab control: `role="tablist"`, arrow keys move selection, 44 px targets, selected state not by colour alone. Extract audio tab disabled with reason "This video has no audio track" or "This video's audio cannot be decoded in this browser".
- No emojis, no em dashes in code, comments or copy. Match existing code style; comment only invariants and non-obvious reasons.
- Unit tests: `pnpm test`. E2E: `pnpm test:e2e` (chromium, webkit, iphone, ipad). Lint `pnpm lint`, format `pnpm format:check`, types `pnpm typecheck`, build `pnpm build`, size `pnpm check:size`.

## Review Focus

1. Trim with a non-zero start while M4A copies packets: output duration must match the trim (within 0.1 s) and play.
2. File-stream sink (`showSaveFilePicker`) with WAV and MP3, whose writers revisit the header at the end: the saved file must be valid.
3. A mono source: Stereo is not offered; auto is 96 kbps mono.
4. Switching tabs during export is impossible (tabs absent or disabled in `working`); "Lower bitrate" and "Start over" from an audio result keep or reset the tool as specified.
5. MP3 encoder chunk fails to load (offline before first MP3 export would be the real case; precache prevents it): the export shows an error naming MP3 and suggesting M4A or WAV, and a later attempt can retry.

---

### Task 1: Audio extract core rules

**Files:**
- Create: `src/core/audioExtract.ts`
- Test: `tests/unit/audioExtract.test.ts`

**Interfaces:**
- Consumes: `SourceInfo`, `Capabilities` from `src/core/types.ts`. `src/core` never imports `src/ui`, so this module neither clamps trim nor uses `formatBitrate`.
- Produces:
  ```ts
  export type AudioFormat = 'mp3' | 'm4a' | 'wav';
  export interface AudioExtractSettings {
    format: AudioFormat;
    trim: { start: number; end: number };
    bitrate: number;      // bits/s; ignored for wav
    channels: 1 | 2;
    copy: boolean;        // m4a only: packet copy of AAC source
  }
  export const AUDIO_FORMATS: Record<AudioFormat, { ext: string; mime: string; label: string }>;
  // mp3: '.mp3','audio/mpeg','MP3'; m4a: '.m4a','audio/mp4','M4A (AAC)'; wav: '.wav','audio/wav','WAV'
  export const AUDIO_BITRATE_STEPS: number[]; // [64_000, 96_000, 128_000, 160_000, 192_000, 320_000]
  export type AudioUnavailable = 'no-audio' | 'undecodable';
  export function audioUnavailable(src: SourceInfo): AudioUnavailable | null;
  export function autoAudioExtract(src: SourceInfo, caps: Capabilities): AudioExtractSettings | null;
  export function validateAudioExtract(value: AudioExtractSettings, auto: AudioExtractSettings, src: SourceInfo, caps: Capabilities): AudioExtractSettings;
  export function audioExtractChangeCount(value: AudioExtractSettings, auto: AudioExtractSettings, src: SourceInfo, caps: Capabilities): number;
  export function lowerAudioBitrate(s: AudioExtractSettings, auto: AudioExtractSettings): { settings: AudioExtractSettings; note: string } | null;
  export function estimateAudioBytes(s: AudioExtractSettings, src: SourceInfo): { low: number; high: number; mid: number };
  export function audioOutputName(name: string, format: AudioFormat): string;
  ```

Rules the tests pin:
- `audioUnavailable`: `'no-audio'` when `src.audio` is null, `'undecodable'` when `!src.audio.decodable`, else null. `autoAudioExtract` returns null in both cases.
- Auto: format `mp3`, trim `{0, durationSec}`, channels `min(src channels, 2)`, bitrate 128k stereo / 96k mono capped at source bitrate, then floored at 64k. `copy: false`.
- Validate: unknown format falls back to auto's; `m4a` requires `caps.audio.aac`, else falls back to `mp3`. Bitrate must be one of the steps, else auto's. Channels clamp to source (mono source forces 1). `copy` is true only when format `m4a`, source codec `aac`, source bitrate not null and at or below the target for the chosen channels, and channels equal the source's. With copy, bitrate is the source bitrate. Trim passes through unchanged; the controller clamps it with `clampTrim` (Task 4), as it does for Shrink.
- Change count counts format, bitrate (not for wav), channels.
- `lowerAudioBitrate`: wav switches to mp3 at auto's bitrate (note "Switched to MP3 at 128 kbps. Export again to try it."); otherwise next lower step with `copy: false` (note "The audio bitrate is now 96 kbps. Export again to try it."); null at 64k. Format kbps as `${bitrate / 1000} kbps`.
- Estimate: mp3/m4a `bitrate * seconds / 8 * 1.01`; m4a copy uses source bitrate; wav `sampleRate * channels * 2 * seconds + 44`. Low/high factors 0.85 / 1.15 for lossy, 1.0 / 1.0 for wav. Seconds = trimmed span.
- `audioOutputName('IMG_4907.MP4', 'mp3') === 'IMG_4907-audio.mp3'`; a name without a dot gets the suffix appended.

- [ ] **Step 1:** Write `tests/unit/audioExtract.test.ts` covering every rule above: stereo AAC 160k source gives mp3 128k; mono 96k source gives 96k mono; 48k source floors to 64k; no audio and undecodable give null; m4a copy on/off cases (AAC 128k on, AAC 192k off, Opus off, mono override on stereo source off); m4a without AAC capability validates to mp3; invalid bitrate resets; change count; lower steps from 128k to 96k, from 64k to null, wav to mp3; estimates for 60 s at 128k (mid 969 600 bytes), wav 48 kHz stereo 10 s (1 920 044 bytes, low equals high); output naming.
- [ ] **Step 2:** Run `pnpm exec vitest run tests/unit/audioExtract.test.ts`; expect failure (module missing).
- [ ] **Step 3:** Implement `src/core/audioExtract.ts`.
- [ ] **Step 4:** Run the test file, then `pnpm test`, `pnpm typecheck`, `pnpm lint`; all pass.
- [ ] **Step 5:** Commit `feat: audio extract settings rules`.

### Task 2: MP3 encoder fallback and licence

**Files:**
- Modify: `package.json` (+ `pnpm-lock.yaml`), `src/core/capabilities.ts`, `src/core/types.ts`, `scripts/check-licenses.mjs`, `THIRD-PARTY-LICENSES.txt`, `README.md` (licence table)
- Test: `tests/unit/capabilities.test.ts`, `tests/unit/check-licenses.test.ts`, `e2e/offline.spec.ts` (precache list)

**Interfaces:**
- Produces: `export function registerMp3Fallback(): Promise<boolean>` in `src/core/capabilities.ts`, same reuse and retry pattern as `registerAacFallback`. `export async function ensureMp3Encoder(deps?: { canEncodeAudio: typeof canEncodeAudio; register: () => Promise<boolean> }): Promise<void>`: resolves when native `canEncodeAudio('mp3')` is true or the fallback registered; rejects otherwise. Not called by `probeCapabilities` (the chunk loads on first MP3 export only).
- `Capabilities` gains nothing: MP3 is always offered because the fallback is bundled.

- [ ] **Step 1:** `pnpm add -E @mediabunny/mp3-encoder@1.62.0`. Inspect the installed package's files for its LAME licence text and version; record the exact SPDX id.
- [ ] **Step 2:** Tests: `ensureMp3Encoder` skips registration when native MP3 is available; registers once across two calls; a failed registration rejects and a second call retries. Licence test: `@mediabunny/mp3-encoder` is accepted with LAME's LGPL id, and another package with that id is still rejected.
- [ ] **Step 3:** Run them; expect failures.
- [ ] **Step 4:** Implement. Add the package to `LGPL_WASM_EXCEPTIONS` and its LGPL id to `LGPL_IDS` if it differs (for example `LGPL-2.0-or-later`); update the exception comment. Add a `THIRD-PARTY-LICENSES.txt` section in the same shape as the AAC encoder's (source, npm link, embedded LAME version, licence text or link). Add a README licence row.
- [ ] **Step 5:** Extend the offline e2e precache test to assert a chunk from `@mediabunny/mp3-encoder` is in the precache list. Verify the built chunk is a separate file under 25 MiB (`pnpm build && pnpm check:size`).
- [ ] **Step 6:** `pnpm test`, `pnpm check:licenses`, `pnpm build`, `pnpm exec playwright test e2e/offline.spec.ts --project=chromium`; all pass.
- [ ] **Step 7:** Commit `feat: lazy MP3 encoder fallback`.

### Task 3: Shared conversion path for audio output

**Files:**
- Modify: `src/core/convert.ts`, `src/core/sink.ts`, `e2e/harness.ts`, `src/ui/controller.ts` (call site only)
- Test: `tests/unit/convert.test.ts`, `tests/unit/sink.test.ts`, `e2e/convert.spec.ts`

**Interfaces:**
- Consumes: `AudioExtractSettings`, `AudioFormat` (Task 1).
- Produces (`src/core/convert.ts`):
  ```ts
  export type ConversionJob = { options: Pick<ConversionOptions, 'video' | 'audio' | 'trim'>; keeps: { video: boolean; audio: boolean } };
  export function shrinkJob(s: Settings): ConversionJob;          // options = toConversionOptions(s); keeps = { video: !!s.video, audio: !!s.audio }
  export function audioExtractJob(s: AudioExtractSettings): ConversionJob;
  export function createAudioOutputFormat(format: AudioFormat, sinkKind: SinkPlan['kind']): OutputFormat;
  export function startConversion(args: { input: Input; job: ConversionJob; format: OutputFormat; target: Target; onProgress(p: number, bytesWritten: number): void }): { done: Promise<void>; cancel(): Promise<void> };
  export function discardedPrimaryTracks(keeps: ConversionJob['keeps'], primaryVideo: unknown, primaryAudio: unknown, discarded: readonly { track: unknown; reason: DiscardedTrack['reason'] }[]): { track: TrackType; reason: DiscardedTrack['reason'] }[];
  ```
  `audioExtractJob`: video `{ discard: true }`; mp3 `{ codec: 'mp3', quality: bitrate, numberOfChannels }`; m4a copy `{ codec: 'aac', forceTranscode: false }`, else `{ codec: 'aac', quality, numberOfChannels }`; wav `{ codec: 'pcm-s16', numberOfChannels }`; keeps `{ video: false, audio: true }`. Check Mediabunny 1.62 types for the exact PCM codec id and `Mp3OutputFormat` / `WavOutputFormat` options.
  `createAudioOutputFormat`: mp3 `Mp3OutputFormat`, wav `WavOutputFormat`, m4a `Mp4OutputFormat` with the same `fastStart` rule as `createOutputFormat`.
- `src/core/sink.ts` `EXTENSIONS` adds the three audio MIME types.
- Signature rule: `toConversionOptions` and `createOutputFormat` keep their signatures; only `startConversion` and `discardedPrimaryTracks` change. Update the two harness call sites and the controller call site to pass `job: shrinkJob(settings)`.

- [ ] **Step 1:** Unit tests: `audioExtractJob` for each format and copy; `shrinkJob` equals today's options; `discardedPrimaryTracks` with keeps; `createAudioOutputFormat` returns the right class and `fileExtension`; sink accepts audio MIME extension.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement and update call sites.
- [ ] **Step 4:** Harness: add `extractAudio(fixture, settings, sinkKind)` that runs `ensureMp3Encoder` for mp3, converts, reads the result back with `readSource` and returns its info and size. E2E in `e2e/convert.spec.ts`: from `land-1080p30-aac.mp4` extract mp3, m4a and wav with memory sink, assert no video track, audio codec `mp3` / `aac` / `pcm-s16`, duration within 0.1 s of source; m4a with trim 0.5 to 2.0 s and copy on has duration 1.5 s within 0.1 s (Review Focus 1); wav and mp3 through the file-stream path in the harness produce readable files (Review Focus 2; reuse the harness's existing file-stream approach).
- [ ] **Step 5:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec playwright test e2e/convert.spec.ts`; all pass, including existing convert tests.
- [ ] **Step 6:** Commit `feat: shared conversion job for audio extract`.

### Task 4: Controller tool state and audio export

**Files:**
- Modify: `src/ui/controller.ts`, `src/main.ts`
- Test: `tests/unit/controller.test.ts`

**Interfaces:**
- Consumes: Task 1 module, Task 2 `ensureMp3Encoder`, Task 3 `audioExtractJob`, `createAudioOutputFormat`.
- Produces:
  - `export type Tool = 'shrink' | 'audio';`
  - `Loaded` gains `tool: Tool; audioAuto: AudioExtractSettings | null; audioSettings: AudioExtractSettings | null;`. `audioAuto` null means the tab is disabled; `audioUnavailable(source)` gives the reason.
  - `AppAction` gains `{ type: 'setTool'; tool: Tool }` and `{ type: 'setAudioSettings'; value: AudioExtractSettings }`.
  - `AppDeps` gains `ensureMp3Encoder: () => Promise<void>`.
  - `export function audioOutputMime(format: AudioFormat): string` is not needed: use `AUDIO_FORMATS[format].mime`.

Behaviour:
- `loaded` sets `tool: 'shrink'`, `audioAuto = autoAudioExtract(source, caps)`, `audioSettings = audioAuto`.
- `setTool` works only in `prepare` and `result` (result returns to prepare with that tool); `'audio'` is ignored when `audioAuto` is null.
- `setTrim` updates both `settings.trim` and `audioSettings.trim`.
- `setAudioSettings` stores `validateAudioExtract(...)` with trim clamped by `clampTrim(value.trim, source.durationSec, 'end')`.
- `export` with `tool: 'audio'`: if format mp3, await `deps.ensureMp3Encoder()` before opening the sink; on failure go to prepare with notice `{ tone: 'error', title: 'MP3 encoding is unavailable', message: 'The MP3 encoder could not be loaded. Choose M4A or WAV, or try again.' }`. Then the same sink, progress, cancel and result flow as Shrink, with `outputName = audioOutputName(...)`, mime from `AUDIO_FORMATS`, `estimateAudioBytes` for the estimate and the memory warning, format from `createAudioOutputFormat`, job from `audioExtractJob`. A conversion failure notice says `The ${label} export failed` and suggests another format.
- File-stream result info for audio: `{ name, sizeBytes, durationSec: trimmed span, containerMime: mime, video: null, audio: { codec: format === 'mp3' ? 'mp3' : format === 'wav' ? 'pcm-s16' : 'aac', decodable: true, channels, sampleRate: source sampleRate, bitrate } }` (copy uses source audio).
- `smaller` with tool audio uses `lowerAudioBitrate`; null leaves state unchanged with the existing "nothing smaller" behaviour.
- `reset` clears both tools (back to drop, as today).

- [ ] **Step 1:** Controller unit tests with the existing fake deps: tab disabled for `noaudio` source (setTool audio ignored); setTool round trip keeps Shrink overrides and audio overrides (Anti-goal); shared trim; mp3 export calls `ensureMp3Encoder` once before `openSink` and uses name `x-audio.mp3`, mime `audio/mpeg`; m4a export does not call it; ensure failure gives the MP3 notice and no sink opened (Review Focus 5); working state rejects `setTool` (Review Focus 4); result + `smaller` lowers bitrate and keeps tool audio; result + `setTool('shrink')` returns to prepare on Shrink; file-stream audio result info shape.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement; wire `ensureMp3Encoder` in `src/main.ts`.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm lint`; all pass; existing controller tests unchanged.
- [ ] **Step 5:** Commit `feat: controller tool switch and audio export`.

### Task 5: Tool tabs and audio settings panel

**Files:**
- Create: `src/ui/toolTabs.ts`, `src/ui/audioPanel.ts`
- Modify: `src/ui/app.ts` (`renderPrepare`), `src/styles/app.css`
- Test: `e2e/settings.spec.ts` (or new `e2e/audio.spec.ts`)

**Interfaces:**
- `mountToolTabs(host: HTMLElement, opts: { value: Tool; disabledReason: string | null; onChange(tool: Tool): void }): { update(value: Tool, disabledReason: string | null): void }`. Tabs "Shrink video" and "Extract audio" with icons as in the mockup (add a waveform symbol to `index.html`'s sprite, reuse `#i-smaller` for Shrink). WAI-ARIA tabs pattern: `role="tablist"`, `role="tab"`, `aria-selected`, roving tabindex, Left/Right/Home/End. The disabled tab has `aria-disabled="true"` and its reason is visible text linked by `aria-describedby`.
- `mountAudioPanel(host: HTMLElement, opts: { auto: AudioExtractSettings; source: SourceInfo; caps: Capabilities; value: AudioExtractSettings; onChange(s: AudioExtractSettings): void; onExport(): void }): { update(s: AudioExtractSettings): void }`. Follows `mountSettings`'s card structure and classes so it inherits the look: eyebrow "Ready to extract", heading e.g. "MP3 · 128 kbps stereo", sub "Audio 3:12 of 3:12", estimate via `formatByteRange`, "from 212 MB video", the size bars, primary button "Extract audio", and the Adjust disclosure with Format (radio list with hints: M4A "Copies the original audio without re-encoding" only when copy would apply; WAV "Uncompressed, about N MB"), Bitrate (segmented steps, hidden for WAV), Channels (Stereo disabled for a mono source), each with auto value and reset like Shrink's rows. Patch controls in place on update (do not rebuild), as `mountSettings` does, so focus is kept.
- `renderPrepare`: tabs at the top of the settings card area; shows `mountSettings` or `mountAudioPanel` by `state.tool`. Trim bar and preview unchanged.

- [ ] **Step 1:** E2E: load `land-1080p30-aac.mp4`, tabs visible with Shrink selected; ArrowRight selects Extract audio and shows "Ready to extract" and "MP3"; choose M4A shows the copy hint; choose WAV hides Bitrate; switch back to Shrink keeps a Shrink override made earlier; load `mono-aac.mp4`, Stereo disabled; load `noaudio.mp4`, Extract audio has `aria-disabled="true"` and the text "This video has no audio track"; axe clean on both tabs.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement against the mockups (`docs/mockups/phone-prepare-audio.png`, `desktop-prepare-audio.png`, `phone-prepare-no-audio.png`; markup and CSS reference in `docs/mockups/mockup.html`).
- [ ] **Step 4:** `pnpm exec playwright test` (all projects) plus `pnpm lint`, `pnpm format:check`, `pnpm typecheck`; all pass. Screenshot phone and desktop prepare-audio and compare with the mockups.
- [ ] **Step 5:** Commit `feat: tool tabs and audio settings panel`.

### Task 6: Audio result screen

**Files:**
- Create: `src/ui/audioPlayer.ts`, `src/ui/waveform.ts`
- Modify: `src/ui/app.ts` (`renderResult`, `statsTable`, `renderWorking` labels), `src/styles/app.css`
- Test: `tests/unit/waveform.test.ts`, `e2e/result.spec.ts`

**Interfaces:**
- `export function peaksFromSamples(channels: Float32Array[], bins: number): Float32Array` (pure; max absolute value per bin across channels, 0..1). `export async function computePeaks(input: Input, trim: { start: number; end: number }, bins: number, signal: AbortSignal): Promise<Float32Array | null>` decodes the source's primary audio track over the trim with Mediabunny `AudioSampleSink`, returns null on failure or abort.
- `mountAudioPlayer(host: HTMLElement, opts: { url: string | null; name: string; detail: string; peaks: Promise<Float32Array | null> }): { destroy(): void }`: play/pause button (accessible name toggles), a `role="slider"` scrub over the waveform (keyboard arrows seek 5 s), current and total time. When `url` is null (file stream) the player shows the name and detail with the note "Saved where you chose. Open it from there to play." and no play button. Plain bar when peaks are null.
- `renderResult` with `tool: 'audio'`: headline as Shrink's, the player instead of `mountCompare`, size bars labelled "Original video" / "Audio file", stats table with columns "Original video" / "Audio file" (rows Size, Duration, Codec, Bitrate; WAV shows "PCM 16-bit" and "Lossless"), actions Download, Share (when supported), "Lower bitrate" (dispatches `smaller`), "Start over". `renderWorking` says "Extracting audio" for the audio tool.

- [ ] **Step 1:** Unit tests for `peaksFromSamples` (bins count, max across channels, silent input zeros, fewer samples than bins).
- [ ] **Step 2:** E2E: extract MP3 from `land-1080p30-aac.mp4`; result shows "Audio file", codec MP3, a playable `audio` element (its `duration` within 0.1 s of the trimmed span), play button toggles to pause, Download link name ends `-audio.mp3`; "Lower bitrate" returns to prepare with 96 kbps; WAV result shows "PCM 16-bit"; no cross-origin requests; axe clean on result; iphone and ipad projects run the MP3 flow.
- [ ] **Step 3:** Run; expect failures.
- [ ] **Step 4:** Implement against `docs/mockups/phone-result-audio.png` and `desktop-result-audio.png`.
- [ ] **Step 5:** All checks and full e2e pass.
- [ ] **Step 6:** Commit `feat: audio result with player`.

### Task 7: Offline, docs and release

**Files:**
- Modify: `e2e/offline.spec.ts`, `README.md`, `package.json` (version), `docs/superpowers/specs/2026-10-22-videomate-extract-audio-design.md` (mark built)

- [ ] **Step 1:** Offline e2e: after first visit and service worker control, go offline, load a fixture, extract MP3 (the MP3 chunk comes from the precache), result shows an MP3.
- [ ] **Step 2:** README: describe both tools, the audio formats and when M4A copies, MP3 encoder licence note, manual device check rows for Extract audio on iPhone and iPad. Remove the "planned" sentence.
- [ ] **Step 3:** Bump version to `0.3.0`.
- [ ] **Step 4:** Full verification: `pnpm check:licenses && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm check:size && pnpm test:e2e`.
- [ ] **Step 5:** Commit `docs: extract audio in README, v0.3.0`.
