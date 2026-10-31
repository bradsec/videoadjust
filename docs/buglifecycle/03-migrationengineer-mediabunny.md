# Migration: mediabunny 1.62.0 to 1.65.0

Date: 2026-11-01. Branch `fix/surround-audio-4k`. Rollback point: 766b283 (`git reset --hard 766b283` or revert the upgrade commit, then `pnpm install`).

## 1. Version table

| Component               | Before | After  | Docs read                                                                                                             |
| ----------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------- |
| mediabunny              | 1.62.0 | 1.65.0 | github.com/Vanilagy/mediabunny/releases, v1.63.0, v1.64.0, v1.65.0 (accessed 2026-11-01); npm registry: latest 1.65.0 |
| @mediabunny/aac-encoder | 1.62.0 | 1.65.0 | same; package README in node_modules (build flags, provenance)                                                        |
| @mediabunny/mp3-encoder | 1.62.0 | 1.65.0 | same                                                                                                                  |
| @mediabunny/ac3         | 1.62.0 | 1.65.0 | same; package README and `patches/` in node_modules                                                                   |

Reason: maintenance, keep extension packages matched. Lockfile truth confirmed (`pnpm-lock.yaml` all four at 1.65.0). No pin outside `package.json` and the lockfile (no CI image, engines or Dockerfile mention mediabunny). Support window: Mediabunny publishes no LTS policy that I found, so none is claimed.

## 2. Breaking changes and behaviour items

Release notes are the GitHub release pages. Impact is against this codebase.

