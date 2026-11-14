# Third-party components

## Acknowledgements and credits

Shipped libraries, icons and related type packages:

| Package                           | Licence                                                                                         | Source                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| mediabunny                        | MPL-2.0 (modified, see [`patches/mediabunny@1.66.0.patch`](../patches/mediabunny@1.66.0.patch)) | https://github.com/Vanilagy/mediabunny                                                          |
| @mediabunny/aac-encoder           | MPL-2.0 (unmodified), embeds FFmpeg AAC encoder under LGPL-2.1-or-later                         | https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder                           |
| @mediabunny/mp3-encoder           | MPL-2.0 (unmodified), embeds LAME 3.100 under LGPL-2.0-or-later                                 | https://github.com/Vanilagy/mediabunny/tree/main/packages/mp3-encoder                           |
| @mediabunny/ac3                   | MPL-2.0 (unmodified), embeds FFmpeg AC-3/E-AC-3 under LGPL-2.1-or-later                         | https://github.com/Vanilagy/mediabunny/tree/main/packages/ac3                                   |
| gifenc                            | MIT                                                                                             | https://github.com/mattdesl/gifenc                                                              |
| Lucide Icons 1.61.0               | ISC; some icons derive from Feather under MIT                                                   | https://lucide.dev/                                                                             |
| @types/dom-webcodecs              | MIT (type declarations only, not shipped)                                                       | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-webcodecs              |
| @types/dom-mediacapture-transform | MIT (type declarations only, not shipped)                                                       | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-mediacapture-transform |

### Mediabunny patch

`mediabunny` is MPL-2.0 and this repository modifies it with [`patches/mediabunny@1.66.0.patch`](../patches/mediabunny@1.66.0.patch),
applied through `patchedDependencies` in `pnpm-workspace.yaml`. The patch changes
`AudioDecoderWrapper.decode` in `dist/modules/src/media-sink.js`: when the first packet has a
negative timestamp (the AAC priming packet that Mediabunny 1.63 and later decodes), it shifts the
input timestamps to start at zero. Output sample timestamps do not change. WebKit's GStreamer
AudioDecoder returns wrong output timestamps for negative input timestamps, which made the MP4
muxer fail on AAC audio. See [`docs/buglifecycle/06-upstream-mediabunny-issue.md`](buglifecycle/06-upstream-mediabunny-issue.md). The patch file
is the source of the modified file. It is tied to one Mediabunny version, so remake it on every
Mediabunny upgrade, or drop it if upstream or WebKit fixes the cause.

### AAC fallback encoder

Browsers without a native WebCodecs AAC encoder get `@mediabunny/aac-encoder`, registered with
its documented `registerAacEncoder()` call. The app loads it with a dynamic `import()` only after
`canEncodeAudio('aac')` returns false, so it ships as a separate same-origin chunk, registered
once per page. The WASM is embedded in that JavaScript chunk, as the upstream package ships it.
[`THIRD-PARTY-LICENSES.txt`](../THIRD-PARTY-LICENSES.txt) explains how to rebuild with your own FFmpeg build.

Licence audit (version 1.66.0, 2026-11-14):

- The npm package declares MPL-2.0 and its `LICENSE` is the MPL-2.0 text. Its WASM is FFmpeg
  (libavcodec and libavutil) linked with an MPL-2.0 bridge (`src/bridge.c`).
- The package README now records provenance: FFmpeg commit
  `60a2818f76dcd1fee3155b1791304af104a0fc1b` (`n9.1-dev-2902-g60a2818f76d`), unmodified, built
  with Emscripten 4.0.21, plus the SHA-256 of the inlined WASM.
- The FFmpeg build flags in the package README, identical in the upstream repository, are
  `--disable-everything --disable-autodetect --enable-avcodec --enable-encoder=aac`. No
  `--enable-gpl`, `--enable-nonfree` or `--enable-libfdk-aac`. That selects only FFmpeg's native
  AAC encoder, which is LGPL-2.1-or-later (header of `libavcodec/aacenc.c`). FFmpeg's
  `LICENSE.md` states that GPL parts are off unless `--enable-gpl` is passed.
- No fdk-aac and no GPL code, so the package passes the allowlist rule "LGPL-2.1+ only for
  separately loaded, unmodified WASM chunks with source link". The chunk is the unmodified npm
  release, bundled and re-minified by Vite.

The npm metadata reports MPL-2.0, so the embedded LGPL code is not visible to `pnpm licenses`.
`scripts/check-licenses.mjs` keeps explicit per-package exceptions (`LGPL_WASM_EXCEPTIONS`):
LGPL is accepted for `@mediabunny/aac-encoder`, `@mediabunny/ac3` and `@mediabunny/mp3-encoder`
only. All three are pinned to the audited version; re-run the audit before upgrading any of them.

