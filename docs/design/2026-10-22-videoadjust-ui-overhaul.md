# videoadjust UI overhaul

Mode: full overhaul of the web UI. Screens, flow, features and copy voice
stay frozen. Layout, hierarchy, header, footer and the whole palette change.
Mockup: `docs/mockups/overhaul.html`. Renders: `docs/mockups/overhaul/*.png`
(regenerate with `node scripts/render-overhaul.mjs`).

## Audit of the current UI (what drove the changes)

| ID  | Severity | Screen  | Problem                                                                                                                                               | Fix                                                                                                                             |
| --- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A1  | HIGH     | All     | The revamp kept the same stack (header pill, filename, rounded video card, trim, one big card) and only swapped colours, so it reads as the same app. | Rebuild the hierarchy: task switch first, full-bleed video, cue rows, docked action. See section 3.                             |
| A2  | HIGH     | Prepare | Shrink video / Extract audio sits inside the export card, below the fold on phone, although it decides what every control below it means.             | Promote the tool switch to a full-width tab bar under the header (phone, tablet) and into the header centre (desktop).          |
| A3  | HIGH     | Prepare | Export is below the size bars and the estimate; on phone it is about two screens down. The estimate and the action are separated by three blocks.     | Dock the estimate and the primary action together, sticky to the viewport bottom (phone, tablet) or inspector bottom (desktop). |
| A4  | HIGH     | Prepare | Start here / End here: revamp dark-teal tint fill reads as a tag; the light version is an outline with weak fill.                                     | Raised fill, 1px control border at 3:1 or more, bottom shadow, accent icon, 44px height.                                        |
| A5  | MEDIUM   | Header  | "Stays on this device" pill wraps to two lines at 390px in the revamp header with the theme toggle.                                                   | Drop the pill. Put the promise as a one-line lock caption under the wordmark.                                                   |
| A6  | MEDIUM   | Prepare | Two stacked size bars (Original, New) need two reads to compare.                                                                                      | One meter: the hatched track is the original, the filled part is the new size.                                                  |
| A7  | MEDIUM   | Result  | Download sits below the compare stage and a seven-row table; on phone it is near the page end.                                                        | Put Download and Share directly under the verdict, before the comparison.                                                       |
| A8  | MEDIUM   | All     | Teal plus amber trim gives two competing accents.                                                                                                     | One accent (tangerine) for primary action, trim range and selection; everything else neutral.                                   |
| A9  | LOW      | Prepare | Timecodes in proportional digits jitter while scrubbing.                                                                                              | System monospace stack for timecodes, sizes and stats values.                                                                   |

What already works and stays: Adjust as a closed disclosure with "All
automatic" state, per-option "Auto:" tags, reset-to-default link, wipe compare,
stats table, all copy.

## 1. Design read and dials

Designing: a local video utility for ordinary phone and desktop users doing
"make this video smaller, trimmed or audio-only and send it", vibe darkroom
workbench, on mobile and desktop web, design system new (videoadjust tokens
below).

- VARIANCE 4: an editor-style asymmetric desktop (canvas plus flush
  inspector) and an edge-to-edge phone video break the centred-card template,
  but the tool must stay predictable for non-experts.
- DENSITY 5: the prepare screen carries a video, a trimmer and a size
  forecast; rows are tight with 64px cue rows, and Adjust stays collapsed so
  the default view is not crowded.
- MOTION 2: nearly static. Only state feedback (chevron rotation, pressed
  states, progress fill). Video work is already slow; nothing should add delay.

## 2. Information architecture and flow

Frozen flow, new emphasis:

```
Drop ──choose file──> Prepare [Shrink video | Extract audio]
                         │  trim, optional Adjust
                         └─ Export / Extract audio ──> Progress ──> Result (compare | audio player)
                                                          │            ├─ Download (primary), Share
                                                          └─ Cancel    └─ Make it smaller / Lower bitrate, Start over
Notices (warn, error, info) attach to Drop, Prepare and Result as today.
```

