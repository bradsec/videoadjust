# Blank 4K preview in real Chrome

Step 2 of the bug lifecycle, debug engineer. Branch `fix/preview-av-4k` from `dcf90fe` (v0.28.1).
Investigated 2026-11-01. Outcome: platform defect in Chrome on this machine (GPU compositing of
10-bit software-decoded video draws black frames). It is not a code defect in this app. The app now
detects the black picture and warns.

## 1. Symptom and minimal reproduction

Reported (verbatim): "I just tried playing the 4k test file the player is there by the video is blank
and no sound." After testing a local build of `25ef374` by hand (verbatim): "warning about no being
able to play sound, wav for sound was there, video player was there by played in black without
soudn." So the page stays alive, the waveform renders, time advances, and the picture is black.

Environment: Debian 13, kernel 6.12.113, GNOME on Wayland, Google Chrome 156.0.8078.79, Brave 156,
NVIDIA RTX 3090 driver 590.48.01 (Intel UHD 770 also present, Optimus). `chrome://gpu`: ANGLE on
OpenGL ES (NVIDIA), Ozone platform wayland, "Video Decode: Hardware accelerated" but the Video
Acceleration Information decoding list is empty, and the log says
`vaapi_wrapper.cc:130] Should skip nVidia device named: nvidia-drm`. All decode is therefore
software (dav1d, libvpx), which is why `--disable-accelerated-video-decode` changes nothing.

Minimal reproduction: any 10-bit (yuv420p10le) clip, 1080p is enough. The 4K and HDR parts of the
user's file are not required.

```
ffmpeg -f lavfi -i testsrc2=s=1920x1080:r=30:d=3 -pix_fmt yuv420p10le \
  -c:v libvpx-vp9 -profile:v 2 -deadline realtime -cpu-used 8 -b:v 4M vp9-1080-10b-sdr.webm
```

Probe (scratchpad `scripts/probe.mjs`, `scripts/matrix.sh`): headed Chrome through Playwright
(`channel: 'chrome'`, scratch profile), a bare `<video>` at the app origin, play 2 s, then
`drawImage` onto a 64x36 canvas. Verbatim:

```
vp9-1080-10b-pq.webm   t=2.006 rvfc=61 total=64 dropped=0 draw=mean=0.0 min=0 max=0 alpha>0=2304/2304
vp9-1080-10b-sdr.webm  t=2.004 rvfc=61 total=65 dropped=0 draw=mean=0.0 min=0 max=0 alpha>0=2304/2304
av1-1080-10b-sdr.mp4   t=2.003 rvfc=61 total=65 dropped=0 draw=mean=0.0 min=0 max=0 alpha>0=2304/2304
vp9-1080-8b-sdr.webm   t=2.007 rvfc=61 total=65 dropped=0 draw=mean=127.2 min=21 max=176 alpha>0=2304/2304
av1-2160-8b-sdr.mp4    t=1.962 rvfc=60 total=64 dropped=0 draw=mean=127.1 min=22 max=172 alpha>0=2304/2304
-- --disable-gpu
vp9-1080-10b-sdr.webm  t=2.006 rvfc=61 total=65 dropped=0 draw=mean=126.1 min=42 max=182 alpha>0=2304/2304
```

`readyState` 4, `currentTime` advances, `videoWidth` correct, `requestVideoFrameCallback` fires about
30 times a second, no dropped frames, and every pixel is black. For the user's file before play:
`readyState 4, videoWidth 3840, draw=mean=0.0 min=0 max=0`.

In the app the 4K source renders through the WebGL style canvas (`live-preview-style`, video
opacity 0) because the automatic output is smaller than the source (src/ui/livePreview.ts:406). That
canvas uploads the same black video frame, so it is black too. The app's paths add nothing: a bare
`<video>` shows the same black frames.

### Separate harness artifact: tab crash on 4K 10-bit

In my harness, playing a 3840x2160 10-bit clip on a bare `<video>` crashes the tab
(`page.waitForTimeout: Page crashed`). It happened through Playwright and through plain
`/usr/bin/google-chrome` driven over CDP, and in Brave. 2560x1440, 3200x1800 and 3840x1080 10-bit
did not crash; `--disable-gpu` and headless did not crash. The fixed app build with the user's file
did not crash under Playwright. The user's manual test did not crash. I did not find what makes the
harness crash; treat it as an artifact of the test setup, not the reported bug.

## 2. Hypotheses

