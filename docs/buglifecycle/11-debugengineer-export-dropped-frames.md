# 11: exported 4K-to-1080p video stutters (dropped frames)

Branch `fix/export-dropped-frames` from `main` at `dcf90fe` (v0.28.1). Environment: Debian 13,
Linux 6.12, Chrome 156 (`/usr/bin/google-chrome-stable`), Playwright 1.64.1, mediabunny 1.62.1,
ffmpeg from the host.

## 1. Symptom and minimal reproduction

User report: "when I converted that 4k to 1080 surround the video playback was choppy and frame
stuttering even in standalone player".

The export has perfect 30 fps timestamps, but about one in three source frames is missing and the
next frame shows twice in its place.

Minimal reproduction: `tests/fixtures/counter-30fps-ms.mkv`. It is 640x360 8-bit H.264 in
Matroska, 120 frames at 30 fps, and each frame paints its index as 10 binary columns. Export it
at the app's measured source rate (`readSource` reports 29.9975 fps), with no resize, and decode
every output frame's counter with `window.vrHarness.convertFrameCounters`:

```
before: {"frames":120,"repeats":39,"jumps":39,"head":"0,1,2,4,4,5,7,7,8,10,10,11,13,13,..."}
after:  {"frames":120,"repeats":0,"jumps":0,"head":"0,1,2,3,4,5,6,7,8,9,10,11,12,13,..."}
```

The automated form is the Playwright test `keeps every source frame once at an unchanged frame
rate` in `e2e/convert.spec.ts`.

Shrinking showed that resolution (4K vs 1080p), bit depth (10-bit AV1 vs 8-bit H.264), HDR and
audio are not factors. The two inputs that matter are millisecond timestamps (Matroska's default
1/1000 timebase) and an explicit `frameRate` a hair under the true rate:

| Input                         | frameRate passed   | Output                          |
| ----------------------------- | ------------------ | ------------------------------- |
| 4K H.264 MKV (ms timestamps)  | 30                 | 0 repeats                       |
| 4K H.264 MP4 (1/30 timescale) | 30                 | 0 repeats                       |
| 1080p H.264 MKV               | 30                 | 0 repeats                       |
| 1080p H.264 MKV               | 29.9975 (measured) | 39 repeats, 39 jumps out of 120 |

## 2. Hypotheses

| ID  | Hypothesis                                                                                                       | Evidence for                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence against                                                                                                                                                                  | Result                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| H1  | Mediabunny's frame-rate normalisation mis-buckets frames, because the app passes a measured, inexact `frameRate` | The app passes `frameRate: v.fps` (`src/core/convert.ts:195` before the fix). `readSource` sets `fps` from `computePacketStats().averagePacketRate`, which is 29.99992 for the user's file. `media-source.ts:399-431` floors each timestamp into a slot and keeps the last frame per slot. A replay of that logic over the source's ffprobe pts predicts 1255 of 3768 frames lost, and its slot map (1503:1504, 1506:1507) matches the frames measured in the user's export | none                                                                                                                                                                              | CONFIRMED, HIGH                                                             |
| H2  | The pipeline reuses the last frame when decode or canvas work falls behind                                       | Stutter appears on a heavy 4K AV1 source                                                                                                                                                                                                                                                                                                                                                                                                                                    | The 4K synthetic export at frameRate 30 has 0 repeats. The pattern is strictly periodic (every third frame), not load dependent                                                   | RULED OUT                                                                   |
| H3  | A canvas readback race returns stale frames                                                                      | Mediabunny reuses one transform canvas                                                                                                                                                                                                                                                                                                                                                                                                                                      | A canvas-backed `VideoSample` becomes a `new VideoFrame(canvas)` snapshot (`sample.ts:570-585`). The no-resize 1080p case fails the same way. Removing `frameRate` alone fixes it | RULED OUT                                                                   |
| H4  | The 10-bit AV1 software decoder returns duplicate frames                                                         | Source is AV1 Main 10                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 8-bit H.264 fixtures reproduce the fault. A 4K/10-bit decode is not needed                                                                                                        | RULED OUT                                                                   |
| H5  | Frame-rate conversion picks the wrong frames when input and output rates are equal                               | Same as H1                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |                                                                                                                                                                                   | Same as H1: the conversion should not run at all when the rate is unchanged |

## 3. Root cause chain

1. Trigger: a 30 fps source with millisecond timestamps (0, 33, 67, 100 ms), which is any Matroska file.
2. `readSource` reports the averaged packet rate, 29.99992 fps, and `autoSettings` keeps it as the export `fps`.
3. Fault: `shrinkJob` always passes `frameRate: v.fps` to the Mediabunny `Conversion`, even when the rate is unchanged.
4. Mediabunny computes `floor(t * 29.99992) / 29.99992` for each frame. A frame at exactly k/10 s (for example 100 ms) lands just under its slot boundary, in the slot of the previous frame. Mediabunny keeps it as the slot's replacement, but that slot was already encoded, so the frame is never encoded. The next frame (rounded down to 133 ms) then fills the empty slot without padding, and the frame after it pads one more slot with a repeat.
5. Observed: one in three frames is dropped and its neighbour shows twice, and the 30 fps timestamps look perfect. The lead's mpdecimate count measured about 450 lost distinct frames: the source repeats many frames itself, so a dropped frame often duplicates a frame that is still there.

