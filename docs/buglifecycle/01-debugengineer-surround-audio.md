# Bug A: surround audio (E-AC-3 5.1) cannot be decoded or exported

Step 2 of the bug lifecycle, debug engineer. Branch `fix/surround-audio-4k`, based on `main` at 08cfba8.
Investigated 2026-10-31. Outcome: root cause is a browser platform limit (no AC-3/E-AC-3 in
Chromium WebCodecs on Linux), plus a gating defect in this codebase that turns that limit into a
failed export. Both real fixes need product decisions, so no code change was made (direction gate).

## 1. Symptom and minimal reproduction

Reported (verbatim): "it can't seem to play 4k videos or work out how to decode surround audio".

- Mode tab notice: "This browser cannot decode the audio in this video"
- Export banner: "This video cannot be converted with these settings (audio track: undecodable_source_codec). A partial file may remain at the location you chose. You can delete it."
- Export settings: 1080p, H.264/AAC MP4, 30 fps, AAC 128 kbps stereo; Audio "Unchanged".
- Expected: the export works, with the 5.1 audio downmixed to stereo AAC (or a clear choice before Export).
- Actual: the export fails after the user has picked a save location.

Environment: Debian 13, kernel 6.12.113, Node 22.19.0, pnpm 10.32.1, mediabunny 1.62.0,
Playwright Chromium 156.0.8078.4, Google Chrome 156.0.8078.79, Brave 156.1.98.62, ffmpeg 7.1.5.
Source file: AV1 Main 10-bit HDR (PQ, BT.2020) 3840x2160 plus E-AC-3 5.1(side) 48 kHz, in MKV.
Nothing in this codebase changed around the report. The trigger is the input file: it is the
first E-AC-3 source reported.

Minimal reproduction: a 3 s 320x240 H.264 clip carrying an E-AC-3 track. The video codec, resolution,
HDR, container and channel count all have no effect on the outcome (see table below).

```
# clips (bash): testsrc2 video + audio from the user's file
ffmpeg -ss 20 -t 3 -i "<source>.mkv" -map 0:a -c:a copy src-eac3-51.mka
ffmpeg -f lavfi -i testsrc2=s=320x240:r=30:d=3 -i src-eac3-51.mka -map 0:v -map 1:a \
  -c:v libx264 -pix_fmt yuv420p -c:a eac3 -ac 6 -shortest eac3-51.mp4
```

Then, in a temporary Playwright spec (run with `pnpm exec playwright test <spec> --project=chromium`,
removed afterwards), load the clip into `e2e/harness.html` and call
`window.vrHarness.convertToMemory(settings)` with the reported settings (MP4, H.264, AAC 128 kbps stereo,
`passthrough: false`). Observed output:

```
eac3-51.mp4 read= {"codec":"eac3","decodable":false,"channels":6,"sampleRate":48000,"bitrate":448000} convert= ConversionInvalidError: This video cannot be converted with these settings (audio track: undecodable_source_codec).
eac3-20.mkv read= {"codec":"eac3","decodable":false,"channels":2,...} convert= ConversionInvalidError: This video cannot be converted with these settings (audio track: undecodable_source_codec).
orig-eac3-51-copy.mkv read= {"codec":"eac3","decodable":false,"channels":6,...} convert= ConversionInvalidError: This video cannot be converted with these settings (audio track: undecodable_source_codec).
aac-51.mp4 ... convert= OK {"codec":"aac","decodable":true,"channels":2,...}
aac-51.mkv ... convert= OK {"codec":"aac","decodable":true,"channels":2,...}
opus-51.mkv ... convert= OK {"codec":"aac","decodable":true,"channels":2,...}
autoSettings(undecodable eac3).audio = {"codec":"aac","bitrate":128000,"channels":2,"copy":false}
```

`orig-eac3-51-copy.mkv` carries the user's E-AC-3 bitstream unchanged (`-c:a copy`). The error text
matches the report.

