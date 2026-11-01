# Tab crash with the decoded preview fallback

Step 2 of the bug lifecycle, debug engineer. Branch `fix/preview-av-4k`, HEAD `ec711ee`. Investigated
2026-11-01. Outcome: NOT REPRODUCED in a representative harness, root cause NOT PROVEN, no fix
applied. A diagnostic build is ready for the user's manual bisection (section 7).

## 1. Symptom and reproduction

Reported (verbatim), the user's own Chrome 156 profile:

- local build of `ec711ee` at http://127.0.0.1:4180: "I tried the http://127.0.0.1:4180/ and 4k and
  chrome just crashed with the Aw Snap message". Re-test: "I did test it crashes" (deterministic).
- deployed 0.28.1: "plays by player is blank and no sound". No crash.
- `25ef374` (detector and warnings, no fallback): black, no crash.

Expected: the fallback shows the decoded picture. Actual: renderer crash ("Aw Snap").

Environment: Debian 13, kernel 6.12.113, GNOME Wayland, NVIDIA RTX 3090 (`/dev/dri/renderD129`,
PCI 01:00.0) plus Intel UHD 770 (`renderD128`), 64 GB RAM, 24 threads. The user's `chrome://version`
(shared through the lead): Google Chrome 156.0.8078.79, command line
`/usr/bin/google-chrome-stable --ozone-platform=wayland --flag-switches-begin --enable-webgl-developer-extensions --enable-webgl-draft-extensions --enable-features=CanvasDrawElement --flag-switches-end --origin-trial-disabled-features=CanvasTextNg|WebAssemblyCustomDescriptors --render-node-override=/dev/dri/renderD129`,
plus command-line variations (truncated, not read). `journalctl -k` for 2026-11-01 has no OOM or
NVIDIA Xid lines.

Unit baseline at `ec711ee`, CI=1: `Test Files  43 passed (43)`, `Tests  525 passed (525)`.

### Harness attempts

Harness: scratchpad `crash/bare.mjs` (Playwright 1.64.1, `executablePath: /usr/bin/google-chrome-stable`,
headed, scratch profile, `IGNORE=ALL` sets `ignoreDefaultArgs: true`). With `ignoreDefaultArgs: true`
every Playwright default arg is removed (among them `--disable-field-trial-config`,
`--disable-background-networking`, `--disable-breakpad`, `--disable-features=...`,
`--enable-automation`, `--no-sandbox` where set, `--disable-dev-shm-usage`,
`--force-color-profile=srgb`). The harness adds back only `--user-data-dir`, `--remote-debugging-pipe`,
`--no-first-run`, `--no-default-browser-check` and `about:blank`, then the user's flags above.

Bare `<video>` of the user's 4K file, user flags, verbatim (3 of 3 runs):

```
gpu --render-node-override=/dev/dri/renderD129 --enable-features=CanvasDrawElement
1s n/a gpu:280M rend:106M rend:110M rend:155M rend:83M
CRASHED after 1.0s
```

The user's real profile does not crash on a bare `<video>` (0.28.1), so this harness is still not
representative. The remaining difference is the variations seed, which was not read. Default
Playwright args, Chrome's own render-node choice (fresh profiles already get `renderD129`) and the
user's command-line flags are ruled out as the difference. The renderer died at 155 MB RSS, so the
harness crash is not memory exhaustion. Crashpad wrote no dump to the scratch profile.

The only harness that survives the file is `--disable-gpu-memory-buffer-video-frames` (report 08: it
also makes the `<video>` draw correctly). That bypasses the GpuMemoryBuffer path that the user's
profile takes, so in it the fallback is forced on with the e2e hook (`drawImage(video)` paints black).
It measures memory and decoder cost, but it cannot show the user's crash.

## 2. Measurements (non-representative harness, no-GMB, user flags)

Renderer RSS of the app tab, sampled each second by `ps`, user's file, playing:

