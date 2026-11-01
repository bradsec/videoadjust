# Preview proxy for videos the browser cannot preview

Design note, 2026-11-01. Branch context: `fix/preview-av-4k` (reports 07 to 09 in `docs/buglifecycle`).
Status: proposal, not built. Measurements come from a scratchpad prototype; no repo code changed.

Frame: designing the videoadjust preview so that every decodable video plays, meeting
"no crash" and "picture and sound visible" first and "simple code" second, under the binding
constraint that everything stays in the browser and nothing is uploaded.

## 1. Answer

YouTube never sends your browser the file you uploaded. Its servers re-encode every upload into
many smaller versions, and the player picks one that the device can play. videoadjust can copy
the second half locally: Mediabunny already decodes this file without crashing, so it can write a
small 8-bit 720p H.264 + AAC stereo "preview copy" in the tab and play that in the existing
`<video>`. Measured on the user's 4K HDR file: 42 s for 2:05.6, no crash, picture and sound
correct, in a Chrome harness where the original crashes the tab in 1.0 s.

## 2. How YouTube avoids this

| ID  | Mechanism                                                                                                                                                                                                                                       | Source                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Y1  | Server-side renditions. For HDR uploads "YouTube will detect the HDR metadata and process it, producing HDR transcodes for HDR devices" and an SDR version for other viewers.                                                                      | YouTube Help, "Upload High Dynamic Range (HDR) videos", support.google.com/youtube/answer/7126552, accessed 2026-11-01                                                                                      |
| Y2  | Upload guidance asks for stereo or stereo + 5.1 AAC/Opus; YouTube re-encodes audio itself, so the browser never receives E-AC-3.                                                                                                                 | YouTube Help, "Recommended upload encoding settings", support.google.com/youtube/answer/1722171, accessed 2026-11-01                                                                                        |
| Y3  | Playback through `<video>` fed by Media Source Extensions, which exist so "JavaScript [can] generate streams" for "adaptive streaming". YouTube moved to HTML5 by default in 2015, with adaptive bitrate and VP9 named as the enablers.             | W3C MSE 2, Working Draft 7 Aug 2026, w3.org/TR/media-source-2; YouTube Engineering blog post by Richard Leider (Jan 2015), original URL now 404, read via Streaming Media coverage, streamingmedia.com, accessed 2026-11-01 |
| Y4  | Capability checks are standardised: `MediaCapabilities.decodingInfo` returns `supported`, `smooth` and `powerEfficient`, and accepts `transferFunction` (`pq`, `hlg`), `colorGamut` and `hdrMetadataType`. CSS `dynamic-range: high` reports an HDR display. | MDN `decodingInfo` and `@media/dynamic-range`, accessed 2026-11-01; W3C Media Capabilities, Working Draft 18 Oct 2026, w3.org/TR/media-capabilities                                                      |
| Y5  | SUSPECTED: YouTube's player combines Y4 checks, `MediaSource.isTypeSupported` and its own device lists to choose between AV1, VP9 (profile 2 for HDR) and H.264, and at 8 or 10 bit. YouTube has not published this logic; no primary source found. | inference                                                                                                                                                                                                  |

The part a browser-only app cannot copy is Y1/Y2: YouTube has the renditions before anyone presses
play. The part it can copy is "never hand the browser a stream it handles badly; hand it a
simpler one".

## 3. How others do it

