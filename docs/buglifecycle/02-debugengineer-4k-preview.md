# Bug B: 4K video preview does not play

Step 2 of the bug lifecycle, debug engineer. Branch `fix/surround-audio-4k`, on top of the bug A
report (68e0f9f, 838f1c3). Investigated 2026-10-31. Outcome: code defect in this codebase, fixed in
9aa29d5. Neither 4K nor AV1 causes the failure. The preview gate rejected the file because its
MIME type lists the E-AC-3 audio codec, which Chromium on desktop Linux cannot play. The video
itself plays.

## 1. Symptom and minimal reproduction

Reported (verbatim): "it can't seem to play 4k videos".

- File info: "303.2 MB · 3840x2160 · 30 fps · Constant frame rate · HDR · AV1 · 2:05.6"
- Preview area: "This browser cannot play the preview. Trimming still works with the handles and thumbnails. The trim Set buttons require a playable preview."
- Trim filmstrip: appeared empty in the user's screenshot.
- Expected: the preview plays the video (silently is acceptable, because bug A shows the browser cannot decode E-AC-3).
- Actual: the app removes the `<video>` element and shows the note.

Environment: Debian 13, kernel 6.12.113, mediabunny 1.62.0, Playwright Chromium 156.0.8078.4,
Google Chrome 156.0.8078.79, Brave 156.1.98.62, ffmpeg 7.1.5. All browser runs were headless under
Playwright. Source file: MKV, AV1 Main 10-bit 3840x2160 PQ/BT.2020, plus E-AC-3 5.1(side) 48 kHz.
Nothing in the codebase changed around the report. The trigger is the input file.

Minimal reproduction: a 4 s 320x240 H.264 SDR clip with E-AC-3 audio reproduces the same note.
Resolution, AV1, bit depth, HDR and container have no effect.

```
ffmpeg -f lavfi -i testsrc2=s=320x240:r=30:d=4 -i <eac3 source> -map 0:v -map 1:a \
  -c:v libx264 -pix_fmt yuv420p -c:a copy -shortest h264-eac3.mkv
```

The repo now has a generated equivalent, `tests/fixtures/h264-eac3.mp4` (testsrc2 + sine, made by
`scripts/make-fixtures.sh`), and an e2e test that fails on the old code:

```
pnpm exec playwright test e2e/trim.spec.ts --project=chromium -g "cannot play still gets"
```

Before the fix (fix stashed, test present):

```
✘  1 [chromium] › e2e/trim.spec.ts:110:1 › a source whose audio the browser cannot play still gets a video preview (5.3s)
  Error: Timeout 5000ms exceeded while waiting on the predicate
```

The predicate waits for `.preview-video` to report `videoWidth` 640. The old code removes that element.

### Variable isolation (temporary probe spec, removed)

For each clip the probe read the source through `e2e/harness.html`. It then called `canPlayType`
with the app's MIME type and with the bare container type, loaded the file into a bare `<video>`
element and played it for 2 s. Last, it loaded the file into the real app and recorded whether
the note shows and when thumbnails render. Playwright Chromium, old code:

| Clip (4 s unless noted)           | `containerMime` codecs                 | canPlayType(full) | bare `<video>`                  | App note | Thumbs     |
| --------------------------------- | -------------------------------------- | ----------------- | ------------------------------- | -------- | ---------- |
| user file, full 2:05.6            | `av01.0.12M.10.0.110.09.16.09.0, ec-3` | ""                | loadeddata 3840x2160, 56 frames | shown    | 8 at 6.2 s |
| orig-av1-eac3.mkv (stream copy)   | `av01...09.0, ec-3`                    | ""                | loadeddata 3840x2160, 56 frames | shown    | 8 at 3.6 s |
| av1-eac3.mp4 (remux)              | `av01...09.0, ec-3`                    | ""                | plays                           | shown    | 8          |
| h264-eac3.mkv (320x240 SDR)       | `avc1.64000d, ec-3`                    | ""                | plays                           | shown    | 8          |
| av1-noaud.mkv / .mp4 / .webm      | `av01...09.0`                          | "probably"        | plays                           | hidden   | 8          |
| av1-aac.mkv / .mp4                | `av01...09.0, mp4a.40.2`               | "probably"        | plays                           | hidden   | 8          |
| av1-opus.webm                     | `av01...09.0, opus`                    | "probably"        | plays                           | hidden   | 8          |
| av1-1080-10b-hdr.mp4 (re-encoded) | `av01.0.08M.10...`                     | "probably"        | plays                           | hidden   | 8          |
| av1-4k-8b.mp4, av1-4k-10b.mp4     | `av01.0.12M.08...`, `av01.0.12M.10...` | "probably"        | plays                           | hidden   | 8          |
| h264-noaud.mkv                    | `avc1.64000d`                          | "probably"        | plays                           | hidden   | 8          |

