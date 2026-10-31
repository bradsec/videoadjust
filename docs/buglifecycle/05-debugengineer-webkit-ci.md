# Debug report: WebKit e2e exports fail on main after v0.28.0

Step 2 of the bug lifecycle, debug engineer. Investigated 2026-11-01 on branch `fix/webkit-ci-exports` from
`main` at 706496f. Outcome: root cause found and proven; the direction gate applies, so no fix is applied.

## 0. Capture

- Worktree clean at start. Branch `fix/webkit-ci-exports` created from 706496f; no code changes on it.
- Symptom (CI run 41231773447, push 08cfba8..706496f): 21 WebKit-family tests (webkit, iphone, ipad) time out
  waiting for the result screen. Chromium passes. Example: `[webkit] › e2e/result.spec.ts:106:1`,
  `Locator: locator('.verdict .figure')`, `Timeout: 60000ms`, `Error: element(s) not found`.
- The CI page snapshots show the app's `The export failed` alert. The CI traces carry the real error, the same in
  every failed UI test:
  `export failed Error: Timestamps cannot be smaller than the largest timestamp of the previous GOP (a GOP begins with a key packet and ends right before the next key packet). Got 2.996s, but largest timestamp is 3.017333333333333s.`
  `convert.spec.ts:200` (m4a) fails with the same text directly.
- Expected: AAC re-encoded exports complete on WebKit, as on 08cfba8. Actual: every export that re-encodes AAC
  audio from an AAC source through WebKit's native AudioEncoder fails at the last audio packet.
- Environment. CI: container `mcr.microsoft.com/playwright:v1.64.1-noble`, `@playwright/test` 1.64.1 (WebKit
  revision 2370), Node 22, `--workers=2`, `vite build` then `vite preview`. Local: Debian 13 (Linux 6.12),
  Node 22.19.0, the same Playwright 1.64.1 and WebKit 2370 (UA `Version/27.2 Safari/605.1.15`), `CI=1` so the
  web server runs the same `vite build` command as CI.
- Change around the start: 2aef11d moved `mediabunny` and `@mediabunny/*` from 1.62.0 to 1.65.0.
- Unit baseline: `pnpm test`: `Test Files  42 passed (42)`, `Tests  510 passed (510)`.

## 1. Symptom and minimal reproduction

```sh
CI=1 pnpm exec playwright test --project=webkit e2e/convert.spec.ts:200 -g m4a --reporter=line
```

Result on 706496f, 3 of 3 runs (`--repeat-each=3`):

```
Error: Error: Timestamps cannot be smaller than the largest timestamp of the previous GOP (a GOP begins with a key packet and ends right before the next key packet). Got 2.996s, but largest timestamp is 3.017333333333333s.
3 failed
```

The same test passes on chromium (`1 passed`). The failure is deterministic; the test uses
`tests/fixtures/land-1080p30-aac.mp4` (AAC 48 kHz, first audio packet at pts -0.021333 s with 1024 skip samples).

A standalone WebCodecs reproduction, with no app or mediabunny code, shows the browser defect. It AAC-encodes
8 frames natively, then decodes the same chunks twice: once with timestamps from 0, once from -21333 us.

```js
// node webkit-aac-negative-ts.mjs   (import @playwright/test from the repo's node_modules)
import { webkit } from '@playwright/test';
const browser = await webkit.launch();
const page = await browser.newPage();
await page.route('https://repro.test/', (r) =>
  r.fulfill({ contentType: 'text/html', body: '<p>repro</p>' }),
);
await page.goto('https://repro.test/');
console.log(
  JSON.stringify(
    await page.evaluate(async () => {
      const sr = 48000,
        ch = 2,
        n = 1024,
        us = (i) => Math.round(((i * n) / sr) * 1e6);
      const chunks = [];
      let config;
      const enc = new AudioEncoder({
        output: (c, m) => {
          config ??= m?.decoderConfig;
          const b = new Uint8Array(c.byteLength);
          c.copyTo(b);
          chunks.push(b);
        },
        error: (e) => {
          throw e;
        },
      });
      enc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate: 128000 });
      for (let i = 0; i < 8; i++)
        enc.encode(
          new AudioData({
            format: 'f32-planar',
            sampleRate: sr,
            numberOfChannels: ch,
            numberOfFrames: n,
            timestamp: us(i),
            data: new Float32Array(n * ch).map((_, k) => Math.sin(k / 10) * 0.2),
          }),
        );
      await enc.flush();
      const run = async (offset) => {
        const out = [];
        const dec = new AudioDecoder({
          output: (a) => {
            out.push(a.timestamp);
            a.close();
          },
          error: (e) => out.push(String(e)),
        });
        dec.configure(config);
        chunks.forEach((b, i) =>
          dec.decode(
            new EncodedAudioChunk({
              type: 'key',
              timestamp: offset + us(i),
              duration: us(1),
              data: b,
            }),
          ),
        );
        await dec.flush();
        return out;
      };
      return { fromZero: await run(0), fromNegative: await run(-21333) };
    }),
  ),
);
await browser.close();
```