All the symptoms fit this chain: the stutter in every player (it is baked into the file), the clean timestamps, the period of three, and the absence of any link to load, resolution or bit depth. Exact `frameRate: 30` loses frames too: the replay predicts 17 of 3768 from floating-point edges.

## 4. Fix

`src/core/convert.ts`: pass `frameRate` only when the export lowers the source rate
(`v.fps < source.video.fps - 0.01`, the same tolerance as `src/ui/previewGeometry.ts:14`). When
no source info is given, the old behaviour stays. If `frameRate` is not set, Mediabunny keeps
every decoded frame at its source timestamp.

Regression tests:

- `tests/unit/convert.test.ts`: `leaves frameRate unset when the export keeps the source frame rate` (fails before the fix) and `passes frameRate when the export lowers the source frame rate`.
- `e2e/convert.spec.ts`: `keeps every source frame once at an unchanged frame rate`. It decodes every output frame's counter and expects exactly 0..119.
- `tests/unit/controller.test.ts`: one existing test asserted `frameRate: 30` for an unchanged 30 fps source, which is the faulty behaviour. That test now asserts that the option is absent.
- `e2e/harness.ts`: `convertFrameCounters`. `scripts/make-fixtures.sh` has the recipe for the fixture.

## 5. Verification

The fixture test fails on the old `convert.ts` (Playwright chromium, `-g "keeps every source frame"`):

```
    - Expected  - 39
    + Received  + 39
    -   3,
    +   4,
```

It passes with the fix. The user's source was exported in full through the harness in Chrome 156
(1920x1080 H.264, 4 Mbps, AAC stereo 128 kbps, fps = the measured 29.99992). Counts come from
`ffmpeg -vf scale=480:-2,mpdecimate,showinfo`, where a gap is more than 1.5 frame intervals
between kept frames:

| File                        | Distinct frames | Gaps |
| --------------------------- | --------------- | ---- |
| Source MKV (4K PQ 10-bit)   | 2535            | 787  |
| User export `lasttest.mp4`  | 2083            | 1183 |
| Harness export, old code    | 2082            | 1183 |
| Harness export, fixed       | 2872            | 618  |
| goyt ffmpeg 1080p reference | 2876            | 631  |

The old code reproduces the user's file almost exactly. The fixed export matches the ffmpeg
reference. Its 3768 frames have 0 irregular pts steps. The source scores fewer distinct frames
than both SDR outputs because mpdecimate compares a dim, untone-mapped PQ picture, so the SDR
reference is the fair comparison. A per-frame check at the 1503-1507 cut (64x36 normalised
correlation) shows output slot 1506 matching source 1506 (0.9950), where before it showed 1507
twice.

Checks with CI=1 on the final tree:

- `pnpm test`: baseline `Tests  510 passed (510)`, final `Test Files  42 passed (42)`, `Tests  512 passed (512)`
- `pnpm lint`: `ESLint: No issues found`
- `pnpm typecheck`: tsc exits 0 with no output
- `pnpm format:check`: `All matched files use Prettier code style!`
- `pnpm build`: `check:remote ok: no URL outside the allowlist in 15 built files`
- Playwright chromium: `173 passed`, `7 skipped`. Port 4317 was held by the other agent's preview server in the main checkout, so this run used a scratch copy of `playwright.config.ts` on port 4393. The copy was deleted afterwards and nothing in the repo changed.

Instrumentation: the temporary `__debugBlob` hook used to pull the full-file exports out of the
page lived only in a scratch build and is not in the diff.

## 6. Sibling risks and related findings