| Build and mode                                 | Renderer RSS                              | Result        |
| ---------------------------------------------- | ----------------------------------------- | ------------- |
| bare `<video>`                                 | 930 MB at 8 s                             | survived 8 s  |
| 0.28.1 (`dcf90fe`)                             | 1130 to 1187 MB, flat                     | survived 20 s |
| 0.28.1, forced black                           | 1145 to 1171 MB, flat                     | survived 20 s |
| `ec711ee`, fallback inactive                   | 1598 to 1652 MB, flat                     | survived 20 s |
| `ec711ee`, forced black, fallback shown        | peak 2556 MB at 3 s, then 1843 to 1986 MB | survived 30 s |
| diag build `?diag=off` (fallback never starts) | 1146 MB                                   | survived 8 s  |
| diag build `?diag=noaudio`, fallback shown     | 1909 MB                                   | survived 8 s  |
| diag build `?diag=unload`, fallback shown      | 403 MB after unload                       | survived 8 s  |

Verbatim, `ec711ee` forced black (excerpt):

```
2s t=2.1 paused=false dec=shown gpu:471M ... rend:2425M
3s t=3.1 paused=false dec=shown gpu:473M ... rend:2556M
30s t=30.5 paused=false dec=shown gpu:486M ... rend:1969M
SURVIVED
```

Readings: the fallback's second decode adds about 300 MB on top of the inactive `ec711ee`; the
decoded E-AC-3 path is not the cost (noaudio is the same 1.9 GB). Unloading the `<video>` drops the
renderer to 403 MB. Memory stays flat for 30 s: no leak of `VideoFrame`, `VideoSample` or audio
buffers at this time scale. Two 4K decoders run together without a crash in this harness.

The user watched the last forced-black `ec711ee` run (http://127.0.0.1:4180/, user flags plus
`--disable-gpu-memory-buffer-video-frames`, forced-black init script; a control, not a fix) and
said verbatim: "that last test worked". This matches the measured survival; it does not exercise
the user's GMB path.

## 3. Hypotheses

| ID  | Hypothesis                                                                                                        | Evidence for                                                                                                         | Evidence against                                                                                          | Test to decide                           | Status                                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| H1  | Two concurrent 4K 10-bit decodes (`<video>` clock plus `CanvasSink`) exceed a renderer memory limit               | crash is new with the fallback; fallback adds 300 MB, peak 2.5 GB                                                    | peak 2.5 GB survives 30 s; host has 47 GB free; RSS is flat                                               | user runs `?diag=unload`                 | SUSPECTED, LOW                            |
| H2  | The second decode (or its load) pushes the GMB video path into the same fault that crashes fresh profiles at once | fresh profiles crash on the GMB path for this file within 1 s; the user's profile sits near that path (black frames) | not observable: no harness takes the GMB path without crashing                                            | user runs `?diag=unload` and `?diag=off` | SUSPECTED, MED                            |
| H3  | Leak of unclosed `VideoFrame`/`VideoSample`                                                                       | WebCodecs frames are a common leak                                                                                   | RSS flat 30 s with fallback shown                                                                         | longer run in user profile (diag ticks)  | RULED OUT in harness, 30 s                |
| H4  | `CanvasSink` at full resolution                                                                                   | 4K canvases are large                                                                                                | sink width is capped at 1280 (src/ui/decodedPreview.ts:77)                                                | read code                                | RULED OUT                                 |
| H5  | `AudioBufferSink` holds the whole track                                                                           | audio decode is new                                                                                                  | iterator waits until 0.5 s ahead (src/ui/previewAudio.ts:255, `startDecoded`); noaudio costs the same RSS | `?diag=noaudio` in user profile          | RULED OUT for memory; crash role UNTESTED |
| H6  | E-AC-3 wasm decoder or `createMediaElementSource(video)` crashes the renderer                                     | both are new in `ec711ee` and run for this file even when the picture fallback is inactive                           | no crash in harness with either                                                                           | user runs `?diag=off`                    | SUSPECTED, LOW                            |

## 4. Root cause

Not established. What is known:

1. Trigger: the user's 4K AV1 10-bit file with E-AC-3 in the user's Chrome profile.
2. `ec711ee` adds, for this file, a picture fallback (a second AV1 decode via `CanvasSink`, drawn to
   a 2D canvas and the WebGL style canvas) and a decoded E-AC-3 sound path (`AudioBufferSink`,
   Web Audio, `createMediaElementSource(video)`).
