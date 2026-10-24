# videoadjust: rename and extract audio

Date: 2026-10-22
Builds on: `2026-10-22-videoadjust-design.md` (the v1 design; its constraints still apply).
Status: built (v0.3.0). Extract audio ships as specified.

## Intent

The app only shrank video. The owner wants it to
grow into a general in-browser video tool, so it is now **videoadjust**. The
first new tool is **Extract audio**: take the soundtrack out of a video as an
audio file, privately and locally, with the same trim control.

## Rename (done)

- GitHub repo renamed to `bradsec/videoadjust`, local folder `videoadjust/`.
  Live site is https://videoadjust.com/ on Cloudflare Pages.
- Package, titles, manifest, badges, service worker cache prefix renamed.
  The service worker deletes caches left under the two earlier names' prefixes
  (see `public/sw.js`).
- Dated v1 docs are a historical record; they were renamed with the app.

## Goals

- After a video is loaded, a tab switch above the settings picks the tool:
  **Shrink video** (today's behaviour, default) or **Extract audio**.
- The drop zone, preview and trim bar are shared by both tools. Trim
  applies to whichever tool exports.
- Extract audio auto-picks settings and lets the user override each one,
  with the same "auto value + reset" pattern as Shrink.
- Output formats: **MP3** (default), **M4A** (AAC), **WAV** (PCM).
- Estimated size before export, actual size after, as today.
- Result shows original video vs audio file (size, duration, codec,
  bitrate, reduction) and an audio player for the new file, plus Download,
  Share, "Lower bitrate" and "Start over".
- Phone, tablet and desktop, as today.

## Non-goals

- Dropping audio-only files (MP3, M4A) to convert them. Later, maybe.
- Audio editing: fades, normalisation, noise removal, splitting.
- Choosing among several audio tracks; the primary audio track is used.
- More tools in this change. The tab control must leave room for them.

## Anti-goals

- Any upload or third-party network call (unchanged).
- Losing Shrink settings when the user peeks at the other tab and back.
- An enabled Extract audio tab on a video with no audio track, or one whose
  audio cannot be decoded.

## Owner's decisions

- Rename the GitHub repo (not a new repo).
- MP3 is the default audio format; M4A and WAV are offered.
- Tabs after drop, not a tool picker on the landing page.

## Builder's calls (owner may revise)

- **Settings per tool.** Each tool keeps its own settings and overrides.
  Switching tabs keeps both; trim is shared. "Start over" resets both.
- **Audio auto settings.**
  - MP3: 128 kbps stereo, 96 kbps mono (same targets as Shrink audio).
    Never above the source audio bitrate, floored at 64 kbps. Source sample
    rate kept.
  - M4A: copy the source packets when the source is AAC and at or below
    target (same rule as Shrink); otherwise AAC at target. The UI says when
    it copies without re-encoding.
  - WAV: 16-bit PCM, source channels and sample rate; no bitrate control.
    Size hint shown, since WAV is large.
  - Channel override: stereo or mono (only mono for a mono source).
  - Bitrate steps: 64, 96, 128, 160, 192, 320 kbps. The user may pick a
    step above the source bitrate; auto never does.
- **MP3 encoder.** Always register `@mediabunny/mp3-encoder` 1.62.0 (MPL-2.0
  package, embeds a WASM build of LAME, LGPL), even where WebCodecs claims
  MP3 support: Playwright WebKit's native MP3 encoder ignored the bitrate
  and cut the tail. Load it as a lazy same-origin chunk on first MP3
  export, like the AAC fallback. Add it to the licence check's per-package
  LGPL exception and record the source link in `THIRD-PARTY-LICENSES.txt`.
  Precache it for offline.
- **Containers.** `Mp3OutputFormat` (.mp3, audio/mpeg),
  `Mp4OutputFormat` audio-only (.m4a, audio/mp4), `WavOutputFormat`
  (.wav, audio/wav). Output name `<name>-audio.<ext>`.
- **Save path.** Same sink logic as Shrink (file stream where available,
  else memory with the existing warning). Formats that rewrite a header at
  the end must work with the file stream sink; test this.
- **"Lower bitrate"** on the result steps down the bitrate list; for WAV it
  switches to MP3 at auto bitrate.
- **No-audio source.** The Extract audio tab shows disabled with the reason
  "This video has no audio track" (or "This video's audio cannot be decoded
  in this browser").
- **Tab control.** A segmented control with `role="tablist"`, arrow-key
  navigation, 44 px touch targets, selected state not shown by colour alone.
- **Tagline.** README and page subtitle describe videoadjust as a set of
  private in-browser video tools: shrink and extract audio for now.

## Errors and limits

As v1. An audio export that fails says which format failed and offers
another format.

## Testing

- Unit: audio auto settings (MP3 / M4A copy / WAV, mono, low source
  bitrate, no audio), size estimate for each format, output naming,
  per-tool settings kept across tab switches, "Lower bitrate" steps.
- E2E (chromium, webkit, phone, tablet): load fixture, switch tab,
  trim, extract to each format, result shows audio player and sizes,
  no-audio fixture disables the tab, axe clean, no cross-origin requests,
  offline extract after first visit (MP3 chunk precached).

## Mockups

`docs/mockups/*-prepare-audio*.png`, `*-result-audio.png` and
`phone-prepare-audio-noaudio.png`, for owner review before UI work.