"plays" means `loadeddata` fired and `getVideoPlaybackQuality()` showed 55-57 frames with 0 dropped
after 2 s. The note appears exactly when the codec list contains `ec-3`. Chrome 156 and Brave 156 gave
identical results for the user file, orig-av1-eac3.mkv, av1-noaud.mkv, av1-aac.mkv and h264-eac3.mkv.

The "SDR" re-encodes kept PQ/BT.2020 tags (ffprobe shows `smpte2084`, `bt2020`), so the table does
not isolate HDR metadata on AV1. The H.264 SDR clip covers it: it fails with E-AC-3 and plays without it.

Baseline before any change: `pnpm test` gave `Test Files 42 passed (42)`, `Tests 497 passed (497)`.
I did not run the full e2e suite as a baseline. I ran the failing subset later against the unfixed
code (section 5).

## 2. Hypotheses

| ID  | Hypothesis                                                                                      | Evidence for                                                                                                                                                                                                                                                                                                 | Evidence against                                                                                                                          | Test / result                                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| H1  | The app's `canPlayType` pre-check rejects the file because its MIME type lists the E-AC-3 codec | `canPlaySource` (src/ui/compare.ts:12-15 before the fix) passes `containerMime`, which mediabunny builds from every track's decoder codec string (node_modules/mediabunny/dist/modules/src/matroska/matroska-demuxer.js:70-78, isobmff-demuxer.js:57-65); canPlayType(full) is "" only when `ec-3` is listed | none                                                                                                                                      | CONFIRMED: note appears for 4/4 E-AC-3 clips and 0/10 others; fixing the gate alone removes it |
| H2  | `<video>` cannot play the file (error event) because of E-AC-3 or MKV                           | user file is MKV + E-AC-3                                                                                                                                                                                                                                                                                    | a bare `<video>` plays the user file (loadeddata, 56 frames in 2 s, 0 dropped) in all three browsers; MKV without E-AC-3 plays in the app | RULED OUT: the error-event path never runs, the pre-check fires first                          |
| H3  | 4K resolution or AV1 decode performance                                                         | report says "4k"                                                                                                                                                                                                                                                                                             | 1080p and 4K AV1 without E-AC-3 play; 320x240 H.264 with E-AC-3 fails                                                                     | RULED OUT                                                                                      |
| H4  | 10-bit or HDR (PQ/BT.2020)                                                                      | file is 10-bit HDR                                                                                                                                                                                                                                                                                           | 10-bit PQ AV1 plays without E-AC-3; 8-bit SDR H.264 fails with it                                                                         | RULED OUT                                                                                      |
| H5  | MKV container (`video/x-matroska`) unsupported by Chromium canPlayType                          | MKV is not a web container                                                                                                                                                                                                                                                                                   | canPlayType(`video/x-matroska; codecs="av01..."`) is "probably" in Chromium 156; av1-noaud.mkv previews                                   | RULED OUT                                                                                      |
| H6  | Thumbnails fail for this file                                                                   | user's filmstrip looked empty                                                                                                                                                                                                                                                                                | 8 thumbnails render for the full file in 6.2 s (Chromium), 6.2 s (Chrome), 7.4 s (Brave), with the note shown or not                      | NOT REPRODUCED; see section 7                                                                  |
| H7  | The source check (`canDecode`) rejects the video                                                | none                                                                                                                                                                                                                                                                                                         | bug A B1; file info renders, `readSource` succeeds                                                                                        | RULED OUT                                                                                      |

## 3. Root cause chain

