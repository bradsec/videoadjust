# Decoded preview fallback and E-AC-3 preview sound

Step 4 of the bug lifecycle, feature builder. Branch `fix/preview-av-4k`, continuing the Codex WIP
`28f5d52`. Stopped early on 2026-11-01 because the weekly usage limit was close. This report is a
handover: read "Left to do" first.

User constraints (verbatim): "keep solution simple we don't want to over complicate code". About the
last headed run they watched (WIP build, 4K file): "that last test was choppy".

## 1. Spec read and assumptions

Building: a Mediabunny-decoded preview picture and Web Audio preview sound for sources whose `<video>`
picture is black (Chrome 156, Linux, Wayland, NVIDIA, 10-bit) or whose audio `<video>` cannot play
(E-AC-3), for users of the prepare view. Done means: the picture and sound play with working
controls, and "Preview has no sound" shows only when neither path has sound.

Assumption: 10-bit dark footage on the broken machine may switch to the decoded picture, since its
picture really is missing there. The false-positive control is 8-bit dark footage, where the
`<video>` draws correctly.

## 2. Commits

| Commit    | Content                                                                                    | State                             |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `28f5d52` | Codex WIP: decoded picture fallback, decoded E-AC-3 sound, controls extracted              | not verified on WebKit by Codex   |
| `419808b` | fix: detection by margin to the decoded frame (src/ui/previewNotices.ts, 5 new unit tests) | green: unit, lint, typecheck      |
| `4808c1e` | wip: sequential decode in the fallback (src/ui/decodedPreview.ts)                          | unit/typecheck green; e2e not run |

Net `src/` change against `6b26520`: 8 files, +361 / -78.

## 3. Findings

### P1, automatic activation

Measured with an init script that logs each 32x18 sample the detector takes (scratchpad
`scripts/p1.mjs`). The detector samples the `<video>` element itself (`preview-video`, 3840x2160,
`readyState` 4, CSS opacity 0 under the WebGL style canvas) inside `requestVideoFrameCallback`, at
32x18 through `drawImage`. It does not read the app's WebGL canvas. It then decodes the same media time
through a 32x18 `CanvasSink`. A WIP run that worked, verbatim:

```
@1.30s 32x18 <- video preview-video 3840x2160 t=0.083 rs=4 op=0 peak=0 min=0 mean=0.0
@1.43s 32x18 <- HTMLCanvasElement 32x18 peak=0 min=0 mean=0.0
@1.81s 32x18 <- video preview-video 3840x2160 t=0.594 rs=4 op=0 peak=0 min=0 mean=0.0
@2.03s 32x18 <- HTMLCanvasElement 32x18 peak=33 min=0 mean=0.4
@2.31s 32x18 <- video preview-video 3840x2160 t=1.094 rs=4 op=0 peak=0 min=0 mean=0.0
@2.53s 32x18 <- HTMLCanvasElement 32x18 peak=143 min=0 mean=2.1
```

Cause of the unreliability (evidence: these logs plus the flag test below):

1. The user's file opens on a fade from black. Decoded peaks at t=0.07/0.6/1.1 s were 0/33/143.
   With a fixed black level of 16 and at most 6 checks, the outcome depended on where the samples
   fell in the fade.
2. A single "video looks fine" sample ended the check for good. Chrome on this machine draws an
   occasional frame correctly: with `--disable-gpu-memory-buffer-video-frames` every frame draws
   correctly (`mean=14.2 max=117`, no crash, 2 of 2 runs), so the fault is in the GpuMemoryBuffer
   path for software-decoded 10-bit frames. A frame that misses that path shows its true dim intro
   level. That explains the observed 17 (SUSPECTED: that 17 sample itself was not reproduced).

Change (`419808b`): a check counts a strike when the decoded frame's peak exceeds the video
sample's peak by 32 or more (8-bit). Video samples at 48 or above skip the decode and count as a
clean check. A correct-looking frame no longer ends the check, and the check now runs for 10
positions 0.5 s apart (about 5 s), long enough for the dark opening. There is still no fixed black level.

Natural-run proof: NOT DONE. In this session, fresh-profile Chrome 156 crashes the tab 1 to 2 s
after native playback of the user's file starts: 25 of 25 runs on the new build, 3 of 3 on the WIP
build. That is before the decision point. It also crashed with a bare `<video>` and no app code
(3 of 3), and in plain `/usr/bin/google-chrome` with no automation (the page's interval logger never
reported). Early in the session, 3 runs survived past 2 s and all 3 activated at about 2.0 s. The
crash is report 07's harness artifact. It is not caused by the app, and the user's own Chrome does not crash. Playwright
default args are ruled out as the cause: removing `--disable-dev-shm-usage`, `--force-color-profile=srgb`
or `--no-sandbox`, or every default arg, still crashed.

### P2, WebKit "source-load failures"

Not reproduced. Full `--project=webkit` on `28f5d52`, CI=1, two runs:

```
run 1: 3 failed  live-preview.spec.ts:223, settings.spec.ts:17, theater.spec.ts:199 (locator.check timeout 90000ms)
       11 skipped, 168 passed (4.5m)
run 2: 1 failed  [webkit] › e2e/live-preview.spec.ts:223:3 › GIF previews edits live and can show the original @mobile
       11 skipped, 170 passed (3.8m)
```

