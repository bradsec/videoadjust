# Change review: fix/surround-audio-4k

Step 3 of the bug lifecycle, change reviewer. Reviewed 2026-11-01. Base `main` (08cfba8), head `ed807e6`,
`git diff main...fix/surround-audio-4k`: 37 files, +1214/-118. Hand-written logic is about 250 lines in `src/`,
`scripts/` and `vite.config.ts`. The rest is docs, tests, fixtures and the lockfile.

## 1. Change and intent

Change (stated, reports 01-03): decode AC-3/E-AC-3 through a lazily loaded `@mediabunny/ac3` decoder; leave out
source audio the browser cannot decode instead of re-encoding it; run the conversion validity check before the
save picker opens (S4); preview video whose audio codec the element cannot play (bug B); upgrade mediabunny and
`@mediabunny/*` from 1.62.0 to 1.65.0. The outcome: E-AC-3 sources export with stereo AAC, undecodable
sources export video only, and an export that cannot work fails before any file is written.

## 2. Verdict

CHANGES REQUIRED, decided by C1. Confidence on the defect: HIGH (proof test passes, path traced). Confidence on
the verdict: MED. C1 already exists on `main`. The change does not introduce it, but it leaves unfixed a sibling
of the gating bug it fixes (report 01, S3, `mixHasAudio(s.mix, true)`). Shipping C1 as a tracked follow-up is
a reasonable alternative, and that choice belongs to the owner. Nothing else blocks the change.

## 3. Findings

ID | SEVERITY | file:line | problem | trigger | proposed fix | CONFIDENCE

- C1 | HIGH | src/core/audioMix.ts:238 (via src/ui/controller.ts:470-471, src/ui/controllerSettings.ts:302, src/core/convert.ts:119, src/core/convert.ts:349) | F2 CONFIRMED, and broader than "stored mix". When the user adds music, `loadAddedAudio` builds the mix with `normalizeAudioMix`, which defaults `original.include` to true. The Original audio checkbox is disabled for undecodable audio (src/ui/audioTracksControls.ts:142-143), so the user cannot clear it. `validateSettings` keeps the audio because `mix.added` is set. `shrinkJob` computes `keepsAudio` from `mixHasAudio(s.mix, true)` and builds a mixed job whose `options.audio` is `{ discard: true }`. `checkConversion` therefore passes, because the mix runs in `prepare`/`samples`, which the check skips (conversionCheck.ts:80-82). The save picker then opens, and `mixed()` throws "The original audio cannot be decoded for mixing." That error reaches the generic "The export failed" banner, and a file-stream save leaves a partial file. `audioExtractJob` (convert.ts:349) has the same `mixHasAudio(s.mix, true)`, so Extract audio with added music fails the same way (traced, not run). | A video with DTS or TrueHD audio, or E-AC-3 when the AC-3 chunk fails to load (offline without the cached chunk), plus "Add music or audio", then Export | In `createMixProcessor`, treat `mix.original.include` as false when the original track cannot be decoded (or normalise `original.include` to false in `validateSettings`/`applyMix` when `!source.audio?.decodable`). Pass `source?.audio?.decodable ?? true` to `mixHasAudio` in `shrinkJob`, and handle `audioExtractJob` the same way. Add a test for added music on a DTS source (proof below) | HIGH
- C2 | LOW, SUSPECTED | src/ui/controllerExport.ts:119 | The check adds a second awaited step, `Conversion.init` with decoder and encoder config probes, between the Export click and `showSaveFilePicker` in `openSink`. The shrink preflight already awaits `canEncodeVideo` there. If the gap outlasts the browser's transient user activation window, the picker throws, and the user sees "The new file could not be created". Not measured. The activation lifespan was not checked against current Chromium docs | A file-stream save on a slow device with a large or remote-backed file | Measure the check on a low-end device. If it is slow, run the check in parallel with the picker and abort the sink when the check rejects | LOW
- C3 | LOW | src/core/conversionCheck.ts:93-95 | If `initConversion` throws (Conversion.init error, not an invalid result), the `try`/`finally` has not started yet. The NullTarget output and any `AudioSampleSource` added to it are never cancelled. Nothing is written and the GC reclaims them, so the impact is small | Conversion.init rejects, for example on an unexpected demuxer error | Create the output inside the `try` and cancel it in `finally` when `conversion` is undefined | HIGH
- C4 | LOW | src/core/conversionCheck.ts:84 (F3) | Each export runs `Conversion.init` twice, once in the check and once in the real run. The cost is accepted in report 01 and has not been measured | Every non-GIF export | None now. Measure if exports start slowly on phones | HIGH