1. Trigger: the source carries an E-AC-3 audio track. Video codec, resolution, bit depth, HDR and container do not matter.
2. Data: `readSource` stores `containerMime` from mediabunny `Input.getMimeType()`, which lists the codec strings of all tracks: `video/x-matroska; codecs="av01.0.12M.10.0.110.09.16.09.0, ec-3"`.
3. Fault: `canPlaySource` (src/ui/compare.ts:12-15, old) asks `video.canPlayType()` about that full type. Chromium 156 on desktop Linux answers "" for any type that includes `ec-3` (bug A: Chromium builds AC-3/E-AC-3 only with `enable_platform_ac3_eac3_audio`).
4. Propagation: src/ui/prepareView.ts:171 sets `previewPlayable = false`. The prepare view then never mounts the preview host (prepareView.ts:328), hides the edit section, and disables the trim Set buttons.
5. Observed failure: the note "This browser cannot play the preview..." (prepareView.ts:80). The element itself would have played the video and ignored the audio track, as the bare-element probe showed.

This chain explains the preview symptom in full, and why the user saw it as a "4K" problem: their 4K
file is the one with E-AC-3. It does not explain the empty filmstrip (H6). The fix belongs at link 3.
The pre-check exists to catch video codecs the element cannot play, such as HEVC on Chromium
(comment at compare.ts:283-284). An audio codec in the list was never meant to trigger it.

## 4. Fix applied

Commit 9aa29d5 `fix: show the preview when only the audio codec is unplayable`.

- `src/core/types.ts`: `SourceInfo.video.codecString?: string | null`, optional like `hdr`.
- `src/core/source.ts`: fill it from `videoTrack.getCodecParameterString()` (mediabunny 1.62.0 API, `input-track.d.ts:455`).
- `src/ui/compare.ts:12-26`: `canPlaySource(video, source)` checks `<container>; codecs="<video codec>"` when the codec string is known, and the full MIME type otherwise. The QuickTime-to-MP4 mapping is unchanged.
- Callers: `src/ui/prepareView.ts:171` and `src/ui/compare.ts:285` pass the `SourceInfo`.

```diff
-export function canPlaySource(video: HTMLVideoElement, mime: string): boolean {
-  const playbackMime = mime.replace(/^video\/quicktime(?=\s*(?:;|$))/i, 'video/mp4');
+export function canPlaySource(
+  video: HTMLVideoElement,
+  source: { containerMime: string; video: { codecString?: string | null } | null },
+): boolean {
+  const mime = source.containerMime.replace(/^video\/quicktime(?=\s*(?:;|$))/i, 'video/mp4');
+  const videoCodec = source.video?.codecString;
+  const playbackMime = videoCodec
+    ? `${mime.split(';', 1)[0]!.trim()}; codecs="${videoCodec}"`
+    : mime;
   return video.canPlayType(playbackMime) !== '';
 }
```

The `error` listener (prepareView.ts:230) still catches a browser that rejects the file at load time.

Regression tests:

- `tests/unit/sync.test.ts`: "checks only the video codec, so unplayable audio does not block the preview". It failed on the old code with `AssertionError: expected false to be true`.
- `tests/unit/source.test.ts`: the mocks gain `getCodecParameterString`, and the first test asserts `codecString`.
- `e2e/trim.spec.ts:110`: "a source whose audio the browser cannot play still gets a video preview", with the new fixture `tests/fixtures/h264-eac3.mp4` (83 KB, generated, no user data). It failed on the old code (section 1).

Behaviour change: E-AC-3 sources now preview without sound in browsers that cannot decode the audio.
The Audio panel already reports "This browser cannot decode the audio in this video" (bug A).

## 5. Verification

Probe after the fix, same clips and settings as section 1:

| Browser             | user file (2:05.6)                  | orig-av1-eac3.mkv | av1-eac3.mp4 | h264-eac3.mkv | av1-noaud.mkv |
| ------------------- | ----------------------------------- | ----------------- | ------------ | ------------- | ------------- |
| Playwright Chromium | note hidden, video in DOM, 8 thumbs | same              | same         | same          | same          |
| Chrome 156          | same                                | same              | same         | same          | same          |
| Brave 156           | same                                | same              | same         | same          | same          |

Verbatim line for the user file in Playwright Chromium:
`app: ready=585ms noteShown=false videoInDom=true thumbs=8 thumbsAt=6809ms summary="303.2 MB · 3840x2160 · 30 fps · Constant frame rate · HDR · AV1 · 2:05.6"`.
Before the fix the same run printed `noteShown=true videoInDom=false`. Across the three browsers, the note
showed in 10/10 E-AC-3 runs before the fix and in 0/12 E-AC-3 runs after it.