### Browser codec probe

A scratch page ran `AudioDecoder.isConfigSupported` (48 kHz) and mediabunny's `canDecode()` on each clip:

| Browser                          | ec-3 6ch | ec-3 2ch | ac-3 6ch | ac-3 2ch | mp4a.40.2 6ch | opus 6ch |
| -------------------------------- | -------- | -------- | -------- | -------- | ------------- | -------- |
| Playwright Chromium 156.0.8078.4 | false    | false    | false    | false    | true          | true     |
| Google Chrome 156                | false    | false    | false    | false    | true          | true     |
| Brave 156                        | false    | false    | false    | false    | true          | true     |

`canDecode()` returned false for every AC-3 and E-AC-3 clip (MP4 and MKV, 2ch and 6ch) and true for
every AAC and Opus clip (2ch and 6ch). `MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"')` was
false and `canPlayType` returned "" in all three browsers, so the `<video>` element cannot play this
audio either.

Baseline unit suite before investigation (`pnpm test`): `Test Files 42 passed (42)`, `Tests 497 passed (497)`.
The e2e suite was not run in full. Only the temporary repro spec was run.

## 2. Hypotheses

| ID  | Hypothesis                                                                                   | Evidence for                                                                                                                                             | Evidence against                                                                                                                    | Test / result                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | The browser's WebCodecs `AudioDecoder` has no AC-3/E-AC-3 decoder                            | mediabunny `canDecode()` defers to `AudioDecoder.isConfigSupported` (node_modules/mediabunny/dist/modules/src/input-track.js:791-811)                    | none                                                                                                                                | CONFIRMED: `isConfigSupported` false for ec-3/ac-3 at 2ch and 6ch in all three browsers; Chromium source gates it off on desktop Linux (section 3) |
| H2  | 5.1 channel count or downmix handling is broken                                              | the file is 5.1                                                                                                                                          | AAC 5.1 and Opus 5.1 decode and export to stereo AAC; E-AC-3 stereo fails the same way                                              | RULED OUT                                                                                                                                          |
| H3  | The MKV container or demuxer is at fault                                                     | the source is MKV                                                                                                                                        | E-AC-3 in MP4 fails the same way; AAC and Opus in MKV succeed; mediabunny reads the codec and channel count correctly               | RULED OUT                                                                                                                                          |
| H4  | The app requests an audio transcode for a source whose audio it already knows is undecodable | `autoSettings` and `validateSettings` gate on `!!source.audio`, not `.decodable`; repro shows `autoSettings(...).audio` is AAC for an undecodable source | none                                                                                                                                | CONFIRMED as the in-app link that turns H1 into a failed export (section 3)                                                                        |
| H5  | Bug B (4K AV1 10-bit HDR video) causes the audio error                                       | same file                                                                                                                                                | the error names only the audio track; the 320x240 H.264 repro shows the same error                                                  | RULED OUT for the audio error                                                                                                                      |
| H6  | A newer mediabunny fixes E-AC-3 decode                                                       | the repo pins 1.62.0, latest is 1.65.0                                                                                                                   | mediabunny's own AC-3 extension README states browsers have no AC-3/E-AC-3 in WebCodecs; core `canDecode` has no built-in AC-3 path | RULED OUT for core; an upgrade alone does not help (release notes for 1.63-1.65 not read in full: coordinator report only)                         |

## 3. Root cause chain