| Service                | 4K / 10-bit / HDR in desktop browsers                                                                                                                                                                                  | 5.1 / E-AC-3                                                                                       | Server renditions or transcode                                                                                             | Client checks                                                                                                                                                       | Chrome on Linux                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| YouTube                | HDR transcodes for HDR devices, SDR for the rest (Y1)                                                                                                                                                                  | Re-encoded to AAC/Opus (Y2)                                                                        | Yes, at upload                                                                                                             | SUSPECTED, see Y5                                                                                                                                                   | No official statement found                                                                                                                                  |
| Netflix web            | Ultra HD only in Edge and Chrome on Windows (with extra requirements), Safari on Mac, Chromebook                                                                                                                         | "5.1 surround sound is supported only on Windows 10 or later computers through the Edge browser or the Netflix app" | Yes (pre-encoded catalogue)                                                                                                | Not published                                                                                                                                                       | "Up to Full HD (1080p)"; "we can't guarantee Netflix will work on devices with a Linux OS". The older 720p cap for Chrome is no longer what the page says. |
| Vimeo                  | HDR needs an HDR10 display and HEVC; Chrome, Edge, Opera get "HEVC, not Dolby Vision"; otherwise "we'll automatically default to standard SDR playback"                                                                    | Not covered on the pages read                                                                      | Yes, SDR fallback rendition implies a second encode (SUSPECTED)                                                            | Not published                                                                                                                                                       | Not stated                                                                                                                                                   |
| Plex Web               | Tone mapping runs on the server during transcode (Plex Media Server 1.21.0+); forum reports say Web cannot direct-play HDR (forum, not authoritative)                                                                    | Not covered on the pages read                                                                      | Yes, on-demand transcode on the user's server                                                                              | Not published                                                                                                                                                       | Not stated                                                                                                                                                   |
| Jellyfin web           | "Any HDR content will have to be converted to SDR by the server" on clients without HDR; some Chromium-on-Linux tone mapping "generally looks very bad"                                                                     | Codec table: Chrome AC3 and EAC3 not supported                                                     | Direct play if possible, remux if only container/audio fails, transcode if the video codec fails                            | `canPlayType` only, plus browser/OS sniffing for HDR; no `MediaCapabilities`, no `matchMedia` (jellyfin-web `browserDeviceProfile.js`, master, read 2026-11-01)       | Chrome EAC3 not supported, so audio is transcoded                                                                                                            |
| Clipchamp (browser editor) | Accepts 4K on all tiers; warns 4K "can be slow to import" and "can also cause performance issues while editing", and suggests "compressing your input videos first" to e.g. 1080p                                   | Not covered                                                                                        | No proxy feature documented; the advice is a manual proxy                                                                  | Not published                                                                                                                                                       | Runs in Edge and Chrome; Linux not mentioned                                                                                                                 |

Sources, all accessed 2026-11-01: Netflix help.netflix.com/en/node/23742 and /node/2493 (browser
tables), /node/14163 (5.1); Vimeo help.vimeo.com/hc/en-us/articles/12425790453521; Plex
support.plex.tv/articles/hdr-to-sdr-tone-mapping/ (read via search summary, page not fetched in
full); Jellyfin jellyfin.org/docs/general/clients/codec-support/ and
github.com/jellyfin/jellyfin-web/blob/master/src/scripts/browserDeviceProfile.js; Microsoft
support.microsoft.com/en-us/Clipchamp/4k-video-support-in-clipchamp.

What a browser-only, no-upload app can copy:

- Server renditions (YouTube, Netflix, Vimeo): no. There is no server.
- On-demand transcode (Plex, Jellyfin): yes, if the "server" is the tab itself. That is the proxy.
- Capability checks (`decodingInfo`, `canPlayType`): only for audio. Measured below, `decodingInfo`
  reports this file's 10-bit PQ AV1 as `smooth=true`, yet the picture is black. Jellyfin's
  approach of sniffing for HDR and transcoding by default is the one that would have caught it.
- Clipchamp's advice (make a smaller copy first) is the same idea, done by hand.

## 4. Measurements

Prototype: `/tmp/claude-1000/-home-mark-Code-jsimageapps-videoadjust/50bc437b-0c65-4f83-b8b8-6a2bf42abf95/scratchpad/proxy/`
(`index.html`, `run.mjs`, `server.mjs` on port 4417). It imports the repo's
`node_modules/mediabunny` 1.62.1 bundle, `@mediabunny/ac3` and `@mediabunny/aac-encoder`. Browser:
`/usr/bin/google-chrome-stable` 156, headed, fresh profile, report 09's flag set with
`ignoreDefaultArgs: true` (`USERFLAGS=1`). Input: the user's file, read in place (2:05.6, AV1
Main 10, PQ/BT.2020, 3840x2160, E-AC-3 5.1). Proxy settings: `Conversion` to H.264, width given,
height derived; AAC 128 kb/s, 2 channels, 48 kHz; `forceTranscode`.