- Prepare hierarchy, top to bottom: tool tab, video, file facts, trim, output
  spec and size meter, Adjust, dock (estimate plus primary action).
- One primary action per screen: Choose video, Export or Extract audio,
  Download. Cancel export is secondary. Make it smaller, Lower bitrate and
  Start over are quiet.
- The tool tab switches the inspector content only; video, trim and file stay
  in place, so switching never loses the trim.

## 3. Design spec

### Palette (one accent, warm graphite neutrals)

Intent: tungsten light on graphite, the colour of a monitor in a dim edit
room. No teal, no purple-blue gradient, no glow. The accent is used only for
the primary button, the trim range, the active tab bar, pressed segments and
the new-size fill.

Dark (default)

| Token           | Hex       | Use                              | Contrast                                  |
| --------------- | --------- | -------------------------------- | ----------------------------------------- |
| `--bg`          | `#121110` | page                             |                                           |
| `--panel`       | `#1c1a18` | inspector, dock, drop target     |                                           |
| `--raised`      | `#2a2724` | secondary button fill, tracks    |                                           |
| `--line`        | `#3a3632` | dividers (decorative only)       |                                           |
| `--ctl`         | `#77706a` | control borders                  | 3.87 on bg, 3.56 on panel, 3.05 on raised |
| `--text`        | `#f2ede6` | primary text                     | 16.20 on bg, 14.90 on panel, 12.75 raised |
| `--text-2`      | `#b5ada2` | secondary text                   | 8.50 on bg, 7.82 on panel, 6.69 raised    |
| `--text-3`      | `#958c81` | eyebrows, tags                   | 5.70 on bg, 5.24 on panel                 |
| `--accent`      | `#ff8a3d` | primary fill, trim, tab bar      | 8.04 on bg, 7.40 on panel (UI)            |
| `--on-accent`   | `#1f0f04` | text on accent                   | 7.94 on accent                            |
| `--accent-text` | `#ffa266` | accent text, figures, links      | 9.53 on bg, 8.77 on panel                 |
| `--accent-soft` | `#3b2416` | pressed segment fill, glyph disc | text on it 12.44                          |
| `--ok`          | `#5cc98f` | "Done in" eyebrow only           | 9.17 on bg                                |

Light (`[data-theme='light']`)

| Token           | Hex       | Contrast                                  |
| --------------- | --------- | ----------------------------------------- |
| `--bg`          | `#f5f1ea` |                                           |
| `--panel`       | `#ffffff` |                                           |
| `--raised`      | `#eee8df` |                                           |
| `--line`        | `#e0d8cc` | decorative only                           |
| `--ctl`         | `#857c70` | 3.65 on bg, 4.11 on panel                 |
| `--text`        | `#1b1814` | 15.71 on bg, 17.69 on panel, 14.52 raised |
| `--text-2`      | `#57504a` | 7.03 on bg, 7.92 on panel, 6.50 raised    |
| `--text-3`      | `#6e665d` | 5.01 on bg, 5.64 on panel                 |
| `--accent`      | `#c2470e` | 4.44 on bg, 5.00 on panel (UI)            |
| `--on-accent`   | `#ffffff` | 5.00 on accent                            |
| `--accent-text` | `#a63c0b` | 5.70 on bg, 6.42 on panel, 5.32 on soft   |
| `--accent-soft` | `#fbe6d8` | text on it 14.66                          |
| `--ok`          | `#1e7a4c` | 4.73 on bg                                |

Semantic colours for notices keep their meaning and are never decorative:
error red (dark `#ff6b6b`, 6.80 on bg; light `#b42318`, 6.57 on white),
warning yellow (dark `#e9c46a`, 11.29; light `#8a5a00`, 5.93 on white). Every
notice also carries an icon and a heading, so meaning never rides on colour
alone. The tangerine accent sits between red and yellow, so notices always use
their icon and a tinted left rule, never a filled accent-like block.