| ID  | Hypothesis                                                                           | Evidence for                                                                                          | Evidence against                                                                             | Result                                             |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| H1  | Chrome's GPU compositing path draws 10-bit software-decoded frames black on this GPU | black at 1080p and 4K, AV1 and VP9, PQ and SDR; correct with `--disable-gpu`; matches upstream report | none                                                                                         | CONFIRMED on this machine                          |
| H2  | 4K resolution                                                                        | report says 4K                                                                                        | 1080p 10-bit is black; 4K 8-bit draws correctly                                              | RULED OUT (only the crash artifact is 4K-specific) |
| H3  | HDR (PQ/BT.2020) tags                                                                | file is HDR                                                                                           | 10-bit SDR (bt709 tags) is black; 8-bit PQ-tagged draws                                      | RULED OUT                                          |
| H4  | Codec or container (AV1, MKV)                                                        | file is AV1 MKV                                                                                       | VP9 WebM and AV1 MP4 10-bit are black; H.264 8-bit draws                                     | RULED OUT                                          |
| H5  | Hardware decode (VA-API) fault                                                       | NVIDIA + VA-API black-video reports exist                                                             | no hardware decode profiles; `--disable-accelerated-video-decode` changes nothing            | RULED OUT                                          |
| H6  | App defect in the WebGL style canvas or the 0.28.1 preview gate                      | the 4K preview renders through WebGL                                                                  | bare `<video>` is equally black; video frames reach `drawImage` black before any app drawing | RULED OUT                                          |
| H7  | Frames are not delivered (decoder stall)                                             | blank picture                                                                                         | rvfc fires, `totalVideoFrames` grows, 0 dropped                                              | RULED OUT                                          |
| H8  | `--ozone-platform=x11` avoids it (upstream report says so)                           | upstream report                                                                                       | not tested for black frames; in my harness x11 still crashed the 4K 10-bit tab               | UNVERIFIED                                         |

## 3. Root cause chain

