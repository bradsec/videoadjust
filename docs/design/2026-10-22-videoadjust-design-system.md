# VideoAdjust design system (redesign brief)

## Product

VideoAdjust (videoadjust.com): free, private video tools that run entirely in the browser. Nothing is uploaded. Tools: Shrink video (resize, codec, quality; auto settings with an optional Adjust panel), Trim (shared by both tools), Compare original vs new (wipe slider), Extract audio (MP3 default, M4A, WAV). Audience: ordinary people on phone, tablet and desktop who need a video smaller, trimmed or audio-only; some power users open Adjust. JTBD: "Make this video small enough / short enough / audio-only, then save or share it, without uploading it."

## Screens and flow (frozen)

1. Drop: choose or drop one video. Privacy line "Stays on this device".
2. Prepare: video preview, trim bar (start/end handles, thumbnails, "Start here" / "End here" buttons, start/end/kept times), tool switch "Shrink video | Extract audio", summary (target format line, estimate "est. 18-24 MB from 212 MB"), one primary action ("Export" or "Extract audio"), "Adjust" disclosure with overrides (each shows auto value and Reset to auto).
3. Working: progress percent, elapsed, remaining, Cancel.
4. Result: size and reduction headline, Download (primary), Share, compare (video wipe slider, or audio player with waveform for audio), stats table original vs new, "Make it smaller" / "Lower bitrate", "Start over".
   Header: VideoAdjust logo + wordmark, privacy line, light/dark theme toggle (dark default). Footer: "Free. Works offline after your first visit.", Licences link, github.com/bradsec/videoadjust link, version.
   Copy voice: plain, short, sentence case. Keep all labels above verbatim.

## Typography

System font stack only (no web fonts; the app is self-contained): `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Numbers (times, sizes) use `font-variant-numeric: tabular-nums`; no monospace for prose.
Scale (px): 12 meta, 14 body-small and labels, 16 body, 18 section title, 24 screen title, 32 result metric, 40 desktop result metric. Weights 400, 500, 650. Sentence-case labels; no letter-spaced uppercase eyebrows except one optional 12 px overline per screen.

## Spacing, grid, radius

4 px base: 4, 8, 12, 16, 24, 32, 48, 64. Desktop: 12-column grid, 1280 px max content width, 32 px gutters; header, tool switch, canvas and inspector share the same left and right edges. Inspector rail inset 24 px everywhere. Radius: 6 inset pieces, 10 controls, 14 cards/surfaces, full circle only for play and drag knobs. Elevation on dark by lighter surface steps, not shadows.

## Buttons (one system)

- Primary (one per screen): filled accent, 52 px high (desktop 48), 20-24 px horizontal padding, 16 px 650 label, optional 20 px leading icon with 8 px gap.
- Secondary: tonal fill (surface-raised) with 1 px border, 44 px high, 16 px padding, 14-16 px 500 label. Start here / End here are secondary buttons, centred content, never full-width text-left (must not look like inputs).
- Tertiary: text button, accent-text colour, 44 px hit area, no fill.
- Icon-only: 44x44 hit area, 20 px icon, only for theme toggle, play/pause, close; always with accessible name and tooltip.
- States: default, hover (one step lighter/darker), pressed, 2 px focus ring offset 2 px in accent, disabled (40% opacity plus not-allowed), busy (label "Exporting..." with progress). Labels short verbs; filenames and estimates never inside buttons.
- Form fields (select, input) are the only outlined boxes: 44 px, 10 px radius, 1 px border, chevron icon.

## Icons

One family, Lucide-style: 24x24 artboard, 2 px stroke, round caps and joins, no fills (except play triangle). Render 20 px in buttons, 16 px in metadata, 24 px standalone. 8 px icon-label gap in buttons, 4 px in metadata. Optical alignment: icon vertically centred on the label cap height. Decorative icons beside text are aria-hidden.

## Colour (being redesigned: the current tangerine on warm graphite is rejected)

Dark is the default theme; a light theme must exist. One accent, used with restraint (primary button, selection, focus, trim handles). Semantic colours (success, warning, error) are never decorative. No purple/blue gradients, no neon glow, no glassmorphism, no pure black.
Candidate palettes (each direction uses exactly one):

- Palette A "Ink and Chartreuse": bg #0e0f0d, surface #171916, raised #21241f, line #30342d, text #f1f3ec, text-2 #b6bbad, text-3 #8b9182, accent #c6ef3a, on-accent #11140a, accent-text #d4f56a; trim handles accent; light theme bg #f6f7f2, surface #ffffff, text #161813, accent #4a6b00, on-accent #ffffff.
- Palette B "Graphite and Glacier": bg #0f1114, surface #171a1f, raised #20242b, line #2e333b, text #eef1f5, text-2 #b0b7c2, text-3 #8891a0, accent #8fd0ff, on-accent #071521, accent-text #a9dbff; trim handles accent; light theme bg #f4f6f9, surface #ffffff, text #12161c, accent #0a5c99, on-accent #ffffff.
  Semantic (both): success #5cc98f / light #1e7a4c, warning #e2b84b / light #7a5600, error #ff6b6b / light #b42318.

## Motion

Minimal: 120-160 ms state transitions (hover, tab change, disclosure), progress bar fill, no decorative animation; prefers-reduced-motion removes transitions.

## Accessibility

WCAG AA contrast (4.5:1 text, 3:1 UI components), visible focus everywhere, 44 px touch targets, persistent field labels, tabs use WAI-ARIA tabs pattern, theme toggle is role=switch "Light theme".