The video stage keeps a fixed near-black (`#0a0908` dark, `#1b1814` light)
so footage looks the same in both themes; overlays on it use fixed
`#f2ede6` on `rgb(10 9 8 / 0.75)`.

### Type

System stacks only (no web fonts):

- UI: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif`
- Timecode: `ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace`
  for timecodes, file facts, sizes, stats values, kbps segments, version.

| Step    | Size / weight / line height                     | Use                                      |
| ------- | ----------------------------------------------- | ---------------------------------------- |
| micro   | 12 / 700 / 1.45, +0.09em, caps                  | eyebrows, cue labels, table heads        |
| small   | 14 / 400-600                                    | sub lines, Adjust state, table           |
| meta    | 12.5-13 mono                                    | file facts, meter labels, timecode chips |
| body    | 16 / 400-650 / 1.45                             | text, buttons, tabs                      |
| lead    | 18 / 650-750                                    | Trim heading, primary button, facts      |
| h3      | 20 / 750, -0.01em                               | output spec ("1080p, H.264/AAC MP4")     |
| dock    | 21 / 800, -0.02em ("est." 15/600)               | estimate in dock                         |
| cue     | 22 mono / 700                                   | Start and End values                     |
| figure  | 34 / 800 / 1.08, -0.03em (40 desk)              | result verdict                           |
| display | 30 phone, 44 tablet, 56 desktop / 800, -0.025em | drop headline                            |
| pct     | 72 / 800, -0.04em                               | progress percentage                      |

Wordmark: "Video" 400 plus "Adjust" 800, 18px, existing logo glyph with its
inner block in the accent. A final mark is for a graphic designer.

### Spacing, radius, grid

- Spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Gutters: 16 phone, 32 tablet and desktop.
- Radius: 6 (chips, strip), 10 (buttons, segments, selects), 14 (panels,
  primary XL button, dock on tablet). Phone video stage: 0 (full bleed).
- Desktop grid: `minmax(0, 1fr) 440px`, canvas left, inspector flush right,
  full window width. Header grid `1fr auto 1fr`.

### Wireframes

Phone, 390px. Drop

```
┌────────────────────────────────────┐
│ [logo] videoadjust            [sun]│
│        lock Stays on this device   │
├────────────────────────────────────┤
│ ┌ ┐                          ┌ ┐   │  drop target, panel, accent
│        (film glyph)                │  viewfinder corners
│     [   Choose video   ]  XL       │
│     or drop a video file here      │
│  MP4, MOV, WebM, MKV. Works best.. │
│ └ ┘                          └ ┘   │
│ FREE ONLINE VIDEO TOOLS            │
│ Make a video small enough to send. │  display 30
│ Compress, convert, resize, trim .. │
│ (1) Choose  (2) Export  (3) Send   │
├────────────────────────────────────┤
│ Free. Works offline after ...      │
│ Licences  github.com/...  v0.x     │
└────────────────────────────────────┘
```

Phone. Prepare, Shrink video (Extract audio identical except the inspector)

```
┌────────────────────────────────────┐
│ [logo] videoadjust            [sun]│
│        lock Stays on this device   │
├─────────────────┬──────────────────┤
│ [] Shrink video │  ||| Extract audio│ tabs 52px, active: panel fill
│▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│                  │ + 3px accent bar
├─────────────────┴──────────────────┤
│▒▒▒▒▒▒▒▒▒▒▒▒ video, full bleed ▒▒▒▒▒│ 16:9, play 64px
│▒ [0:12.4 / 1:24.6]  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
├────────────────────────────────────┤
│ IMG_4821.MOV                       │
│ 212 MB · 3840x2160 · 60 fps · ...  │ mono 12.5
├────────────────────────────────────┤
│ Trim             0:38.6 of 1:24.6  │
│ [▌|thumbs in range|▐]dimmed thumbs │ strip 56px
│────────────────────────────────────│
│ START  0:03.2     [|<- Start here] │ cue row 64px
│────────────────────────────────────│
│ END    0:41.8     [->| End here  ] │
│────────────────────────────────────│
│ READY TO EXPORT                    │
│ 1080p, H.264/AAC MP4               │
│ 30 fps · AAC 128 kbps stereo       │
│ New, estimated 18-24 MB  Orig 212MB│
│ [██░░░░░░░░hatched░░░░░░░░░░░░░░░] │ one meter
├────────────────────────────────────┤
│ Adjust            All automatic  v │ 56px disclosure
├────────────────────────────────────┤ DOCK, sticky bottom
│ est. 18-24 MB         [ Export  ]  │ panel, 54px primary
│ from 212 MB                        │
├────────────────────────────────────┤
│ footer                             │
└────────────────────────────────────┘
```

Extract audio inspector: eyebrow "Ready to extract", "MP3 · 128 kbps
stereo", "Audio 3:12 of 3:12", meter "Audio, estimated 2.9-3.3 MB / Original
video 212 MB", Adjust (Format radio cards MP3, M4A (AAC), WAV; Bitrate
segments 64 to 320 mono; Channels), dock "est. 2.9-3.3 MB / from 212 MB
video" plus [Extract audio].

Phone. Progress

```
│ header (no tabs)                   │
│▒▒▒ dimmed frame, full bleed ▒▒▒▒▒▒▒│
│▒ [Encoding 0:24.1 of 0:38.6] ▒▒▒▒▒▒│
│ Exporting IMG_4821-small.mp4       │
│ 1080p · H.264/AAC MP4              │
│────────────────────────────────────│
│ 62%                                │ 72px
│ [██████████████░░░░░░░░░]          │
│ ELAPSED 0:48   REMAINING about 0:30│ 2x2 facts
│ WRITTEN 12.8MB EXPECTED 18-24 MB   │
│ New, so far 12.8 MB   Original 212 │ meter
│ [   (x) Cancel export           ]  │ secondary, full width
│ Keep this tab open until ...       │
```

Phone. Result, Shrink video

```
│ header                             │
│ DONE IN 1:18                       │ ok green eyebrow
│ 20.6 MB, 90% smaller               │ figure 34, "90% smaller" accent
│ IMG_4821-small.mp4 is ready to send│
│ [ v Download  IMG_4821-small.mp4 ] │ primary XL 60px
│ [        ^ Share                 ] │ secondary
│▒ Original·2160p ┃ New·1080p ▒▒▒▒▒▒▒│ wipe, full bleed
│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ (<>) ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│ [Playback|Frame]                   │
│ [||] ━━━━●──────────  0:12.4/0:38.6│
│ New 20.6 MB          Original 212MB│
│ [███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] │
│ stats table (Size .. Reduction)    │
│ [] Make it smaller   () Start over │ quiet
```

Phone. Result, Extract audio: same verdict and Download / Share block, then a
player panel (52px accent play disc, file name, "MP3 · 128 kbps stereo",
waveform with the played part in accent, 0:41 and 3:12), meter, stats
(Original video / Audio file), quiet Lower bitrate and Start over.

Tablet, 820px: the phone order with 32px gutters, rounded 14px stage, file
facts on one line, the two cue rows side by side, and the inspector (spec,
Adjust, dock) as one bordered panel whose bottom is the dock.

Desktop, 1440px. Drop

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo] videoadjust                                              [sun]│
│        lock Stays on this device                                     │
├──────────────────────────────────────────────────────────────────────┤
│ FREE ONLINE VIDEO TOOLS        ┌ ┐                              ┌ ┐  │
│ Make a video                         (film)                          │
│ small enough to                  [ Choose video ]                    │  5fr | 7fr
│ send.              56px          or drop a video file here           │  target 520px
│ Compress, convert, ...           MP4, MOV, WebM, MKV ...             │
│ (1) Choose                     └ ┘                              └ ┘  │
│ (2) Export                                                           │
│ (3) Send                                                             │
├──────────────────────────────────────────────────────────────────────┤
│ Free. Works offline ...                 Licences  github...   v0.x   │
└──────────────────────────────────────────────────────────────────────┘
```