### MP3 fallback encoder

MP3 always uses the bundled LAME encoder, `@mediabunny/mp3-encoder`, registered with its
documented `registerMp3Encoder()` call, even where WebCodecs reports native MP3 support. The
native encoder is not trusted: in Playwright WebKit it ignored the requested bitrate and cut off
the end of the audio. The app loads the encoder with a dynamic `import()` on the first MP3 export,
so it ships as a separate same-origin chunk that the capability probe never loads. The WASM and the encode worker
(a `blob:` worker, allowed by the CSP) are embedded in that chunk.

Licence audit (version 1.66.0, 2026-11-14):

- The npm package declares MPL-2.0. Its WASM is LAME 3.100 (the package README records
  `lame-3.100.tar.gz`, unmodified), whose source headers grant the GNU Library General Public
  License version 2 or any later version (LGPL-2.0-or-later).
- The build uses `--disable-decoder --disable-frontend`, so LAME's GPL mpglib decoder is absent.
- `scripts/check-licenses.mjs` lists `@mediabunny/mp3-encoder` in `LGPL_WASM_EXCEPTIONS`, so
  LGPL is accepted for it, `@mediabunny/aac-encoder` and `@mediabunny/ac3` only. Re-run the audit
  before upgrading.
- LAME asks for acknowledgement and a link to https://lame.sourceforge.io/, given here and in
  [`THIRD-PARTY-LICENSES.txt`](../THIRD-PARTY-LICENSES.txt).

### AC-3 and E-AC-3 decoder

Chromium's default build configuration enables its AC-3 and E-AC-3 decoders only for Cast devices
and tvOS (`enable_platform_ac3_eac3_audio` in `media/media_options.gni`), and Chrome on Linux
reports neither as supported. The app registers the decoder from `@mediabunny/ac3` with its
documented `registerAc3Decoder()` call, and never registers its encoder. It loads the package with
a dynamic `import()` only when a source or added file has AC-3 or E-AC-3 audio and the track's
`canDecode()` returns false, so it ships as a separate same-origin chunk that other files never
fetch. The WASM and the decode worker (a `blob:` worker, allowed by the CSP) are embedded in that
chunk. The browser still cannot play such audio in the preview's `<video>` element, so the preview
plays the video without sound.

Licence audit (version 1.66.0, 2026-11-14):

- The npm package declares MPL-2.0 and its `LICENSE` is the MPL-2.0 text. Its WASM is FFmpeg
  (libavcodec and libavutil) linked with an MPL-2.0 bridge (`src/bridge.c`).
- The FFmpeg build flags in the package README are `--disable-everything --disable-autodetect
--enable-avcodec --enable-decoder=ac3 --enable-decoder=eac3 --enable-encoder=ac3
--enable-encoder=eac3`. No `--enable-gpl`, `--enable-version3` or `--enable-nonfree`, so the
  build is LGPL-2.1-or-later. The 1.66.0 package does apply an FFmpeg patch: its README builds
  FFmpeg commit 60a2818f76dcd1fee3155b1791304af104a0fc1b with
  `patches/ffmpeg-ac3-encoder-audio-frame-queue.patch`, a two-line `configure` fix that adds
  `audio_frame_queue` to the AC-3 encoder dependencies. The app never registers the encoder. The
  README records the build commit and Emscripten 4.0.21.
- `scripts/check-licenses.mjs` lists `@mediabunny/ac3` in `LGPL_WASM_EXCEPTIONS`. Re-run the audit
  before upgrading: the FFmpeg patch above is new in this version.
- AC-3 and E-AC-3 are Dolby codecs. This audit covers the software licences only, not patent
  rights in the codecs.
- The FFmpeg log text embedded in the WASM contains `https://streams.videolan.org/upload/`;
  `scripts/check-no-remote.mjs` allowlists it because nothing loads it.

## License

videoadjust is licensed under [MIT](../LICENSE).

Full notices, including the MPL-2.0, LGPL-2.1 and LGPL-2.0 texts, are in [`THIRD-PARTY-LICENSES.txt`](../THIRD-PARTY-LICENSES.txt). The build
copies it to `dist/THIRD-PARTY-LICENSES.txt` and the About dialog links to it. `pnpm check:licenses` reads
`pnpm licenses list --prod --json`, fails on any licence outside the allowlist (MIT, BSD-2/3-Clause,
ISC, Apache-2.0, 0BSD, MPL-2.0, plus the per-package LGPL exception above) and fails if a production package has no entry in
[`THIRD-PARTY-LICENSES.txt`](../THIRD-PARTY-LICENSES.txt). It runs in `pnpm build` and in the Tests workflow.