F1 (pre-save check depends on encoder registration order): ruled out for the app, HIGH confidence. The app
awaits `probeCapabilities()` before it enters the prepare state (src/ui/controllerSource.ts:36,47), and that
probe awaits `registerAacFallback` when the browser has no native AAC (src/core/capabilities.ts, `probe(d.registerAacFallback, ...)`).
The MP3 encoder registers in `audioSpec.preflight` (controllerExport.ts:411-414), which runs before the check
(controllerExport.ts:110 then 119). Opus has no fallback. The check and the real run therefore see the same
registered encoders. The order dependency affected only the harness, which the change fixed.

### Proof test for C1 (not applied; ran from the scratchpad against the branch, passes)

```diff
+it('added music on an undecodable source fails only after the pre-save check', async () => {
+  const auto = autoSettings(dts, caps); // dts: SourceInfo with audio.decodable false
+  const s = validateSettings(
+    { ...auto.settings, mix: { original: { include: true, volumeDb: 0 },
+      added: { volumeDb: 0, offset: 0, loop: false } } }, auto, caps, dts);
+  expect(s.audio).not.toBeNull();
+  const added = { file: new File([], 'm.mp3'), duration: 1, channels: 2, sampleRate: 48000,
+    input: { getPrimaryAudioTrack: async () => ({ canDecode: async () => true }) } as never };
+  const job = shrinkJob(s, dts, {}, added);
+  expect(job.keeps.audio).toBe(true);
+  expect(job.options.audio).toEqual({ discard: true }); // nothing for checkConversion to reject
+  const input = { getPrimaryAudioTrack: async () => ({ canDecode: async () => false }) } as never;
+  await job.prepare?.(input, new AbortController().signal, () => {});
+  const it = job.customAudio!.samples(input, new AbortController().signal)[Symbol.asyncIterator]();
+  await expect(it.next()).rejects.toThrow('The original audio cannot be decoded for mixing.');
+});
```

Output: `Test Files  1 passed (1)`, `Tests  1 passed (1)`.

### Focus areas with no finding

- Lazy AC-3 load race: none found. `registerAc3Fallback` shares one promise (capabilities.ts:57-69).
  `InputAudioTrack.canDecode()` caches nothing and checks `customAudioDecoders` on every call
  (node_modules/mediabunny/dist/modules/src/input-track.js:807-833), so the second call in
  `canDecodeAudioTrack` sees the registration. Export, waveform and mixing read a source only after `readSource`
  has awaited the registration. A failed chunk load logs a warning, leaves the track undecodable (video-only
  export via the new gating), and clears the promise so a later file retries. `dist/sw.js` precaches
  `mediabunny-ac3-*.js` and the stub. An offline load with an evicted cache leads to the C1 trigger only if the
  user also adds music.
- Pre-save check: it does not run for GIF (early return at controllerExport.ts:80). Extract audio uses its own
  job and format. Cuts and mixes go through the composable path, and the check cancels both the conversion and
  the output. Non-composable `cancel()` cancels the output (conversion.js:852-854). Unexpected check errors do
  not block the export. `registerFrameCrop` (only in `startConversion`) registers a sample transformer and does
  not affect `Conversion.init` validity. The check needs no network. Apart from C3, no Input or Conversion
  leaks. The caller owns the Input.
- Licence check: `LGPL_WASM_EXCEPTIONS` matches exact package names. `@mediabunny/ac3` declares MPL-2.0, so
  the exception is not exercised today. `JS_URL_ALLOWLIST` matches one exact URL string. Both exceptions are
  narrow. Neither script enforces "loaded only through dynamic import()". That gap predates this change, and the
  e2e test "an AAC source never fetches the AC-3 decoder" covers the AC-3 case.