Output on Playwright WebKit 2370:

```
fromZero     inputs  [0, 21333, 42667, 64000, 85333, 106667, 128000, 149333]
             outputs [0, 21333, 42667, 64000, 85333, 106667, 128000, 149333]
fromNegative inputs  [-21333, 0, 21334, 42667, 64000, 85334, 106667, 128000]
             outputs [-128000, -106667, -85334, -64000, -42667, -21334, 0, -21333]
```

When the first chunk has a negative timestamp, WebKit's AudioDecoder emits wrong output timestamps, and the last
output steps backwards. Chromium could not run this script (`no native AAC encoder` in Playwright Chromium).

## 2. Hypotheses

| ID  | Hypothesis                                                                                                                                            | Evidence for                                                                                                                                                                                            | Evidence against                                                                                                                             | Test and result                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| H1  | CI-only flakiness or load (workers, runner)                                                                                                           | Report 02 saw WebKit failures under load                                                                                                                                                                | Identical error text in all 21 failures; 3/3 local failures with 1 worker; report 02's tests differ (cuts, live preview, filmstrip)          | RULED OUT: deterministic local repro                                                                         |
| H2  | An app commit in the range (9aa29d5, 2e28677, 258d45f) broke exports                                                                                  | 2e28677 changed export gating                                                                                                                                                                           | 766b283 (after 9aa29d5 and 2e28677) passes; the first failing commit is 2aef11d, which changes only dependency versions and docs             | RULED OUT by bisection: 766b283 `1 passed`, 2aef11d `1 failed`                                               |
| H3  | `@mediabunny/aac-encoder` 1.65.0 (WASM AAC, +137 kB) is at fault                                                                                      | It grew in 1.65.0; WebKit lacks native AAC in some builds                                                                                                                                               | Instrumented `encode()` never ran: this WebKit uses its native AudioEncoder                                                                  | RULED OUT: mediabunny 1.65.0 with aac-encoder 1.62.0 fails; mediabunny 1.62.0 with aac-encoder 1.65.0 passes |
| H4  | v1.65 `AudioSample.toAudioData()` bounds change (`sample.ts:3084`) breaks the AudioData                                                               | Named in the changelog lead                                                                                                                                                                             | The AudioSample handed to the encoder already has the wrong timestamp (2.944 s twice) before `toAudioData()` runs; 1.63.0 already fails      | RULED OUT: 1.63.0 `1 failed`, 1.62.1 `1 passed`                                                              |
| H5  | v1.63 encoder priming compensation (`detectAudioEncoderPrimingShift`, `encodeAacSilencePrefix`) reorders packets                                      | New in 1.63; detected shift is -2496 samples on this WebKit                                                                                                                                             | It shifts all packets by a constant, so it cannot reorder them; encoder input is already out of order (`DBGIN 2965333` then `DBGIN 2944000`) | RULED OUT as cause. The odd -2496 sample shift is a separate finding (F3)                                    |
| H6  | v1.63 audio decoder pre-roll starts decoding at the priming packet (pts -0.021333 s), and WebKit's AudioDecoder mishandles a negative first timestamp | 1.65 decodes 142 packets starting at sequence 0 (ts -0.021333); 1.62 decodes 141 starting at sequence 1 (ts 0). Decoder outputs in 1.65 run -2986666 ... 0, then -21333; in 1.62 they run 0 ... 2986666 | none found                                                                                                                                   | CONFIRMED: standalone WebCodecs repro above, no mediabunny involved                                          |

Instrumentation used (temporary `console.log` in `node_modules` dist files, read back from Playwright traces,
all removed): muxer packet timestamps, native encoder input and output, `AudioEncoderWrapper.add()` input,
`AudioDecoderWrapper` decode input and raw decoder output, for mediabunny 1.62.0 and 1.65.0.

## 3. Root cause chain

1. Trigger: an export re-encodes AAC audio from an MP4 whose first AAC packet is a priming packet at a negative
   timestamp (all AAC fixtures: pts -0.021333 s, 1024 skip samples; typical of ffmpeg and Apple encoders).