1. Trigger: the source audio is E-AC-3 (Dolby Digital Plus). Channel count does not matter.
2. Platform fault: Chromium builds AC-3/E-AC-3 support only when `enable_platform_ac3_eac3_audio` is set. Its default is `proprietary_codecs && (is_cast_media_device || (is_ios && target_platform == "tvos"))`, so desktop Linux Chrome, Chromium and Brave have no decoder. `IsDecoderDolbyAc3Eac3Supported` returns false without that flag.
3. Detection works: `src/core/source.ts:88` records `audio.decodable = false`. The UI uses it correctly. `src/ui/viewSummaries.ts:100-101` shows "This browser cannot decode the audio in this video", and `src/ui/audioTracksControls.ts:141-145` shows Original audio as unchecked and disabled.
4. In-app defect: the Shrink settings ignore `decodable`. `src/core/autoSettings.ts:71` (`if (src.audio)`) and `src/ui/controllerSettings.ts:300-302` (`!!source.audio`) still produce `audio = { codec: 'aac', bitrate: 128000, channels: 2 }`. The Extract audio path and the mix controls already gate on `decodable` (`src/core/audioExtract.ts:31-34`, `src/ui/controller.ts:425`, `src/ui/prepareView.ts:123`).
5. Propagation: `shrinkJob` sets `keepsAudio = !!a && mixHasAudio(s.mix, true)` (`src/core/convert.ts:126`). The hard-coded `true` assumes decodable source audio, so the job asks mediabunny to transcode the E-AC-3 track to AAC.
6. Observed failure: mediabunny discards the track with `undecodable_source_codec`. `discardedPrimaryTracks` (`src/core/convert.ts:365-374`) treats a discarded kept primary track as fatal, so `ConversionInvalidError` produces the reported banner. The app opens the save picker before this error, which leaves a partial file behind.

All observed audio symptoms come from link 2 (the tab notice) and links 4-6 (the export failure).
The "can't play 4k" symptom belongs to bug B and this chain does not explain it.

The root cause sits outside this codebase (the Chromium build configuration). The cheapest place to
patch is links 4-5, but every patch there changes product behaviour (see options).

Primary sources (accessed 2026-10-31):

- Chromium `media/base/supported_types.cc`, main branch, `IsDecoderDolbyAc3Eac3Supported`, `IsAudioCodecProprietary`: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/supported_types.cc
- Chromium `media/media_options.gni`, main branch, `enable_platform_ac3_eac3_audio` default: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/media_options.gni
- Mediabunny AC-3 extension guide: https://mediabunny.dev/guide/extensions/ac3
- `packages/ac3` in Vanilagy/mediabunny on GitHub (main at v1.65.0, also tagged v1.62.0): package.json, README.md, LICENSE, licenses/ffmpeg, build/

The main-branch Chromium source matches the behaviour measured on Chromium 156, but I did not check
the source at the exact 156 tag.

## 4. Fix applied

None. Direction gate hit: each real fix needs a new dependency or a change in product behaviour.
No regression test was added because there is no fix for it to guard. The repro above is ready
to become one.

### Options for decision

A. Add `@mediabunny/ac3` and call `registerAc3Decoder()` (decoder only), lazy-loaded as a separate chunk.