Suites:

- Unit, baseline: `Test Files 42 passed (42)`, `Tests 497 passed (497)`. Final: `Test Files 42 passed (42)`, `Tests 498 passed (498)`.
- `pnpm lint` and `pnpm typecheck`: clean.
- New e2e test: passed in chromium and in webkit (3/3 runs with `--repeat-each=3`).
- Full e2e after the fix (`pnpm exec playwright test`, all projects): `8 failed`, `23 skipped`, `379 passed (7.4m)`. All 8 failures are WebKit-family projects (webkit, iphone, ipad), in cuts, live-preview, trim thumbnail density, phone filmstrip and audio tabs.
- Those 8 tests rerun on the unfixed code (src and unit tests stashed): `5 failed`, `6 passed`. On the fixed code: `4 failed`, `7 passed`. The same live-preview and phone-filmstrip tests fail on both. `cuts` and `audio.spec` passed in isolation, so they look load-dependent. I treat these as pre-existing WebKit flakiness, not a regression. No chromium test failed.
- Instrumentation: the temporary `e2e/zz-repro-4k.spec.ts` is deleted. The fix commit contains only the fix, its tests, the fixture and its `make-fixtures.sh` entry.

## 6. Sibling risks and related findings

| ID  | Severity       | Location                                            | Problem                                                                                                                                                                                                        | Proposed fix                                                                     |
| --- | -------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| S1  | HIGH (fixed)   | src/ui/compare.ts:285                               | The result view's Original side used the same full-MIME check, so it would hide the original of an E-AC-3 source                                                                                               | fixed by the same change                                                         |
| S2  | MED, SUSPECTED | src/core/source.ts (`containerMime`)                | Any extra track the element cannot play, such as a second audio track or an unusual codec, blocked the preview the same way, because mediabunny lists all tracks                                               | covered by the fix for the primary video path; not tested with multi-track files |
| S3  | MED, SUSPECTED | src/ui/prepareMedia.ts:28-37, src/ui/trimBar.ts:300 | Thumbnails decode in sequence and appear only when all of them finish. A long 4K AV1 file takes 6-7 s here, longer on slower CPUs, with an empty strip until then. This can explain the user's empty filmstrip | append each canvas as it decodes, or show a loading state (product/UX call)      |
| S4  | LOW            | src/ui/compare.ts:16                                | With `codecString` null (unknown), the check falls back to the full MIME type, so the old false negative remains for such sources                                                                              | none needed unless such files appear                                             |
| S5  | LOW, SUSPECTED | src/ui/previewAudio.ts                              | The preview routes element audio through WebAudio. For an E-AC-3 source the preview is silent. I did not check whether mix or processing controls say why                                                      | covered by bug A option A or a preview note                                      |
| S6  | LOW            | e2e WebKit projects                                 | 4-5 tests fail on the unfixed code under load (live-preview GIF, phone filmstrip)                                                                                                                              | separate flakiness investigation                                                 |

## 7. Not verified

- The user's exact browser build. Their screenshot shows only "Chromium-based". Chrome 156 and Brave 156 here behave the same as Playwright Chromium.
- Headed playback with GPU decode. All runs were headless under Playwright, which uses software AV1 decode (dav1d). 4K 10-bit played at 30 fps with 0 dropped frames over 2 s, but I did not measure long playback, seeking, or CPU load on the user's hardware.
- The empty filmstrip (H6, S3). Thumbnails rendered in every run. SUSPECTED cause, confidence LOW-MED: the screenshot was taken before the 6+ s thumbnail pass finished, or the user's machine decodes slower. A screenshot taken 15-30 s after load, or the console line "Could not render video thumbnails", would decide it.
- Chromium source for why the element plays a file with an unsupported audio track. This is observed behaviour in Chromium 156, Chrome 156 and Brave 156, not checked against the source. Firefox and Safari were not tested. Playwright WebKit passed the new e2e test.
- HDR metadata on AV1 in isolation (section 1 note). The H.264 SDR clip shows that HDR is not required for the failure.
- The full e2e suite before the fix. Only the failing subset was compared against the unfixed code.

No direction gate: the fix is a small in-codebase change with no new dependency or pipeline.
Bug A's audio paths (src/core/autoSettings.ts, src/ui/controllerSettings.ts) are untouched.