1. Trigger: a 10-bit video track (here AV1 Main 10, yuv420p10le).
2. Platform: Chrome 156 on Linux/Wayland with an NVIDIA GPU decodes it in software, then hands the 16-bit-per-sample frames to GPU compositing.
3. Fault (outside this codebase): that path produces black frames. `--disable-gpu` (software compositing) draws correctly.
4. Propagation: `<video>` reports a healthy playback (frames presented, time advancing), and every consumer of the frame (the element on screen, `drawImage`, the app's WebGL style canvas) gets black.
5. Observed: player visible, waveform and time running, picture black. No sound is a separate, known cause: Chrome on Linux has no E-AC-3 in `<video>` (report 02).

Upstream: Google issue tracker 548711898, "[Linux][Wayland][NVIDIA] DRM video black with audio;
works with X11" (https://issuetracker.google.com/issues/548711898). I saw only a search-result
summary on 2026-11-01, not the page: it reports black frames for 10-bit AV1 and VP9 Profile 2
content, not 8-bit, fixed by `--disable-gpu`, with 720p test files. Related, not the same symptom:
Chromium 551668260, "Netflix video is black with audio on Linux with GPU acceleration since Chrome
151" (https://issues.chromium.org/issues/551668260). The fix belongs in Chromium. Nothing was filed.

## 4. Fix applied

No root fix is possible in the app. With the user's approval, the preview now warns. Commits `6d5514a` and `f2e5a8a` (e2e fix)
`fix: warn when the preview draws the video's picture black`, on top of `25ef374` (wip).

Review of the WIP in `25ef374` (cancelled earlier session): kept, with fixes.

- Fixed: the WIP e2e assertion that the sound notice is visible failed on WebKit
  (`Expected: visible`, `Received: hidden`), because Playwright WebKit on Linux reports E-AC-3 as
  playable, so the app correctly hides the notice there. The test now expects the notice exactly when
  `canPlayType('video/mp4; codecs="ec-3"')` is "".
- Kept: the notice element structure, the 5 s no-frame timeout (covers a browser that presents no
  frame at all), the e2e test for it, and the sound notice wording.
- Fixed: the timeout cannot catch this bug, since frames are presented. Added black-frame detection.
- Fixed: the sound condition asked `canPlayType` about the raw `video/quicktime` type, which Chromium
  answers "" for, so a MOV with playable audio would have claimed "no sound". It now uses the same
  QuickTime-to-MP4 mapping as the preview gate (`playbackContainerMime`, src/ui/compare.ts).

Detection (src/ui/previewNotices.ts, `createPictureCheck`): on each presented frame (rvfc), sample
the `<video>` at 32x18 with `drawImage`. If its brightest channel is below 16 (or the sample is
transparent), decode the frame at the same media time with Mediabunny `CanvasSink.getCanvas`
(`decodedFrameAt`, src/ui/prepareMedia.ts) and sample it too. Count a strike only when the decoded
frame is not black. Two strikes at positions at least 0.5 s of media time apart show the warning. A
non-black video sample, or 6 checks, ends the check. A black or fading-in source is never flagged
because its decoded frame is black too. I chose this over the resolution and bit-depth rule because
the bug is not 4K-specific (1080p 10-bit is black), and a format rule would warn wrongly on
machines where 10-bit renders.

The sound notice stays a separate exported condition, `previewSoundUnavailable`, so the
preview-sound feature can drop the E-AC-3 case later.

Regression test: `tests/unit/previewNotices.test.ts` (8 tests, stubbed pixel sources). Against the
WIP version it fails: `TypeError: peakLevel is not a function` (8 failed). With the fix: 8 passed.
CI cannot reproduce the GPU fault, so there is no e2e test of the black path.

## 5. Verification

Real Chrome 156, headed, Playwright `channel: 'chrome'`, local `pnpm build` + `pnpm preview` of the
fix, app page, play 4 s. User file:

```
loaded+25ms t= 0 rvfc= 0 notes= ['note preview-audio-note: Preview has no sound: this browser cannot play the audio. Export converts it.']
after play t= 4.045 rvfc= 117 notes= [... 'Preview has no sound: ...', "note preview-picture-note: This browser cannot show this video's picture. Export still works."]
```

Controls, same build:

```
av1-2160-8b-sdr.mp4   picture-note= False
av1-2160-10b-sdr.mp4  picture-note= True
vp9-1080-10b-pq.webm  picture-note= True
```

Before the fix the picture warning did not exist; in 25ef374 the user saw only the sound warning.

CI=1 suite. Baseline at `dcf90fe`: `Test Files 42 passed (42)`, `Tests 510 passed (510)`. Final:

```
Test Files  43 passed (43)
     Tests  518 passed (518)
ESLint: No issues found
All matched files use Prettier code style!
check:remote ok: no URL outside the allowlist in 15 built files
```

`pnpm typecheck`: no errors. Playwright chromium: `7 skipped`, `173 passed (42.5s)`.

WebKit family, CI=1, one project at a time, final code:

```
webkit:  1 failed  [webkit] › e2e/live-preview.spec.ts:223:3 › GIF previews edits live and can show the original @mobile
         9 skipped, 170 passed (3.8m)
iphone:  2 skipped, 32 passed (43.3s)
ipad:    5 skipped, 29 passed (40.0s)
```

The first webkit run (before the e2e fix in this commit series) also failed
`e2e/trim.spec.ts:110` with `Expected: visible`, `Received: hidden` on the sound notice; section 4
explains and fixes it. After the fix, that test and the no-frame test pass on webkit and chromium.

`live-preview.spec.ts:223` (GIF previews edits live) is the known local-only failure. On `dcf90fe`
with `--repeat-each=3` it failed 2 of 3 on webkit and 1 of 3 on ipad
(`Error: expect(locator).toBeVisible() failed`, `Error: locator.evaluate: Target crashed`). On the
fix it failed 1 of 3 on webkit and 1 of 3 on ipad. It is intermittent locally on both, so it is
pre-existing and unrelated. In the full ipad run above it passed.

## 6. Sibling risks

| ID  | SEVERITY | file:line                        | problem                                                                                                                                                    | proposed fix                                                     |
| --- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| S1  | MED      | src/ui/compare.ts (compare view) | the result comparison plays the original and the export in `<video>`; a 10-bit original or export is black there too, with no warning (SUSPECTED, not run) | reuse `createPictureCheck` for the comparison videos             |
| S2  | LOW      | src/ui/livePreview.ts:206        | the WebGL style canvas uploads the black frame, so style previews are black for 10-bit sources                                                             | covered by the same warning; the WebCodecs option below fixes it |
| S3  | LOW      | src/ui/previewNotices.ts         | the 5 s no-frame timeout could fire on a very slow seek in a long remote-backed file (not seen in tests)                                                   | lengthen or drop the timeout if a false warning is reported      |

## 7. Direction gate and not verified

Direction gate (product decision, not built): render the preview picture from Mediabunny/WebCodecs
frames drawn to a canvas instead of `<video>`. WebCodecs-decoded thumbnails render correctly on this
machine. Options: (a) keep the warning only (this change); (b) on a detected black picture, switch
the preview to a WebCodecs canvas renderer synced to an audio clock, which also suits the coming
preview-sound feature; (c) a reduced-resolution 8-bit proxy decoded and re-encoded in the app, which
is slow for long 4K files.

Not verified:

- On-screen pixels. I measured `drawImage` and the app's canvas, not the screen. The user's report
  confirms a black screen for the 4K file only; 1080p 10-bit on screen is inferred.
- Other GPUs, X11 sessions, other Chrome versions, macOS, Windows.
- The upstream report's content beyond the search summary.
- Why the harness tab crashes on 4K 10-bit (section 1).
- The warning in the user's own Chrome profile; the user will re-test by hand.