- Effect: E-AC-3/AC-3 decodes in every browser. The existing 6ch-to-stereo path (`src/core/audioMix.ts:76`) and the AAC encode then run as they do for AAC 5.1 (verified working above for AAC/Opus 5.1). The waveform, Extract audio and audio edits also start working. Preview playback through `<video>` stays silent: the element cannot play E-AC-3 (see the probe), so preview audio would need a decode path through WebAudio. I have not checked how the preview plays audio today.
- Size: `packages/ac3/build/ac3.js` is 704,862 bytes on GitHub main (decoder and encoder, base64 WASM likely). For comparison, the existing lazy chunks in `dist/assets` are 992,221 bytes (`mediabunny-aac-encoder`) and 311,270 bytes (`mediabunny-mp3-encoder`). It fits well inside `check:size` (`MAX_FILE_BYTES = 26_214_400`). The size of the npm tarball for 1.62.0 is unverified because DNS blocked the npm registry.
- Licensing: the package declares MPL-2.0 and embeds FFmpeg libavcodec AC-3/E-AC-3 coders under LGPL-2.1-or-later. Its README says the build "enables no GPL, version 3 or nonfree components" (`licenses/ffmpeg/COPYING.LGPLv2.1`). The repo already has this pattern: `scripts/check-licenses.mjs:20-27` accepts LGPL WASM as a dynamically imported chunk, for aac-encoder and mp3-encoder only. Adding ac3 means a new entry in `LGPL_WASM_EXCEPTIONS` and a new THIRD-PARTY-LICENSES.txt section with a source link.
- Patents: AC-3 and E-AC-3 are Dolby codecs. I did not verify whether any E-AC-3 patents are still in force in the user's distribution jurisdictions, and I did not check Dolby licensing terms. This is UNVERIFIED and needs a legal or product call before shipping a decoder. Software LGPL compliance does not settle patent licensing.
- Version: `packages/ac3` exists at tag v1.62.0 with `"version": "1.62.0"` and `peerDependencies: { "mediabunny": "^1.0.0" }`, so it can match the current pin. I did not check its custom decoder API against mediabunny 1.62.0 at runtime.
- Effort: small. A lazy `registerAc3Fallback()` next to `registerAacFallback` in `src/core/capabilities.ts`, called before `readSource` probes `canDecode()`, plus licence check and docs updates, plus an e2e fixture with E-AC-3 audio.

B. Treat undecodable source audio as absent in the Shrink settings: gate `src/core/autoSettings.ts:71` and `src/ui/controllerSettings.ts:300-302` on `decodable`.

- Effect: the export succeeds as video-only, which matches what the Audio tracks panel already shows (Original audio disabled). Two lines plus tests, no dependency.
- Product risk: the app drops the user's audio without saying so at Export time. It needs explicit export-summary wording (for example "Audio will be removed: this browser cannot decode E-AC-3"). This is the "drop audio" behaviour the brief flags as a product decision.

C. Copy the E-AC-3 track unchanged when it is undecodable and no audio edits are set.

- Effect: keeps the 5.1 audio. Verified working: with `passthrough: true`, the harness muxed E-AC-3 into MP4 without decoding (`convert= OK {"codec":"eac3","channels":6,...}`). This needs a new settings rule, because today passthrough applies only to "already optimal" sources (`src/ui/controller.ts:133`) and `audioOptimal` requires AAC (`src/core/autoSettings.ts:89`).
- Tradeoffs: the output MP4 has E-AC-3 audio, which this same browser cannot play, nor Firefox on Linux. Audio edits, cuts and Extract audio stay unavailable. The output also carries a Dolby bitstream, but the app does not decode it.

D. Fail earlier with a clear message: block Export, or warn before the save picker opens, when the source audio is undecodable. This is the cheapest option, but the user still cannot export. Any of A-C can be combined with D for the cases the chosen option does not cover.

Recommendation, for the decision owner: A alone fixes the reported behaviour, if the patent question clears. B+D is the no-dependency fallback.

## 5. Verification

- Repro before: shown in section 1 (3 of 3 E-AC-3 clips fail with the reported text, 3 of 3 AAC/Opus 5.1 clips succeed).
- Repro after: not applicable, no fix applied.
- Unit suite after the investigation (`pnpm test`, no source changes): `Test Files 42 passed (42)`, `Tests 497 passed (497)`, same as the baseline.
- The temporary spec `e2e/zz-repro-eac3.spec.ts` is deleted. The branch diff contains only this document.

## 6. Sibling risks and related findings