`settings.spec.ts:17` and `theater.spec.ts:199` passed on rerun (`2 passed (5.9s)`), so run 1's
extra failures were flaky. `VideoDecoder.isConfigSupported` in Playwright WebKit on this host returned
`supported: true` for `avc1.42E01E`, `avc1.64001f`, `vp8` and `vp09.00.10.08`. The decodable-video gate
that rejects a source (src/core/source.ts:115) dates from `8d2e67c`, before the WIP. The WIP does not add a
new dependency on WebCodecs for loading. The fallback does not activate in WebKit on
`long-31s.mp4` (video sample peak 128). Most likely the earlier session's failures came from host
load (SUSPECTED). iphone and ipad were not run.

### P3, fallback frame rate

Benchmark in headed real Chrome, user's file, starting at 10 s (scratchpad `bench/index.html`,
`scripts/bench.mjs`), verbatim:

```
random width=844 frames=8 total=2446ms perFrame=305.8ms fps=3.3 drawPerFrame=0.02ms
seq width=844 frames=120 total=1289ms perFrame=10.7ms fps=93.1 drawPerFrame=0.04ms
seq width=full frames=60 total=827ms perFrame=13.8ms fps=72.5 drawPerFrame=0.06ms
samples width=full frames=120 total=650ms perFrame=5.4ms fps=184.6 drawPerFrame=0.00ms
```

Where the time goes: the WIP called `CanvasSink.getCanvas(t)` for each frame. Mediabunny 1.62.1 serves
each such call with a new decode run from the preceding key frame
(node_modules/mediabunny/dist/modules/src/media-sink.js:1456, `getSample` via
`mediaSamplesAtTimestamps([timestamp])`), which costs 306 ms a frame. Decode alone runs at 5.4 ms a frame,
scaling to 844 px adds about 5 ms, and the draw takes 0.04 ms. Software AV1 decode is not the floor.
Before: 1.5 fps (Codex, user-visible), 3.3 fps in the benchmark. Expected after: up to the source
rate (93 fps of headroom). The in-app after-fps was NOT MEASURED because of the crash above.

Change (`4808c1e`): during playback, iterate `sink.canvases(currentTime)` in order, skip frames that
end before the clock, and wait on `requestAnimationFrame` until each frame is due. Paused and seeked
states use `getCanvas` once. Play, pause and seeked restart the loop. The decoder output stays at
preview width, capped at 1280 (unchanged). `poolSize: 1`.

## 4. Self-review of the WIP (complexity)

| ID  | SEV | file:line                  | finding                                                                                                                                   | action                     |
| --- | --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| R1  | LOW | src/ui/previewControls.ts  | extraction looked unneeded; inlining it back makes livePreview.ts 533 lines, so ESLint `max-lines` (500) fails                            | kept, as the WIP had it    |
| R2  | MED | src/ui/decodedPreview.ts   | per-frame `getCanvas` caused the 1.5 fps                                                                                                  | fixed in `4808c1e`         |
| R3  | LOW | src/ui/previewAudio.ts     | each decoded buffer's start is computed from fresh clock reads, so small gaps or overlaps (clicks) are possible (SUSPECTED, not measured) | not changed; measure first |
| R4  | LOW | src/core/frameExport.ts:58 | "Save frame" still reads the `<video>`, so it may save black in fallback (SUSPECTED, out of spec)                                         | reported only              |

## 5. Checks at `4808c1e`

```
Test Files  43 passed (43)
     Tests  525 passed (525)
ESLint: No issues found
All matched files use Prettier code style!
```

`pnpm typecheck`: no errors. Not run at `4808c1e`: `pnpm build`, Playwright chromium/webkit/iphone/
ipad, real-Chrome audio.

## 6. Left to do

1. Run Playwright CI=1 one project at a time at `4808c1e`: chromium, webkit, iphone, ipad. The
   forced-black test is `e2e/trim.spec.ts:156`. If it is green, reword `4808c1e` (or add a commit)
   so that no `wip:` commit stays at the tip.
2. P1 proof: find a harness that survives native playback of the user's file. Leads: the user's
   Chrome GPU process runs with `--render-node-override=/dev/dri/renderD129` and
   `--enable-features=CanvasDrawElement`, plus a variations seed; fresh profiles have none of these. Otherwise, ask the
   user to run the build by hand five times. As a content proxy that does not crash,
   use the 1080p 10-bit excerpt with the same fade-in at scratchpad
   `clips/user/user-1080-10b-20s.webm` (made from the first 20 s; not in the repo). Controls still
   to run: `clips/syn/av1-2160-8b-sdr.mp4`, `vp9-1080-8b-sdr.webm` (8-bit, must not activate),
   `vp9-1080-10b-sdr.webm` (10-bit, must activate), `clips/syn/dark-1080-8b.webm` (8-bit dark,
   peak 41, must not activate) and `dark-1080-10b.webm`. Probe: `scripts/p1.mjs <file> 20` with
   `URL=` pointing at a `vite preview --outDir` build. It prints `activatedAt`, the samples
   (`SAMPLES=1`) and `fpsLast10s`.
3. P3: measure in-app fps after `4808c1e` (the `paints=... fpsLast10s=` line of `p1.mjs`), and compare
   it with the WIP's 1.5 fps. Ask the user whether playback is still choppy.
4. P2: run iphone and ipad. For every WebKit failure other than `live-preview.spec.ts:223`, compare with
   `6b26520` in a scratch worktree.
5. Real-Chrome E-AC-3 sound check (analyser peak), then R3 only if clicks are heard.
6. CHANGELOG Unreleased and the README (lines 24 and 41 of the WIP) describe the fallback and the sound.
   They do not yet mention that a dark opening delays the switch by up to about 5 s. Recheck both
   after items 1 to 3.
7. Run `pnpm build` (includes check:licenses and check:remote).
8. Do not use port 4173. Ports 4401 to 4404 were used for scratch servers and are stopped.