- `__vite-browser-external-*.js` (1,018 bytes): explained, harmless. It holds rolldown's CJS interop helpers
  (`__commonJS`, `__toESM`, `__require` with its "rolldown.rs/in-depth/bundling-cjs" error text) and Vite's
  empty module for `worker_threads`. The extension packages map `worker_threads` to an empty module through
  `"browser": { "worker_threads": false }` in package.json, the same in 1.62.0 and 1.65.0. The AAC, MP3 and
  AC-3 chunks import it, and so does the shared mediabunny chunk. The ac3 chunk reaches `worker_threads` only
  in a Node fallback inside `try`/`catch` after the browser `Worker` path. Rolldown's chunking decides
  whether the helpers land in a separate file or fold into `preload-helper`. Without a 1.62.0 build I could not
  confirm that it is the 1.62.0 `preload-helper` content renamed (MED). Its URL passes `check:remote`, and
  `sw.js` precaches it.
- Bug B (`canPlaySource`): both callers (prepareView.ts:171, compare.ts:285) pass `SourceInfo`. A missing
  codec string falls back to the full MIME type. The QuickTime mapping stays.
- Contract: `AppDeps.checkConversion` is a new required dependency. The only `createApp` caller is
  src/main.ts. `ConversionInvalidError` and `discardedPrimaryTracks` are re-exported from `convert.ts`, so the
  existing imports still work. `SourceInfo.video.codecString` is optional. There are no persisted format or
  config changes.
- Moving `initConversion`/`assertConversionValid` keeps behaviour: the non-custom path passes `{ ...trackOptions, tags }`, the same as `job.options`.

## 4. Callers and sibling paths checked

- `canDecodeAudioTrack`: src/core/source.ts:100, src/core/addedAudio.ts:12. Remaining direct `canDecode()`:
  audioMix.ts:238/240, waveform.ts:32 and audioProcess.ts:316, each after registration. Correct.
- `decodable` gating: autoSettings.ts:73, controllerSettings.ts:300, controller.ts:425, prepareView.ts:123/202/403,
  audioExtract.ts:33. Unfixed: convert.ts:119 and convert.ts:349 (`mixHasAudio(s.mix, true)`) and
  audioMix.ts:238 (C1).
- `checkConversion`/`startConversion`: controllerExport.ts:119/165, src/main.ts, e2e/harness.ts.
- `probeCapabilities` timing: controllerSource.ts:36-47, main.ts.

## 5. Check results (run on the branch head, scratch output outside the repo)

- `pnpm test`: `Test Files  42 passed (42)`, `Tests  508 passed (508)`
- `pnpm lint`: exit 0, no output
- `pnpm typecheck`: exit 0, no output
- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm build`: `licence check passed`, `check:remote ok: no URL outside the allowlist in 15 built files`, exit 0 (Rolldown warning "Some chunks are larger than 500 kB"; not compared against main)
- `pnpm check:size`: `check:size ok: all dist files are at most 26214400 bytes`
- `pnpm exec playwright test --project=chromium`: `170 passed (47.2s)`, `7 skipped`, exit 0
- C1 proof test (scratchpad vitest config): `Tests  1 passed (1)`

## 6. Not reviewed or not verified

- WebKit, iPhone and iPad e2e projects: not run, because only Chromium was in scope.
- C1 through the real UI, and the Extract audio variant of C1: traced and unit-proved, not driven in a browser.
- C2: the transient activation lifespan and the check's duration on slow devices were not measured, and no
  documentation was consulted.
- The `__vite-browser-external` stub against a 1.62.0 build: not compared, because building another revision
  would need a checkout.
- Dolby patent status: out of scope and still open per reports 01 and 03.
- Lockfile, fixtures (binary) and THIRD-PARTY-LICENSES.txt WASM hashes: skimmed only.

Route C1 to the change author or debugengineer. No whole-repo issues to route to codereviewengineer.