| ID  | Severity       | Location                                                        | Problem                                                                                                                                                                                                     | Proposed fix                                                       |
| --- | -------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S1  | HIGH           | src/core/autoSettings.ts:71                                     | Auto settings include audio for an undecodable source, which causes the reported export failure                                                                                                             | option B, or moot after option A                                   |
| S2  | HIGH           | src/ui/controllerSettings.ts:300-302                            | `validateSettings` checks `!!source.audio` while the tracks panel checks `decodable`, so the UI shows audio off but the export keeps it                                                                     | same as S1                                                         |
| S3  | MED            | src/core/convert.ts:126                                         | `mixHasAudio(s.mix, true)` hard-codes "source has audio" and relies on its callers to have gated on decodability                                                                                            | pass `source?.audio?.decodable ?? true` once S1/S2 are decided     |
| S4  | MED, SUSPECTED | src/ui/controllerExport.ts (save picker before conversion init) | the conversion validity check runs after the picker, so a predictable failure leaves a partial file                                                                                                         | check `canDecode` / `isValid` before opening the picker (option D) |
| S5  | MED, SUSPECTED | `~/Downloads/...[4K HDR 5.1 384kbps].mp4` (VP9 + E-AC-3)        | the same audio failure will hit this file. The E-AC-3 MP4 repro supports this, but I did not run that file                                                                                                  | covered by the chosen option                                       |
| S6  | LOW, SUSPECTED | src/core/audioProcess.ts:316, src/ui/waveform.ts:32             | these paths skip undecodable tracks silently. They look correct, but I have not tested them with this file                                                                                                  | none                                                               |
| B1  | Bug B finding  | src/core/source.ts:61, 102-106                                  | the app accepted the 4K AV1 10-bit file (the user reached the export UI), so `videoTrack.canDecode()` returned true for it. The preview failure is downstream of the source check. Not investigated further | handled in the bug B session                                       |

## 7. Not verified

- The user's exact browser build and channel. The screenshot shows only "Chromium-based". Chrome 156 and Brave 156 on this machine behave identically. Microsoft Edge may enable platform AC-3/E-AC-3 on Windows (not checked), but Edge is not installed here and the user is on Linux.
- The full UI flow with the 303 MB 4K source. I used small derived clips with the same E-AC-3 bitstream to isolate the audio path.
- The full e2e suite. It is long and no code changed.
- Option A at runtime (installing the package was not authorised), the npm tarball size, and E-AC-3 patent and Dolby licensing status.
- Chromium source at the exact 156 tag (I read main only). Mediabunny 1.63-1.65 release notes come from the coordinator's report, not my own reading.

## Phase 4: fix (after approval of option A and S4)

The user approved option A and the S4 fix. The fix is commit `2e28677`, on top of bug B's commits
`9aa29d5` and `b45f7b0`. It leaves `9aa29d5` intact: E-AC-3 sources still preview their video
without sound, because `<video>` cannot play E-AC-3.

### Regression tests

I wrote each test before its fix and confirmed it failed for the root-cause reason:

- `tests/unit/autoSettings.test.ts` "leaves out audio the browser cannot decode instead of re-encoding it". Before the fix it failed with `expected { codec: 'aac', bitrate: 128000, …(2) } to be null`.
- `tests/unit/settings.test.ts` "never requests audio for an undecodable source track, with or without a mix". Before the fix it failed with `expected { codec: 'aac', bitrate: 96000, …(2) } to be null`.
- `tests/unit/capabilities.test.ts` `registerAc3Fallback` and `canDecodeAudioTrack` (5 tests). Before the fix they failed with `is not a function`.
- `tests/unit/controller.test.ts`, S4 (3 tests): the conversion check runs before `openSink`, an invalid conversion never opens the sink, and an unexpected check error does not block the export. Before the fix they failed with `expected "vi.fn()" to not be called at all, but actually been called 1 times` (openSink).
- `e2e/surround-audio.spec.ts` (5 tests) uses the new fixtures `tests/fixtures/h264-eac3-51.mp4` (5.1 E-AC-3) and `tests/fixtures/h264-dts.mkv` (DTS). The second fixture reproduces the gating bug now that E-AC-3 decodes. Both come from `scripts/make-fixtures.sh`.

### Changes