Verbatim results:

```
RESULT decodeOnly secs=20 videoFrames=600 audioBuffers=625 wall=2058ms fps=291.5
SURVIVED peakRenderer=833MB

RESULT proxy width=1280 sink=memory media=125.6s wall=42215ms speed=2.98x bytes=36.1MB firstPlay=-ms
SURVIVED peakRenderer=1344MB

RESULT proxy width=854 sink=memory media=125.6s wall=41289ms speed=3.04x bytes=18.5MB firstPlay=-ms
SURVIVED peakRenderer=1268MB

RESULT proxy width=1920 sink=memory media=125.6s wall=50736ms speed=2.48x bytes=38.1MB firstPlay=-ms
SURVIVED peakRenderer=1429MB

RESULT proxy width=1280 sink=mse media=125.6s wall=44748ms speed=2.81x bytes=36.1MB firstPlay=1482ms
play peak=244 mean=139.6 t=48.3 paused=false rs=4 w=1280 buffered=125.6 err=-
play peak=202 mean=26.7 t=83.7 paused=false rs=4 w=1280 buffered=125.6 err=-
SURVIVED peakRenderer=1295MB
```

Control, same flags and harness, original file in a bare `<video>` (report 09's `crash/bare.mjs`):

```
gpu --render-node-override=/dev/dri/renderD129 --enable-features=CanvasDrawElement
1s n/a gpu:263M rend:101M rend:108M rend:110M rend:110M rend:118M rend:154M rend:84M
CRASHED after 1.0s
```

Capability probe, same harness:

```
codec=av01.0.12M.10.0.110.09.16.09.0 hdr=true cs={"primaries":"bt2020","transfer":"pq","matrix":"bt2020-ncl","fullRange":false} audio=ec-3
file 4K 10-bit PQ: supported=true smooth=true powerEfficient=false
file 4K 10-bit no-hdr-fields: supported=true smooth=true powerEfficient=false
file 4K av1 8-bit: supported=true smooth=true powerEfficient=false
file 1080p avc: supported=true smooth=true powerEfficient=false
audio ec-3: supported=false smooth=false powerEfficient=false
canPlayType ec-3='' dynamic-range:high=false video-dynamic-range:high=false
```

Readings:

- The proxy path never puts the original in `<video>`, and survives the harness in which the
  original crashes the tab. The 8-bit H.264 proxy plays with a real picture (32x18 sample mean 27
  to 140, not 0) and AAC sound.
- Conversion runs at about 3x real time; 480p is not faster than 720p, so decode and audio, not
  the H.264 encode, set the pace. AAC uses the WASM fallback (`aac: wasm fallback`) because this
  Chrome has no native AAC encoder.
- Progressive playback through MSE starts 1.5 s after the conversion starts.
- `decodingInfo` cannot detect the black-picture fault (`smooth=true`). `powerEfficient=false`
  for every codec, including 1080p H.264, because this machine has no hardware decode.
- HDR to SDR: Mediabunny resizes through a canvas, and the result looked like plausible SDR in a
  screenshot. Colour accuracy against a reference tone map was NOT measured.
- Export: the 1920-wide run is the same work as the 1080p H.264 + AAC export: 50.7 s, 1.43 GB
  renderer peak, no crash. `prepareView` unloads its `<video>` on destroy
  (`src/ui/prepareView.ts:216`), so export should not overlap the native decode. SUSPECTED: export
  of this file works in the user's Chrome; it has still never been run through the UI there.

Projection for a 20-minute 4K file (linear from the 2:05.6 run, SUSPECTED until measured):

| Proxy        | Time to build | Proxy size | Renderer peak                                 |
| ------------ | ------------- | ---------- | --------------------------------------------- |
| 720p, 2.5 Mb/s | about 6.7 min | about 345 MB | about 1.3 GB while converting (flat, decoder-bound) plus the proxy Blob |
| 480p, 1.2 Mb/s | about 6.6 min | about 177 MB | about 1.3 GB plus the proxy Blob             |

With MSE, playback starts in about 1.5 s regardless of length, but Chrome caps a SourceBuffer
(SUSPECTED around 150 MB for video; check Chromium source) so a 20-minute 720p proxy would need
back-pressure and eviction.

## 5. Recommended design

```
File ──> probeSource (Mediabunny demux, already reads hdr + codec string + audio decodable)
           │
           ├─ needsProxy? no ──> <video src=original>   (today's path, unchanged)
           │
           └─ needsProxy? yes ─> makePreviewProxy(file)  (Mediabunny Conversion: H.264 720p 8-bit
                                   │                      SDR + AAC stereo, BufferTarget)
                                   │   "Preparing preview 42%"   [Cancel] [Use original]
                                   └─> Blob ──> <video src=proxyUrl>
                                                  │
                    trim, cuts, crop, style, audio preview: unchanged, same <video> clock
                    export, waveform, frame grab: still read the ORIGINAL file via Mediabunny
```

Trigger `needsProxy` (all from data `probeSource` already collects, `src/core/source.ts:57-120`):

1. video HDR (`hasHighDynamicRange()` true) or bit depth above 8 (from the codec string), or
2. audio track present and `decodingInfo`/`canPlayType` says the element cannot play it (E-AC-3,
   AC-3, DTS), or
3. the existing black-picture detector fires on a non-proxied source (then restart with a proxy).

Rule 1 is deliberately broad, like Jellyfin: on a Mac with hardware HDR decode it costs a proxy
that was not strictly needed. The [Use original] button covers that.

Decision log:

| ID  | Decision                                                                                                 | Why                                                                                                                                       | Alternatives rejected                                                                                                                                                                                                                       | Rules out / revisit if                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | Build a local preview proxy and play it in the existing `<video>`; never load the original when proxied | Only path measured to survive; keeps the `<video>` clock that every preview consumer uses (report 09 section 5)                          | Decoded canvas fallback (reports 08/09): two decoders crash the tab. Option A clock rewrite: largest change. Warning only (0.29.0): user still sees no picture.                                                                            | Revisit if Chrome fixes 10-bit GMB frames on Linux NVIDIA                                                         |
| D2  | Proxy format: H.264 8-bit, 1280 wide, 2.5 Mb/s, SDR, AAC stereo 48 kHz 128 kb/s, MP4                     | H.264 + AAC play in every target browser; 720p costs the same time as 480p; matches the export pipeline already shipped                   | VP9 (no gain, slower software encode, SUSPECTED); 480p (no time saved); Opus audio (native encode, avoids WASM AAC, but needs a Safari check; reasonable later swap)                                                                      | Revisit width if preview canvas grows past 1280                                                                   |
| D3  | Trigger from metadata up front (HDR or >8-bit video, or unplayable audio), plus the detector as backstop | `decodingInfo` returns `smooth=true` for the failing file, so it cannot decide; metadata is already probed                                  | `decodingInfo`-only trigger (measured blind to the fault); detector-only trigger (needs the original in `<video>` first, which is the crash setup)                                                                                          | Proxies some HDR files that would have played; [Use original] covers it                                           |
| D4  | v1 builds the whole proxy, then plays it (`BufferTarget`, Blob URL)                                       | Simplest; no MediaSource code; 42 s for a 2-minute 4K file                                                                                | MSE progressive (measured 1.5 s to first play) adds append queue, quota back-pressure and seek-past-buffer handling                                                                                                                         | Add MSE (D4b) only if users complain about the wait on long files                                                 |
| D5  | Export, waveform and frame grabs keep reading the original via Mediabunny                                 | Output quality must not drop to proxy quality; export is already the same decode and survived                                             | Export from proxy (quality loss)                                                                                                                                                                                                            | None                                                                                                              |
| D6  | Preview geometry stays in source pixels                                                                  | `previewGeometry.ts:85` scales `source.width/height`, not `video.videoWidth`, so crop and overlays do not change; only aspect must match     | Rescaling crop math to proxy size                                                                                                                                                                                                           | Proxy must keep the source display aspect and rotation                                                            |
| D7  | Proxy lives in memory for the session only                                                                | Nothing persisted, matches the privacy promise; a reload rebuilds it                                                                      | OPFS cache (survives reload, adds storage code and cleanup)                                                                                                                                                                                 | Revisit if users reopen the same long file often                                                                  |

One-way doors: none. The proxy is internal; no public format, setting or file changes.

## 6. Interaction with editing

- Trim, cuts, keyboard scrub: unchanged. They use `video.currentTime`; the proxy keeps the
  source timestamps (Conversion without trim starts at 0). Check that the proxy's first frame
  time matches a source that starts above 0.
- Crop and style: unchanged (D6). The WebGL style is drawn from a 720p texture instead of 4K,
  which is cheaper; the preview is a preview.
- Audio preview: the proxy carries a stereo downmix. The surround mixer preview (per-channel
  gains) cannot be heard on a stereo proxy. SUSPECTED that `previewAudio.ts` needs the channel
  count from the source, not the element; check before building.
- Compare view after export: `resultView.ts:277` loads the original into a `<video>` again. Use
  the proxy URL there too, or the compare view hits the same black picture or crash.

## 7. Failure modes

| ID  | Failure                                                         | Handling                                                                                                                       |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| F1  | No H.264 encoder (`canEncodeVideo('avc')` false)                 | Try VP9, then fall back to the 0.29.0 warning                                                                                  |
| F2  | Conversion throws mid-way (corrupt packets, decoder error)      | Show the 0.29.0 warning plus the error; export may still be attempted                                                          |
| F3  | User cancels or opens another file                              | `conversion.cancel()`, drop the Blob, revoke the URL                                                                           |
| F4  | Memory on long files (about 1.3 GB plus proxy)                   | Lower proxy bitrate past a duration threshold; measure a 20-minute file before setting it                                      |
| F5  | Tab hidden during build                                         | Conversion is not rAF-driven, so it continues; SUSPECTED that background throttling slows it                                   |
| F6  | HDR colours wrong in the proxy                                   | It is a preview; export is unaffected. Verify against a reference tone map                                                     |
| F7  | Crash in the user's real profile despite harness result         | Not ruled out: the user's profile differs from the harness (report 09). First build step tests it                              |

Consistency: the proxy is a pure function of the file; the original is never modified. Security:
no new trust boundary. The file stays in the tab; the proxy is a same-origin Blob URL.

## 8. Cost and operability

No server, no new dependency (Mediabunny, `@mediabunny/aac-encoder` and `@mediabunny/ac3` are
already shipped). Code estimate: one module of about 60 to 80 lines (`makePreviewProxy`), a
trigger function, a progress line in the prepare view, and wiring in `prepareView.ts` and
`resultView.ts`. It replaces the decoded-preview fallback that 0.29.0 already removes. User cost:
CPU at 100% on several cores for about a third of the clip length.

## 9. Build sequence

1. Riskiest assumption first: give the user a standalone page (the prototype above, or a
   `?proxy=1` build) and confirm that the proxy plays in their real Chrome profile without a crash.
   If it crashes, stop: the proxy does not fix the user's case.
2. `makePreviewProxy` plus unit tests for the trigger (HDR, 10-bit codec string, E-AC-3, 8-bit
   SDR AAC passes through).
3. Prepare view wiring: progress, cancel, [Use original]. e2e with a short 10-bit fixture.
4. Compare view uses the proxy.
5. Measure a 20-minute 4K file (time, memory) before shipping; set the bitrate rule for F4.
6. Deferred: MSE progressive start (D4b), OPFS cache (D7).

## 10. To verify

- Proxy playback in the user's own Chrome profile (F7). Highest priority.
- 20-minute projection (linear extrapolation only).
- Chrome's SourceBuffer quota, only if D4b is built (Chromium source).
- Safari and Firefox: H.264 encode via WebCodecs and AAC decode of the proxy; the e2e WebKit
  project runs on Linux, so real Safari is untested.
- HDR to SDR colour accuracy of the canvas resize path.
- YouTube's client-side selection logic (Y5) remains SUSPECTED; no primary source published.