| ID  | Impact | Change (doc ref)                                                                  | Usage here                                                                                      | Result                                                        |
| --- | ------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| M1  | MED    | v1.63.0: encoder priming delay compensation, correct timestamps with dropped data | AAC export. Observed: output audio duration 30.037 s to 30.016 s on a 30 s trim; video 30.000 s | Listed behaviour, improves sync. Accepted, no adaptation      |
| M2  | LOW    | v1.63.0: Matroska demuxer respects `CodecDelay`, muxer writes it                  | App reads MKV (user's file) and writes MP4/WebM; MKV read of the user's file converted fine     | No regression seen. WebM/Opus output not separately inspected |
| M3  | LOW    | v1.63.0: `InputAudioTrack.getPreRollDuration()` added                             | Not used                                                                                        | None                                                          |
| M4  | LOW    | v1.64.0: Opus pre-roll 400 ms; MP3 timestamps shifted by LAME encoder delay       | Opus decode and MP3 read/encode paths; unit and e2e MP3/Opus tests pass                         | None observed                                                 |
| M5  | LOW    | v1.64.0: TrueHD codec and `@mediabunny/truehd`                                    | Not used                                                                                        | None                                                          |
| M6  | LOW    | v1.65.0: `toAudioData()` view bounds fix, `maximumPacketCount` options            | Not used by the app directly                                                                    | None                                                          |
| M7  | MED    | F4: `@mediabunny/ac3` build now applies an FFmpeg patch                           | Licence audit, see below                                                                        | Audit passed, docs updated                                    |

No codemod exists or applies. No deprecation warnings appeared (`pnpm build` output contains none). Commit: the single upgrade commit listed in section 6.

### F4 licence re-audit (HIGH confidence, from the shipped package files)

- `@mediabunny/ac3@1.65.0` README: flags unchanged (`--disable-everything --disable-autodetect --enable-avcodec --enable-decoder=ac3 --enable-decoder=eac3 --enable-encoder=ac3 --enable-encoder=eac3`), no `--enable-gpl`, `--enable-version3`, `--enable-nonfree`.
- The new patch `patches/ffmpeg-ac3-encoder-audio-frame-queue.patch` is 15 lines and changes only two lines of FFmpeg's `configure` (adds `audio_frame_queue` to the AC-3 encoder dependencies). No GPL code is added. The decoder the app registers is not touched.
- The 1.65.0 READMEs add a provenance section: FFmpeg commit 60a2818f76dcd1fee3155b1791304af104a0fc1b (aac-encoder unmodified, ac3 patched), Emscripten 4.0.21, LAME 3.100 unmodified. The three packages now ship `licenses/` directories (FFmpeg, LAME).
- `scripts/check-licenses.mjs` passes unchanged (`licence check passed`); its exception list needs no edit. `check-no-remote.mjs` passes unchanged (`check:remote ok: no URL outside the allowlist in 15 built files`); the allowlisted videolan URL is still present.
- Edited `THIRD-PARTY-LICENSES.txt` (versions, FFmpeg commit, patch statement, WASM hashes) and the three README licence audits (version and date, patch note, removed the stale "later versions patch" warning).
- The WASM SHA-256 values are copied from the package READMEs; I did not recompute them (unverified).

## 3. Verification evidence

| Check               | Baseline (766b283)                                   | Final                                      |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `pnpm test`         | 42 files, 508 tests passed                           | 42 files, 508 tests passed                 |
| `pnpm lint`         | clean                                                | clean (after removing temporary spec)      |
| `pnpm typecheck`    | clean                                                | clean                                      |
| `pnpm format:check` | All matched files use Prettier code style!           | All matched files use Prettier code style! |
| `pnpm build`        | licence check passed, check:remote ok, check:size ok | same                                       |
| Chromium e2e        | 170 passed, 7 skipped                                | 170 passed, 7 skipped                      |
| surround-audio e2e  | in the 170                                           | 5 tests passed (run alone, list reporter)  |

Bundle sizes (bytes, gzip -9 in brackets):

| File                              | Before              | After               |
| --------------------------------- | ------------------- | ------------------- |
| initial JS (index + helper chunk) | 863,148 (234,939)   | 878,250 (238,343)   |
| mediabunny-ac3 (lazy, own chunk)  | 1,144,348 (296,104) | 1,173,052 (304,206) |
| mediabunny-aac-encoder (lazy)     | 992,419 (253,397)   | 1,129,226 (285,043) |
| mediabunny-mp3-encoder (lazy)     | 311,468 (132,491)   | 473,382 (117,625)   |
| dist total                        | 3,907,156           | 4,250,421           |

The AC-3 decoder stays in its own lazy chunk. The initial `preload-helper` chunk no longer exists as a separate file; its code merged into `index-*.js`, and a 1,018 byte `__vite-browser-external-*.js` stub appeared (Vite's empty shim for a Node built-in referenced by newer Mediabunny code). Initial JS grows 15 kB (1.7%).

Harness conversion of the user's MKV (AV1 4K HDR, E-AC-3 5.1; read-only, nothing copied into the repo; temporary spec and harness hook removed). Settings: MP4, H.264 1080p30 4 Mbps, AAC 128 kbps stereo, trims 0 to 30 s and 20 to 50 s. ffprobe, 1.62.0 vs 1.65.0:

```
1.62.0  c-0-30   video start 0.000000 dur 30.000000 | audio start 0.000000 dur 30.037333 | format 30.037333
1.62.0  c-20-50  video start 0.000000 dur 30.000000 | audio start 0.000000 dur 30.037333 | format 30.037333
1.65.0  c-0-30   video start 0.000000 dur 30.000000 | audio start 0.000000 dur 30.016000 | format 30.016000
1.65.0  c-20-50  video start 0.000000 dur 30.000000 | audio start 0.000000 dur 30.016000 | format 30.016000
```

Both versions read the source as `eac3, decodable: true, channels: 6`. Start alignment is identical (0.000000). Audio now overshoots the video by 16 ms instead of 37 ms, consistent with M1.

## 4. Rollback

`git reset --hard 766b283 && pnpm install` (or `git revert` the upgrade commit). No persisted format changes.

## 5. Deferred and unverified

- SUSPECTED: no audible check of A/V sync; ffprobe stream start times and durations only. A cross-correlation or listening test was not done.
- Not verified: WebKit, iPhone and iPad projects; real-browser (non-Playwright) AAC encode on Safari, where M1 and the v1.63.0 WebKit AAC fix matter most; WebM/Opus output; the full-length 125 s file (trims of 30 s used); MKV output (the app does not write MKV).
- WASM SHA-256 values in `THIRD-PARTY-LICENSES.txt` come from upstream READMEs, not recomputed.
- Patent question for AC-3 and E-AC-3 stays open (software licences only).
- No further migration is set up. TrueHD (`@mediabunny/truehd`) is a possible future decoder, not requested.