| ID  | Severity                        | Location                                                       | Problem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Proposed fix                                                                                                                                                                                                                                                                |
| --- | ------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | MED (SUSPECTED, simulated only) | `src/core/autoSettings.ts:56`, `src/core/convert.ts` frameRate | Sources at 50 fps or more export at half rate through the same floor-slot logic. A replay of 60 fps ms timestamps at frameRate 30 gives 1200 of 1800 uneven frame steps (judder), not a clean every-other-frame pick                                                                                                                                                                                                                                                                                                                                                                                             | Decimate in `process` by source frame index, or snap timestamps (`Math.round`) before Mediabunny buckets them. Report upstream                                                                                                                                              |
| S2  | LOW                             | `src/core/source.ts:89`                                        | `fps` is the averaged packet rate (29.99992, 29.9975), not a nominal rate. The UI shows it and the bitrate maths use it, and any future equality check on it is fragile                                                                                                                                                                                                                                                                                                                                                                                                                                          | Use Mediabunny's best-guess rate, or round to a known rate for display and settings                                                                                                                                                                                         |
| S3  | LOW (upstream)                  | mediabunny `media-source.ts:403`                               | `floorToDivisor` puts frames that sit on a slot boundary minus epsilon into the previous slot, so it drops frames even at an exact frameRate (17 of 3768 here)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Upstream issue: bucket with a half-frame tolerance or `Math.round`                                                                                                                                                                                                          |
| C1  | MED, finding, not fixed         | mediabunny transform canvas plus the Chrome encoder            | The output is tagged `yuvj420p` (`color_range=pc`), `color_transfer=iec61966-2-1` (sRGB), `color_primaries=bt709` and `color_space=bt709`, before and after this fix. Mediabunny resizes on a canvas and wraps it as `new VideoFrame(canvas)`, which carries an sRGB full-range colour space. Chrome's encoder reports that colour space in `decoderConfig.colorSpace`, and Mediabunny writes it to the `colr` box and VUI (`isobmff-boxes.ts:805-824`). The app's convert path never sets a colour space, and mediabunny 1.62.1 `Conversion` has no option for one, so this is not a small change in `src/core` | Do the RGB-to-YUV step ourselves (copy the canvas to I420, limited range BT.709, and build a `VideoFrame` with an explicit `colorSpace`) in `process`, or ask upstream for an output colour-space option. Test that players treat the pixel range and the tags the same way |

## 7. Not verified

- WebKit, iPhone and iPad Playwright projects: the lead runs these.
- Playback smoothness was judged from frame maps and mpdecimate counts, not watched in a player.
- Halving exports at 50 fps or more (S1) were simulated only, not exported.
- Sources other than this MKV and the synthetic fixtures were not tested: MP4 with odd timescales, and true VFR phone footage. Without `frameRate`, the output keeps the source timestamps, so a VFR source now stays VFR rather than being forced to a constant rate.
- C1: whether the encoded pixels are full range to match the tags was not checked.
- No web lookup was done. Mediabunny behaviour comes from the local 1.62.1 source in `node_modules/mediabunny/src`.

## 8. Follow-up: WebKit ignores the bitrate without `frameRate` (not fixed)

After the fix, two WebKit tests fail: `e2e/convert.spec.ts:49` (`Expected: <= 360335`,
`Received: 2327391`) and `e2e/result.spec.ts:106` (`"650.4 kB, not smaller"`). Chromium passes.

Cause, confirmed: with no `frameRate`, Mediabunny 1.62.1 configures `VideoEncoder` with no
`framerate` (`mediabunny.mjs:36362` reads it from the output track metadata, set only from
`trackOptions.frameRate` at 41727). WebKit's H.264 encoder then overshoots the bitrate. A direct
`VideoEncoder` probe in Playwright WebKit (1280x720, 90 frames, 500 kbps target) gave 10030 kbps
without `framerate` and 452 kbps with `framerate: 30`. Chromium gave the same size either way.
The Conversion API has no other route to the encoder config (`onEncoderConfig` is internal).

Snapping the rate does not keep every frame. The resampler buckets with
`Math.floor(t * frameRate)` (`mediabunny.mjs:662`, 36141). Padding repairs one early frame, but
two early frames in a row lose one. Measured in-browser with 12-bit counter files (Chromium and
WebKit gave the same counts):

| Source (timebase)   | frameRate unset | exact nominal | nominal x (1 + 1e-9) |
| ------------------- | --------------- | ------------- | -------------------- |
| 30 fps MKV (1 ms)   | 0 of 3600 lost  | 17            | 0                    |
| 25 fps MKV (1 ms)   | 0 of 3000       | 11            | 0                    |
| 29.97 MKV (1 ms)    | 0 of 3597       | 385           | 360                  |
| 29.97 MP4 (1/30000) | 0 of 3597       | 66            | 0                    |
| 23.976 MP4 (1/90k)  | 0 of 2878       | 0             | 0                    |

Exact 30 drops frames at float edges (`0.7 * 30` is `20.999999999999996`). A tiny upward nudge
fixes those, but /1001 rates on a millisecond grid round two frames early in a row, which no
multiplicative rate can fix. A replay of the resampler over the user's file pts predicts 17 of
3768 lost at 30, 0 with the nudge. Mediabunny 1.65.0 has the same `floorToDivisor` bucketing.

No `frameRate` value keeps every frame for all constant-rate sources and also gives WebKit a
`framerate`. Options for the lead:

1. Nudged nominal snap, used only where measured lossless (integer rates, and /1001 rates outside
   Matroska/WebM); leave `frameRate` unset for /1001 Matroska, so WebKit overshoots there.
2. Patch Mediabunny (`pnpm patch`) to bucket with `Math.round` or a half-slot tolerance, then pass
   the snapped nominal rate. Report upstream.
3. Wrap `VideoEncoder.prototype.configure` to add `framerate`. Global and racy with the preview
   copy conversion; not recommended.