Desktop. Prepare (Adjust open, one change)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo] videoadjust      [] Shrink video   ||| Extract audio     [sun]│
│        lock Stays...    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀                              │
├──────────────────────────────────────────────┬───────────────────────┤
│ ┌──────────────────────────────────────────┐ │ READY TO EXPORT       │
│ │                video 16:9                │ │ 1080p, H.264/AAC MP4  │
│ │ [0:12.4 / 1:24.6]                        │ │ 30 fps · AAC 128 ...  │
│ └──────────────────────────────────────────┘ │ New 14-18 MB  Orig 212│
│ IMG_4821.MOV  212 MB · 3840x2160 · ...       │ [█░░░░░░░░░░░░░░░░░]  │
│ Trim                        0:38.6 of 1:24.6 │───────────────────────│
│ [▌thumbs|▐]                                  │ Adjust     1 change ^ │
│ START 0:03.2 [|<-Start here] END 0:41.8 [->|]│ Format   [MP4|WebM]   │
│                                              │ Video  [H.264|HEVC|AV1]│
│                                              │ Resolution [select]   │
│                                              │ Frame rate [select]   │
│                                              │ Quality • Reset to Bal│
│                                              │ Audio  [AAC|Opus|None]│
│                                              │───────────────────────│
│                                              │ est. 14-18 MB [Export]│ dock, bottom
├──────────────────────────────────────────────┴───────────────────────┤
│ footer, one line                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