- AC-3 decoder: `@mediabunny/ac3` pinned at 1.62.0 (`package.json`, `pnpm-lock.yaml`). `registerAc3Fallback()` in `src/core/capabilities.ts` follows the AAC/MP3 pattern: a dynamic import, registration once per page, and a retry after a failed load. `canDecodeAudioTrack()` asks the browser first. It loads the decoder only for an `ac3`/`eac3` track that the browser reports as undecodable, then checks again. It replaces `canDecode()` in `src/core/source.ts` (source read) and `src/core/addedAudio.ts` (Add music). The registration is page-wide, so the later decode paths (export, waveform, mixing, audio processing) find the decoder already registered. The app registers only the decoder, never the encoder.
- Gating: `src/core/autoSettings.ts` and `src/ui/controllerSettings.ts` (`validateSettings`) include source audio only when `source.audio.decodable` is true. An undecodable source now exports video only, which matches the Audio tracks panel. Such a source is also never "already optimal", so it does not take the trimmed-copy path.
- S4: `checkConversion()` (new `src/core/conversionCheck.ts`) runs `Conversion.init` and the existing validity rule against an output with a `NullTarget` that never starts, then cancels it. `startConversion` uses the same `initConversion`/`assertConversionValid` helpers, so the check and the real run share one rule. `src/ui/controllerExport.ts` calls the check after `spec.preflight()` and before `openSink`. A `ConversionInvalidError` shows the invalid-settings notice without the partial-file sentence. Any other check error is logged with `console.warn` and the export continues, because the real conversion reports its own failures. I moved the code into a new module because `convert.ts` would have exceeded the `max-lines` rule. `convert.ts` re-exports `ConversionInvalidError`, `discardedPrimaryTracks` and `checkConversion`.
- Packaging: the LGPL WASM exception in `scripts/check-licenses.mjs` now covers `@mediabunny/ac3`. `scripts/check-no-remote.mjs` allowlists `https://streams.videolan.org/upload/`, which is FFmpeg log text inside the WASM and is never loaded. The comment in `vite.config.ts` notes that the service worker precaches the AC-3 chunk (`dist/sw.js` lists it).
- Docs: README (feature bullet, browser notes, credits table, "AC-3 and E-AC-3 decoder" section with a licence audit), THIRD-PARTY-LICENSES.txt (`## @mediabunny/ac3`), and an `[Unreleased]` CHANGELOG entry. I did not bump the version.

Patent question: still open. The README and THIRD-PARTY-LICENSES.txt say the licence notices cover the software only, not Dolby patent rights.

## Phase 5: verification

Before the fix, the user's files failed with `ConversionInvalidError: ... (audio track: undecodable_source_codec)` (section 1). After the fix, a temporary harness spec (removed) converted seconds 20-23 of each file to 1080p30 H.264 with AAC 128 kbps stereo in Playwright Chromium:

```
mkv read {"v":"av1","a":{"codec":"eac3","decodable":true,"channels":6,"sampleRate":48000,...}}
mkv convert {"d":3.029333333333333,"v":"avc","a":{"codec":"aac","decodable":true,"channels":2,"sampleRate":48000,...}}
mp4 read {"v":"vp9","a":{"codec":"eac3","decodable":true,"channels":6,"sampleRate":48000,"bitrate":384000}}
mp4 convert {"d":3.029333333333333,"v":"avc","a":{"codec":"aac","decodable":true,"channels":2,"sampleRate":48000,...}}
mkv check {"ok":true}
mp4 check {"ok":true}
```

This covers S5: the sibling `[4K HDR 5.1 384kbps].mp4` (VP9 with E-AC-3) also exports.

- Unit tests (`pnpm test`): baseline `Tests 497 passed (497)`. Final `Test Files 42 passed (42)`, `Tests 508 passed (508)` (11 new).
- Typecheck, `pnpm lint` (`ESLint: No issues found`), and `pnpm format:check` (`All matched files use Prettier code style!`) all pass.
- Build (`pnpm build`): passes, including `licence check passed` and `check:remote ok: no URL outside the allowlist in 15 built files`. `check:size ok`.

