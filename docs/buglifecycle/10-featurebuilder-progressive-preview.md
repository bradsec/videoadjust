# 10. Featurebuilder: progressive preview copy, centred status, opt-in comparison

Branch `feat/preview-proxy`, 2026-11-01. Stopped early at a usage limit; see Left to do.

## 1. Spec read and assumptions

Building: a preview copy that plays while it converts (R1), a centred preparing/buffering
status (R2) and a result screen without comparison for heavy sources (R3), for users with 4K,
HDR or Dolby files. Done means playback starts within seconds and the result plays smoothly.

- Quota: chose "remove played content older than currentTime - 10 s, retry once". On a second
  failure the queue stops and the finished copy replaces the stream as a whole Blob.
- Playback start: `play()` runs once 2 s is buffered; if the browser refuses autoplay, the
  video waits for Play.
- The result screen gets the finished copy as a Blob URL, not the MediaSource URL, so Compare
  and Start over work as before.
- Cancel and Use original stay below the stage; only the status text moved into the stage.

## 2. Spec coverage

| Requirement                                                                                                                                                      | Commit                 | Test                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| R1: fragmented MP4 to MSE, serial append queue, 2 s start, endOfStream, Blob path for VP9 or no MSE, quota trim and retry, Cancel/Use original detach and revoke | 39f3ffa                | tests/unit/previewStream.test.ts (4 cases); e2e/trim.spec.ts "streamed preview copy plays before it is done"                         |
| R2: centred status, role=status, aria-live=polite, Buffering…                                                                                                    | 39f3ffa                | same e2e: centre within 2 px of the stage centre, attributes                                                                         |
| R3: comparison off above 1920 long edge or with a copy; Compare with original                                                                                    | f6d3b59                | tests/unit/compare.test.ts (3); e2e/result.spec.ts "a 4K source starts with the new video alone"; e2e/trim.spec.ts proxy export test |
| Defaults: 4K 5.1 gives 1920x1080 stereo                                                                                                                          | a3074fd                | tests/unit/autoSettings.test.ts; passed with no code change                                                                          |
| HDR default export is SDR                                                                                                                                        | none, no change needed | measured only (section 4); no automated assertion yet                                                                                |

## 3. Design decisions

- `previewStreamType` and an optional `onData` on `makePreviewProxy` (src/core/previewProxy.ts) reuse `startConversion`; only the target and format change.
- `createAppendQueue` (src/ui/previewStream.ts) holds the append, quota and error rules, so they are unit-tested without a browser.
- The status overlay reuses the `.live-preview-label` pill look (src/styles/workspace.css).
- `mountCompare` gained `compareOff`; the new-video-alone layout is the existing unplayable-original layout, split into `hideOriginal` and `showOriginal`.
- `compareByDefault` reuses `LONG_EDGE_CAP` from autoSettings.
- wip commit cd94bf9: kept the fixture `long-eac3.mp4` and its make-fixtures line; rewrote the unit test (typed fake, two more cases) and the e2e test (Chromium-only skip, tighter centring, Cancel still visible as proof the copy was unfinished). Folded into 39f3ffa.

## 4. Verification evidence

- Unit: 46 files, 538 tests passed at f6d3b59 plus the defaults test.
- lint, typecheck, format:check: passed before 39f3ffa and f6d3b59.
- Playwright chromium, e2e/trim.spec.ts and e2e/result.spec.ts: 39 passed at 39f3ffa; trim with R3 50 passed (repeat-each 2); result 15 passed.
- First play on the user's 4K AV1 10-bit PQ file, headed Chrome with report 09 flags: `FIRST_PLAY_MS=3747` from file pick (includes probing and thumbnails); status before play "Preparing preview 3%". The copy finished after 48.3 s with playback still running (currentTime 44.5 s), no crash.
- HDR default export of an 8.2 s clip cut from the user's file: the export and the preview copy both probe as `h264 High yuvj420p, color_range=pc, color_space=bt709, color_primaries=bt709, color_transfer=iec61966-2-1`, so 8-bit SDR, not PQ or HLG. Mean luma of an exported frame is 88.5, against 105.3 for an ffmpeg zscale + hable reference; side by side, the export shows normal SDR colours, slightly darker and more saturated than hable, not washed out. No code change.

## 5. Out of scope and adjacent problems

- SUSPECTED: Use original sets the original as `video.src` while the cancelled conversion may still be decoding (from 5344cf2; report 09 rule).
- The SDR export is tagged sRGB transfer and full range, not BT.709 transfer and limited range; some players may show slightly different contrast. Not changed.
- Net src change for this step: +349 / -44 lines.

## Left to do

- Full runs with CI=1: `pnpm build`, Playwright chromium (full), webkit, iphone and ipad, one at a time.
- An automated assertion for the default output colour metadata.
- Self-review pass on the final diff.