Desktop. Prepare, Extract audio: same frame, header tab "Extract audio"
active, inspector holds the audio spec, meter, Adjust (Format radio cards,
Bitrate, Channels) and the dock with [Extract audio].

Desktop. Result (both tools)

```
├──────────────────────────────────────────────┬───────────────────────┤
│ ┌──────────────────────────────────────────┐ │ DONE IN 1:18          │
│ │ Original · 2160p  ┃        New · 1080p   │ │ 20.6 MB, 90% smaller  │
│ │                  (<>)                    │ │ ... is ready to send. │
│ └──────────────────────────────────────────┘ │ [v Download  file   ] │
│ [Playback|Frame] [||] ━━━●───── 0:12.4/0:38.6│ [^ Share            ] │
│ New 20.6 MB                   Original 212 MB│ stats table           │
│ [███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] │ Make it smaller  Start│
```

Audio result swaps the wipe stage for the player panel and the quiet action
for Lower bitrate.

### Components and states

| Component           | Default                                                      | Hover             | Focus                        | Active / pressed                               | Disabled                                                                        | Other                                                                                 |
| ------------------- | ------------------------------------------------------------ | ----------------- | ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Primary button      | accent fill, on-accent text 17-18/750, 54-60px, radius 10-14 | accent 8% lighter | 2px accent outline, offset 2 | accent 8% darker, 1px down                     | raised fill, text-3, no shadow                                                  | loading: label stays, inline spinner                                                  |
| Secondary button    | raised fill, 1px `--ctl`, text, bottom shadow, 44-48px       | border `--text-2` | same outline                 | panel fill                                     | text-3, border `--line`                                                         |                                                                                       |
| Cue button          | secondary, 152px min, accent icon                            | as secondary      | same                         | as secondary                                   | when playhead equals value: disabled                                            |                                                                                       |
| Quiet button        | no fill, accent-text, icon, 44px                             | accent-soft fill  | same                         |                                                |                                                                                 |                                                                                       |
| Tool tab            | text-2, transparent                                          | text              | outline inside               | selected: text, panel fill, 3px accent bar     | Extract audio when no audio: text-3, `aria-disabled`, reason line under the bar |                                                                                       |
| Segment             | track bg with `--line` border, items text-2 40px             | item text         | outline                      | pressed: accent-soft fill, 1px accent, text    | line-through, text-3, reason under it                                           |                                                                                       |
| Select              | bg, 1px `--ctl`, mono value, chevron                         | border text-2     | outline                      |                                                |                                                                                 |                                                                                       |
| Radio card (format) | bg, 1px `--line`, 18px ring                                  | border `--ctl`    | outline                      | checked: accent border, soft fill, filled ring |                                                                                 | hint line text-2                                                                      |
| Adjust summary      | 56px row, "All automatic" text-2                             | panel fill        | outline                      | open: chevron up                               |                                                                                 | changed: "1 change" accent-text 650, dot on the changed option, Reset to default link |
| Trim handle         | accent 14px with grip, range border 3px accent               | cursor ew-resize  | 2px text outline             | dragging: playhead follows handle              |                                                                                 | arrow keys 0.1 s, shift 1 s                                                           |
| Theme toggle        | 44px raised, 1px `--ctl`, sun in dark, moon in light         | border text-2     | outline                      |                                                |                                                                                 | `aria-label` names the target theme                                                   |