3. Observed: the renderer crashes in the user's profile. Which of the two additions triggers it, and
   when (before play, at fallback start, or later), is not observed.

The leading hypothesis (H1/H2: two decoders) stays SUSPECTED. It is not shown by memory pressure in
the measurable harness.

## 5. Fix

None applied. Two reasons: the cause is not observed, and the proposed fix is a redesign.

The `<video>` is the clock for every preview consumer: `previewControls.ts` (play, scrub, time),
`previewAudio.ts` (all scheduling reads `video.currentTime`, `paused`, `playbackRate` and its events),
`livePreview.ts` (rvfc scheduling, cut skipping), the trim bar and keyboard handlers in
`prepareView.ts`. Chrome 156 has no default way to keep the clock and stop only the picture decode
(`videoTracks` needs a flag). Options, if `?diag=unload` stops the crash:

- A. When the fallback starts, unload the `<video>` and drive the preview from a small clock object
  (`currentTime`, `paused`, `play`, `pause`, events) backed by `AudioContext.currentTime`. Every
  consumer above must use that clock instead of the element. Largest change, one 4K decoder.
- B. Same as A, but feed the `<video>` an audio-only source remuxed with Mediabunny (no video
  track), so it stays the clock. Remuxing a large file on load costs time and memory, and E-AC-3
  still needs the decoded path in Chrome.
- C. Remove the picture fallback and keep the warning from `6d5514a` (report 07 option a). Removes
  code; the user loses the picture on this machine again.

If `?diag=off` still crashes, the fallback picture is not the cause and the decoded sound path is
next (`?diag=noaudio`).

## 6. Sibling risks

| ID  | SEVERITY | file:line                                   | problem                                                                                                                                                                             | proposed fix                               |
| --- | -------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| S1  | LOW      | src/ui/decodedPreview.ts:49                 | the play loop waits on `requestAnimationFrame` per frame; in a hidden tab rAF stops, so the decoder iterator stays open and paused                                                  | none until shown to matter                 |
| S2  | LOW      | src/ui/livePreview.ts:216 and scheduleStyle | with the fallback ready, `drawStyle` runs from both the decoded `onFrame` and the `<video>` rvfc, so the WebGL style canvas uploads up to twice per frame (SUSPECTED, not measured) | skip rvfc scheduling while `decoded.ready` |

## 7. Manual test handoff and left to do

`dist-manual` now holds a diagnostic build of `ec711ee` plus a temporary, uncommitted patch
(scratchpad `crash/diag.patch`, 16 lines in 4 files plus `src/diag.ts`). Without a query it behaves
like `ec711ee`. Each page load records markers in `localStorage` (`videoadjust-diag`, last 6 runs):
load, `fallback requested`, `fallback start`, `first decoded paint`, `decoded audio start`,
`video unloaded`, and a 1 s tick with `currentTime`, `paused`, decoded canvas state and JS heap. With
`?diag=...` in the URL, a box at the bottom right lists the previous runs, so after an "Aw Snap",
reload and read the last run.

Ask the user to open the 4K file and press Play, once per URL, and report crash or no crash plus the
last lines of the previous run:

1. http://127.0.0.1:4180/?diag=off — fallback never starts (sound path still decoded).
2. http://127.0.0.1:4180/?diag=noaudio — fallback on, decoded sound off.
3. http://127.0.0.1:4180/?diag=unload — fallback on; the `<video>` is paused and unloaded at
   fallback start, so only one 4K decoder runs. Playback stops on a still frame by design.
4. http://127.0.0.1:4180/?diag=none — same as `ec711ee`, with markers.

Decision table: 3 survives and 4 crashes, H1/H2 hold, so choose option A, B or C. 1 crashes, the cause
is in the sound path or elsewhere: re-run with `?diag=off,noaudio`. 2 survives and 4 crashes, the
decoded sound path is the cause.

Not verified:

- The crash itself: no harness reproduced the user's profile. The variations seed was not read.
- Any build in the user's profile after `ec711ee`.
- Memory beyond 30 s, and GPU memory (not sampled).
- Playwright suites: no code changed on the branch, so they were not run (unit baseline only).