| Build output                                                      | Before                     | After                                                         |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| Initial JS (`index-*.js` + modulepreloaded `preload-helper-*.js`) | 858.23 kB (gzip 234.47 kB) | 729.73 + 133.41 = 863.14 kB (gzip 202.10 + 35.72 = 237.82 kB) |
| `mediabunny-ac3-*.js` (lazy, own chunk)                           | none                       | 1,144.34 kB (gzip 303.68 kB)                                  |
| `mediabunny-aac-encoder-*.js` / `mediabunny-mp3-encoder-*.js`     | 992.34 / 311.39 kB         | 992.41 / 311.46 kB                                            |
| `dist/` total                                                     | 2,755,739 bytes            | 3,907,156 bytes                                               |

The decoder sits in its own chunk: `registerAc3Decoder` appears only in `mediabunny-ac3-*.js`. A second lazy chunk now shares Mediabunny code with the AAC chunk, so Rollup split that code into `preload-helper-*.js`. The page preloads that file, so initial JS grows by 4.9 kB raw (3.3 kB gzip). The e2e test "an AAC source never fetches the AC-3 decoder" confirms that an AAC file never requests the chunk. "a 5.1 E-AC-3 source loads the AC-3 decoder and exports" confirms that an E-AC-3 file requests it.

- Chromium e2e project (`pnpm exec playwright test --project=chromium`): `170 passed`, `7 skipped`. All 7 skips are `@mobile` tests. I did not record a Chromium e2e baseline before the change.
- Instrumentation: the temporary specs `e2e/zz-repro-eac3.spec.ts` and `e2e/zz-real-files.spec.ts` are deleted and do not appear in any commit.

### Findings during the fix

| ID  | Severity       | Location                            | Problem                                                                                                                                                                                                                                                                                                                                           | Proposed fix                                                    |
| --- | -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| F1  | MED            | `e2e/harness.ts` `checkConversion`  | Without encoder registration, the pre-save check reported `audio track: no_encodable_target_codec` for the real files while the real conversion succeeded. Mediabunny's check depends on registration order. Fixed in the harness. In the app, `probeCapabilities` registers the AAC fallback at load and the MP3 preflight runs before the check | keep every encoder registration ahead of `checkConversion`      |
| F2  | MED, SUSPECTED | `src/core/audioMix.ts:238`          | With added music and Original audio on, a source with undecodable audio (for example DTS) still throws "The original audio cannot be decoded for mixing". The include switch is disabled in the UI, but a stored mix can keep `original.include: true`                                                                                            | gate on `source.audio.decodable` in `shrinkJob`/`mixedAudioJob` |
| F3  | LOW            | `src/core/conversionCheck.ts`       | The check runs `Conversion.init` a second time per export: decoder and encoder config probes, no decoding. Its cost on slow devices is not measured                                                                                                                                                                                               | none unless measured                                            |
| F4  | LOW            | upgrade to `@mediabunny/ac3` 1.65.0 | Later upstream versions patch FFmpeg's AC-3 encoder before building and ship `licenses/ffmpeg`. Re-run the licence audit and update THIRD-PARTY-LICENSES.txt when upgrading                                                                                                                                                                       | part of the mediabunny upgrade                                  |

### Not verified

- Dolby AC-3/E-AC-3 patent and licensing status, left open as instructed.
- The WebKit, iPhone and iPad e2e projects. I ran only the Chromium project, so the decoder fallback path is unverified on WebKit, which may decode E-AC-3 natively.
- The full UI flow with the 303 MB and 339 MB files. The harness converted them, and the UI export was run only with the small fixtures.
- The user's own browser build. The preview still has no sound for E-AC-3 sources, by design of bug B's fix.
- Offline export with an E-AC-3 source. `sw.js` lists the chunk, but I did not test this.