## 4. Interaction and motion

- Tab change: inspector content swaps instantly; the accent bar moves under
  the chosen tab (no slide). Communicates which tool the dock action belongs to.
- Dock: sticky; the estimate updates in place when trim or Adjust change, with
  no animation, so the number is always readable. The mockup renders the dock
  in flow because full-page screenshots cannot show sticky positioning.
- Adjust chevron rotates 150ms ease-out: communicates open and closed.
- Pressed segment and radio fill change instantly: confirms the choice.
- Progress bar width eases over 200ms per update so it does not jump.
- Wipe knob follows the pointer 1:1, no easing.
- Reduced motion: chevron and progress transitions become instant.

## 5. Responsive behaviour and states

- Under 700px: single column, full-bleed stage, tabs as a full-width bar,
  stacked cue rows, dock sticky to the viewport bottom with safe-area padding.
- 700 to 1099px: 32px gutters, rounded stage, cue rows side by side, inspector
  as a bordered panel, dock sticky at the panel foot.
- 1100px and up: editor layout, tabs in the header centre, inspector a flush
  right column the full height of the work area, dock at the inspector foot.
- Touch targets: tabs 52px, buttons 44 to 60px, segments 40px, trim handles
  14 by 62px with a 44px invisible hit area.
- Empty: the drop target is the first view; Choose video is above the fold on
  every device.
- Loading (after choose, before metadata): stage shows the poster area with
  "Reading video", dock button disabled with "Export" label kept.
- Error and warning: existing notices, placed between the file facts and Trim
  on Prepare, under the verdict on Result, with icon, heading and action.
- Success: Result verdict plus Download first.

## 6. Accessibility

- All text pairs in section 3 meet 4.5:1; UI borders and the accent meet 3:1.
  Light accent `#c2470e` on page bg is 4.44, used only for fills and bars,
  never for body text (`--accent-text` is used for text).
- Tool switch is `role="tablist"` with arrow-key roving focus; trim handles are
  `role="slider"` with `aria-valuetext`; size meters are `aria-hidden` because
  the same numbers are printed as text.
- Progress uses `role="status"` with `aria-live="polite"` and a labelled
  `progressbar`.
- Changed Adjust options are marked by a dot and by the "1 change" text and
  the reset link, not by colour alone.
- Hand to an accessibility audit: tab order through the sticky dock, screen
  reader output of the wipe slider and trim handles, 200% zoom with the dock,
  forced-colours mode for the hatched meter and the accent bar.

## 7. Open questions and what to validate

- Does the tab bar above the video make people choose the tool before
  trimming, or do they still expect it next to Export? Test with 5 phone users.
- Is the sticky dock noticed as the next step on phone, or mistaken for a
  footer? Watch whether users scroll to look for Export.
- Do non-technical users understand the single meter (hatched original,
  filled new) without the two labelled bars?
- Tangerine against the warning yellow in notices: confirm the two are
  distinguishable for users with deuteranopia.
- Monospace file facts on Android (Roboto Mono or Droid Sans Mono) may run
  wider; check the Prepare file line at 360px.