2. mediabunny 1.63.0 added audio decoder pre-roll (release notes v1.63.0: "Media sinks automatically use this
   value under the hood to begin decoding audio earlier"). `mediaSamplesInRange` now seeks the key packet at
   `startPacket.timestamp - preRollDuration` (`node_modules/mediabunny/src/media-sink.ts:561-566`), so decoding
   starts at the priming packet with timestamp -21333 us instead of the packet at 0.
3. Fault (outside this codebase): Playwright WebKit's native `AudioDecoder` emits wrong output timestamps when the
   first chunk's timestamp is negative. The last output goes backwards (`... -21333, 0, -21333`).
4. Propagation: `AudioDecoderWrapper` rebases outputs on the first input timestamp and accumulates durations, but
   resyncs to the decoder's timestamp when they differ by a full sample duration
   (`media-sink.ts:2343-2352`). The backward step triggers a resync, so the last sample gets 2.944 s, the timestamp
   of the sample two places earlier, instead of 2.986667 s.
5. The native `AudioEncoder` path passes sample timestamps through (`media-source.ts:2275`), so the AAC encoder
   receives 2.944 s after 2.965333 s and emits a packet that is earlier than its predecessor.
6. Observed failure: the MP4 muxer rejects it (`muxer.ts:45-67`): `Got 2.996s, but largest timestamp is
3.017333333333333s` (both values carry the +0.052 s priming shift, see F3). The app shows "The export failed",
   and the e2e tests time out waiting for the result screen.

This explains all observed symptoms:

- WebKit-only: Chromium's decoder is not affected, and Playwright Chromium has no native AAC encoder; it uses the
  WASM fallback, which ignores input timestamps after the first.
- MP3 and WAV extraction pass on WebKit: the WASM MP3 encoder and the PCM encoder derive timestamps from frame
  counts, not from sample timestamps.
- The copy-only M4A trim passes: no decode and no encode.
- The surround tests pass: E-AC-3 decodes through the `@mediabunny/ac3` custom decoder, not WebKit's AudioDecoder,
  and DTS audio is dropped.
- Deterministic, same numbers every run: fixed fixture, fixed codec delay.

Partial: I did not audit each of the 118+120 passing WebKit tests. Passing export tests either use other sources,
produce no AAC, or stop before the last packet (cancel tests). That is an inference, not a per-test check.

Root cause vs. patch site: the defect is in WebKit (Linux, Playwright build). mediabunny 1.63.0 exposed it by
feeding a negative first timestamp to the native decoder and by trusting decoder output timestamps on resync.
The app code is correct; no app commit in the range is involved.

## 4. Fix: not applied (direction gate)

Every available fix either patches or downgrades mediabunny, or adds a browser workaround layer to the decode
path. None is a small fix at the root cause in this codebase. Options for the decision:

| Option                                                | Change                                                                                                                                                                                               | Pros                                                                                                                                   | Cons                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Downgrade mediabunny and `@mediabunny/*` to 1.62.1 | `package.json`, lockfile                                                                                                                                                                             | Proven: the repro passes on 1.62.1; one-line revert of 2aef11d's versions                                                              | Loses 1.63-1.65 fixes (priming compensation, WebKit AAC encoder first-1024-samples fix, AV sync, Matroska CodecDelay, `toAudioData()` bounds). Check that bugs A and C fixes (2e28677, 258d45f) still pass on 1.62.1, and that `@mediabunny/ac3` 1.65.0 works with mediabunny 1.62.1 or also drop to 1.62.x. The gate lists this as a decision. |
| B. `pnpm patch mediabunny@1.65.0`                     | Patch `AudioDecoderWrapper` (native path) to keep chunk timestamps non-negative on WebKit, for example add a constant offset on decode and subtract it on output, or never resync on a backward step | Keeps 1.65; small diff; fixes it for every caller (Conversion, `AudioSampleSink` in `audioProcess.ts`, `audioMix.ts`, `addedAudio.ts`) | Dependency patch to carry and re-check on every upgrade; needs its own regression test                                                                                                                                                                                                                                                          |
| C. App-level custom AAC decoder for WebKit            | `registerDecoder()` a `CustomAudioDecoder` that wraps the native AudioDecoder with non-negative timestamps, registered only on WebKit                                                                | No dependency patch                                                                                                                    | New decode path (~60-80 lines) for all AAC on WebKit, including real Safari, where the bug is unverified; couples the app to mediabunny decoder internals                                                                                                                                                                                       |
| D. Report upstream and wait                           | mediabunny issue (pre-roll plus negative timestamps on WebKit), WebKit bug with the standalone repro                                                                                                 | Fix at the right layer                                                                                                                 | main stays red on WebKit and users on affected WebKit builds cannot export AAC until a release. Combine with A or B.                                                                                                                                                                                                                            |
| E. Skip or expect-fail the WebKit export tests        | e2e annotations                                                                                                                                                                                      | CI green                                                                                                                               | Hides a real user-facing failure; not recommended                                                                                                                                                                                                                                                                                               |

Recommendation: D together with B (or A if a dependency patch is unwanted), then re-run the WebKit, iPhone and
iPad e2e projects. Whichever option is chosen, the regression test is the existing
`e2e/convert.spec.ts:200` m4a case on webkit, plus a unit or e2e case that decodes the AAC fixture from 0 and
checks that sample timestamps strictly increase.

## 5. Verification evidence

- Repro before (706496f): `3 failed` of 3, error text above. Chromium: `1 passed`.
- Bisection with the same command: 766b283 `1 passed`; 2aef11d `1 failed`.
- Package isolation: mediabunny 1.65.0 with aac-encoder 1.62.0 `1 failed`; mediabunny 1.62.0 with aac-encoder
  1.65.0 `1 passed`; mediabunny 1.63.0 `1 failed`; 1.62.1 `1 passed`. First bad mediabunny release: 1.63.0.
- Standalone WebCodecs repro: outputs above.
- No fix, so no "after" run. Unit suite unchanged: `Tests  510 passed (510)`.
- Cleanup: instrumentation in `node_modules` restored from backups (grep for the debug markers finds nothing);
  bisection worktree removed; `git status` clean apart from this report.

## 6. Sibling risks and related findings (reported, not fixed)

| ID  | Severity      | Location                                                                                | Problem                                                                                                                                                                                                                                                                                | Proposed fix                                                                              |
| --- | ------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| F1  | MED SUSPECTED | `src/core/audioProcess.ts:233`, `src/core/audioMix.ts:133`, `src/core/addedAudio.ts:14` | The same `AudioSampleSink.samples()` path yields the duplicated last timestamp on WebKit for AAC sources. Loudness analysis and mixing do not throw, but the last decoded sample may land 42.7 ms (2048 frames) early                                                                  | Covered by option B or C; add a strictly-increasing timestamp check in a test             |
| F2  | MED SUSPECTED | `tests/fixtures/vp9-opus.webm` path, mediabunny `media-sink.ts:2343`                    | Opus sources also start at a negative pts (-0.007 s) and 1.63 adds Opus pre-skip handling. Whether WebKit's Opus decoder has the same defect is not tested                                                                                                                             | Run the standalone repro with Opus                                                        |
| F3  | LOW SUSPECTED | mediabunny `detectAudioEncoderPrimingShift` (1.63+)                                     | On this WebKit it detects a priming shift of -2496 samples, so every output AAC packet moves 52 ms later (first packet 0.030667 s). The probe also decodes with WebKit's AudioDecoder after a negative-timestamp silence prefix, so it may hit the same decoder defect and mis-measure | Check AV sync of a WebKit AAC export once exports work; report upstream with the F1 repro |
| F4  | LOW           | process: `docs/buglifecycle/04-changereviewer.md:121`                                   | The change review ran Chromium e2e only, so the dependency bump reached main without a WebKit run                                                                                                                                                                                      | Run all four e2e projects before merging dependency bumps                                 |

## 7. Not verified

- Real Safari on macOS or iOS: not available here. The defect is shown only on Playwright's WebKit 2370 build on
  Linux. Whether shipping Safari has it is unknown, so user impact outside Linux WebKit browsers is unknown.
- Chromium's AudioDecoder with negative timestamps: the standalone script could not run there (no native AAC
  encoder in Playwright Chromium). CI and local Chromium exports pass, which supports but does not prove it.
- Whether a WebKit or mediabunny issue for this already exists: `gh search issues --repo Vanilagy/mediabunny`
  for "WebKit timestamp" and "pre-roll" found no matching report (2026-11-01). The WebKit tracker was not searched.
- Sources: mediabunny v1.63.0 release notes (`gh release view v1.63.0 -R Vanilagy/mediabunny`, accessed
  2026-11-01) for the pre-roll and priming changes; mediabunny 1.62.0, 1.63.0 and 1.65.0 source in
  `node_modules` for the code paths. npm shows 1.65.0 as the newest release (2026-10-30).
