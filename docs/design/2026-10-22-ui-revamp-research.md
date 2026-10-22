# UI revamp research: dark-first direction

Date: 2026-10-22. Scope: visual system for videoadjust (shrink, trim, compare,
extract audio) on phone, tablet and desktop. Inputs: current mockups in
`docs/mockups/`, `src/styles/tokens.css`, `src/styles/app.css`, and the sources
linked below.

Owner decision (2026-10-22): dark is the default theme regardless of system
setting. Light stays available through a header toggle, persisted per viewer.

## 1. What the current UI does

- Light-first, teal primary (`#0b6e66`), marigold trim/"new file" signal. Dark
  exists only via `prefers-color-scheme`, is green-tinted (`#0e1513`) and still
  uses shadows that do little on dark.
- **Start here / End here read as text inputs.** Cause in `app.css`: the base
  `.btn` uses `background: var(--c-surface)` plus `1.5px solid --c-line-strong`,
  the same recipe as the Resolution and Frame rate `<select>` fields, and
  `.trim-readout .btn` sets `justify-content: flex-start`, so a leading icon
  then left-aligned text looks like a search field with a placeholder.
  Share and Pause inherit the same look.

## 2. What reference tools do in common

Layout

- Media first: desktop editors (Clipchamp, Kapwing, CapCut web, Resolve) put a
  large preview, a timeline under it, and a property panel on the right
  ([Kapwing](https://www.kapwing.com/trim-video),
  [Clipchamp](https://support.microsoft.com/clipchamp/how-to-trim-videos-images-or-audio-assets)).
  Phone flows (Photos, iMovie) stack preview, filmstrip, action row.
  videoadjust's layouts already match.

Dark surfaces

- Video tools default to dark, neutral grey chrome so the UI does not tint how
  people see the footage. Practitioners on the Shotcut and Blackmagic forums
  give that as the reason
  ([Shotcut forum](https://forum.shotcut.org/t/ui-design/24549),
  [KDE thread citing Resolve's gray background](https://discuss.kde.org/t/built-in-gray-theme/45385)).
  These are community sources, not vendor docs.
- Depth comes from lighter surfaces, not shadows. Material: "at higher levels
  of elevation, components express depth by displaying lighter surface colors",
  and use dark grey, not black
  ([Material dark theme](https://m2.material.io/design/color/dark-theme)).
  Material 3 replaced overlay elevation with a ladder of surface container roles
  ([Material blog, tone-based surfaces](https://material.io/blog/tone-based-surface-color-m3)).
  Apple uses "base" and "elevated" backgrounds, where elevated is brighter
  ([Apple HIG, Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).
- Linear rebuilt its themes in LCH from three inputs (base, accent, contrast)
  and raised contrast in both default themes
  ([Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)).
  Lesson: even lightness steps from one base, few accents.

Timeline and trim

- One bright, saturated frame around the kept range with grip handles on both
  ends, and dimmed footage outside it. Apple Photos and iMovie use yellow
  handles; holding a handle shows single frames for precise edits
  ([Apple Photos trim](https://support.apple.com/guide/photos/pht6d975c7d/mac)).
  Clipchamp uses green handles that appear on the selected clip.
- A thin, high-contrast playhead separate from the handles; the handles never
  share the playhead colour.
- "Set in/out at playhead" is a command (`I`/`O` in pro editors, `S` to split
  in Clipchamp/Kapwing), shown as a button, never a field-like box.

Export panel

- Summary first, details on demand: HandBrake's Summary tab
  ([BetaNews](https://betanews.com/article/handbrake-revamp/)), CapCut's export
  defaults for resolution, bitrate, frame rate
  ([CapCut help](https://www.capcut.com/help/export-videos-in-capcut)).
  videoadjust's "Ready to export" card plus collapsed "Adjust" follows this.

Compare

- Squoosh: draggable divider between original and result, live preview, size
  saving beside it ([PCWorld](https://www.pcworld.com/article/3195269/googles-free-sqoosh-tool-takes-the-guesswork-out-of-image-compression.html));
  arrow-key nudging with Shift for larger steps
  ([image-comparison](https://github.com/TonySpegel/image-comparison)).
  videoadjust's wipe already matches.

Buttons

- Material 3 ranks buttons by emphasis: filled, then tonal, then outlined, then
  text; one primary per screen
  ([Android FilledTonalButton](https://developer.android.com/reference/kotlin/androidx/compose/material3/FilledTonalButton.composable)).
- Weak signifiers cost users effort: NN/g eye-tracking found more fixations and
  time on pages with weak clickability cues. I read this via secondary write-ups
  ([i-programmer summary](https://www.i-programmer.info/news/146-ui-ux/11106-flat-ui-is-slower.html)),
  not the NN/g article itself.
- Surface fill + outline + leading icon + left-aligned text is the text-field
  pattern. A button needs a distinct fill, centred content, or both.

Accessibility

- WCAG 2.2 SC 2.5.8 (AA): pointer targets at least 24x24 CSS px, or spaced so a
  24px circle does not overlap a neighbour
  ([Deque axe rule](https://dequeuniversity.com/rules/axe/4.8/target-size)).
  Keep the existing 44px minimum (Apple HIG) and 56px for the primary action.
- SC 1.4.11: a boundary that identifies a control, and focus rings, need 3:1.

## 3. Recommended direction

### Theme default and toggle

- **Default: dark**, for every viewer, regardless of system setting (owner
  decision). It also fits the domain: footage reads truer on neutral dark
  chrome, and every reference editor defaults dark.
- **Light: opt-in** via a header toggle.
  - Placement: header right, after the "Stays on this device" pill, same row.
    On phones under 380px wide, the pill shrinks to the lock icon (keep its
    text as the accessible name) so the toggle never wraps.
  - Look: 44x44 tertiary icon button (no fill, no border), 20px icon: sun
    while dark, moon while light. Hover/pressed fill `--c-surface-3`.
  - Accessible name and state: `<button type="button" role="switch"
aria-checked="false">` with visible-text-free label `aria-label="Light
theme"`. `aria-checked` is `true` in light. A switch fits because it sets a
    persistent preference
    ([ARIA switch guidance](https://www.disabilityworld.org/toolkit/standards/aria/switch/)).
    Do not also set `aria-pressed`.
  - Persistence: `localStorage` key `videoadjust-theme` (`dark`|`light`), read
    and write in `try/catch`; on failure stay dark, toggle still works for the
    session.
  - Apply as `data-theme="light"` on `<html>`. Dark tokens live on `:root`,
    light tokens on `:root[data-theme="light"]`. Remove the
    `prefers-color-scheme` block. Set `color-scheme: dark` on `:root` and
    `light` on the light selector so native controls and scrollbars follow.
  - No flash: the CSP has `script-src 'self'` and no `'unsafe-inline'`, so an
    inline head script will not run. Ship a tiny classic (non-module) script,
    for example `public/theme-init.js`, loaded with a plain `<script src>` in
    `<head>` before the stylesheet. Dark users see no flash even without it,
    since dark is the CSS default.
  - Same script sets `<meta name="theme-color">` (`#0e1012` / `#eef2f0`).

### Dark palette (default)

Neutral grey with a slight cool cast, lower chroma than today's green-tinted
neutrals so the chrome does not tint footage. Ratios are WCAG 2.x, computed
with the relative luminance formula.

| Token              | Value                                 | Use                                    | Contrast                     |
| ------------------ | ------------------------------------- | -------------------------------------- | ---------------------------- |
| `--c-bg`           | `#0e1012`                             | page                                   | ink 16.5:1                   |
| `--c-surface-1`    | `#16191c`                             | cards, export panel                    | 1.08:1 vs bg                 |
| `--c-surface-2`    | `#1f2327`                             | segmented track, tonal neutral, inputs | 1.12:1 vs s1                 |
| `--c-surface-3`    | `#2a2f34`                             | selected segment, hover, menus         | 1.31:1 vs s1                 |
| `--c-stage`        | `#08090a`                             | video stage, filmstrip well            |                              |
| `--c-line`         | `#2c3136`                             | decorative dividers only               |                              |
| `--c-line-strong`  | `#6b747c`                             | input and outlined control borders     | 4.0 bg, 3.7 s1, 3.3 s2       |
| `--c-ink`          | `#eceff1`                             | primary text (not pure white)          | 15.3 s1, 11.7 s3             |
| `--c-ink-2`        | `#b6bec5`                             | secondary text                         | 9.4 s1, 8.4 s2               |
| `--c-ink-3`        | `#8d969e`                             | captions, hints                        | 5.9 s1, 5.3 s2, 4.5 s3       |
| `--c-accent`       | `#3ccfbc`                             | primary fill, active states            | 9.1 on s1                    |
| `--c-accent-hover` | `#6adccd`                             | primary hover                          |                              |
| `--c-accent-ink`   | `#04211d`                             | text on accent                         | 8.7 on accent, 10.3 on hover |
| `--c-accent-text`  | `#5ad8c6`                             | accent as text, links                  | 10.2 s1, 9.1 s2              |
| `--c-tonal`        | `#163a36`                             | secondary (tonal) button fill          | 1.42 vs s1                   |
| `--c-tonal-hover`  | `#1d4943`                             | tonal hover                            |                              |
| `--c-tonal-ink`    | `#9cebdf`                             | text on tonal                          | 9.1 on tonal, 7.4 on hover   |
| `--c-trim`         | `#f5b63e`                             | trim frame, handles, "new size" bar    | 9.8 s1, 10.6 bg              |
| `--c-trim-ink`     | `#2a1c00`                             | grip marks, text on trim               | 9.2 on trim                  |
| `--c-success`      | `#5fd394`                             | done state, "90% smaller"              | 9.4 s1                       |
| `--c-success-bg`   | `#12301f`                             | success notice                         | text 7.7                     |
| `--c-warn`         | `#f2c063` on `--c-warn-bg` `#33280f`  | warnings                               | 8.6                          |
| `--c-error`        | `#ff8a80` on `--c-error-bg` `#3a1917` | errors                                 | 6.9 (7.7 on s1)              |
| `--c-focus`        | `#7fe3d6`                             | focus ring                             | 11.7 s1, 12.6 bg             |

Notes

- Surface steps are small (1.08 to 1.31). That is intended: Material and Apple
  both use subtle steps. Where a surface edge identifies a control, add a
  `--c-line` hairline or rely on the label (text identifies a button, so
  SC 1.4.11 does not require the fill edge to reach 3:1).
- Teal stays the action colour, amber the trim signal. Warn adds a tinted
  background and icon so it never reads as a trim handle. Success moves to
  green so "90% smaller" does not look like a link.

### Light palette (opt-in)

Keep today's light tokens (already checked): ink `#13201d` 14.9:1 on bg,
line-strong `#7a8a85` 3.2:1 on bg, white on accent `#0b6e66` 6.1:1, accent
text `#0a625b` 7.2:1 on white. Add tonal `#d4ebe7` with ink `#0a524c` (7.2:1)
and `--c-surface-3: #d6dfdb`. Light keeps soft shadows for elevation.

### Typography

System stacks only (no web fonts, the app is self-contained). Keep the current
three stacks. Changes:

- Use `ui-rounded` only for the wordmark and hero figure, not card titles.
- Weights 400/600/700; drop 800 (heavy weights bloom on dark).
- `font-variant-numeric: tabular-nums` on every time and size so values do not
  jitter while scrubbing.
- Keep the 13/15/17/21/28/40 scale; body line-height 1.5 on dark.

### Shape, spacing, elevation

- Spacing: keep the 4px base scale.
- Radius: cards 16px (down from 22), buttons and inputs 10px, segmented
  track 12px with 8px segments, chips and pills full. Video stage 12px. The
  softer, larger radii read as a light consumer theme; tighter radii match
  editor UIs.
- Elevation on dark: surfaces only, no `--shadow-card`. One exception: menus
  and popovers get `surface-3` plus a 1px `--c-line` border plus
  `0 8px 24px rgb(0 0 0 / 40%)`.
- Focus: `0 0 0 2px var(--c-bg), 0 0 0 4px var(--c-focus)` on every control.

### Button hierarchy

| Level             | Look (dark)                                                             | Used for                                                     |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Primary (filled)  | `--c-accent` fill, `--c-accent-ink` 600 text, 56px tall, no border      | Export, Extract audio, Download. One per view.               |
| Secondary (tonal) | `--c-tonal` fill, `--c-tonal-ink` text, 44px, no border                 | Start here, End here, Share, Pause/Play                      |
| Neutral tonal     | `--c-surface-2` fill (on s1) or `--c-surface-3` (on s2), `--c-ink` text | Less important actions inside cards                          |
| Tertiary (text)   | No fill, no border, `--c-accent-text`, hover adds `surface-3` fill      | Make it smaller, Start over, Reset to Balanced, theme toggle |

Rules: buttons never use `--c-line-strong` borders; that border belongs to
form fields only (selects, number inputs). Content in buttons is centred.
Pressed state: darken fill one step and `transform: scale(0.98)`, disabled
under reduced motion.

### Fix for Start here / End here

- Change `.trim-readout .btn` to the secondary tonal style: fill `--c-tonal`,
  no border, text `--c-tonal-ink`, weight 600, `justify-content: center`.
- Keep the icons (`|<-` and `->|`). Label stays "Start here" / "End here";
  the accessible name can add context: "Set start to playhead (0:12.4)".
- Put the time value and its button in one block: label "Start", value
  `0:03.2` (tabular, 21px), button under it at full column width. Same for
  End. That makes the button read as the action on that value.
- Optional: keyboard `I` and `O` set start and end, matching pro editors.
  Document it in the help text if added.

### Trim bar

- Filmstrip on `--c-stage`, 56px tall on phone, 64px desktop.
- Kept range: 3px `--c-trim` frame top and bottom, 16px-wide handles with two
  `--c-trim-ink` grip lines, outer corners rounded 8px. Hit area for each
  handle at least 44x56 (extend invisibly beyond the visual).
- Outside range: `rgb(0 0 0 / 60%)` scrim over thumbnails, not a colour tint.
- Playhead: 2px `--c-ink` line with a 12px knob, plus a 1px dark outline so it
  shows over bright frames. Never amber.
- Dragging shows a time chip above the handle (`surface-3`, tabular). Handles
  keep `role="slider"`, arrow steps 0.1s (Shift 1s), time `aria-valuetext`.

### Tabs and segmented controls

- Mode switch (Shrink video / Extract audio): segmented control. Track
  `--c-surface-2`, selected segment `--c-surface-3` with `--c-ink` text and
  the icon in `--c-accent-text`; unselected text `--c-ink-2`. 44px tall.
  Keep `role="tablist"` if it swaps panels, `radiogroup` if it only sets a
  value.
- Option groups (MP4/WebM, H.264/HEVC/AV1, quality): same component, 40px
  visual height inside a 44px target. Unavailable options: `--c-ink-3` text
  and a short reason under the group (as today), not strikethrough alone.

### Cards

- Export panel and result table: `--c-surface-1`, 16px radius, 1px
  `--c-line` border, no shadow. Inner sections split by `--c-line` dividers.
- Size bars: original as `--c-surface-3` hatched, new as solid `--c-trim`.
- Notices (warn, error, success): tinted background token, matching text
  token, leading icon, 12px radius.

## 4. Changes ranked by impact

1. Restyle Start here / End here (and Share, Pause) as tonal buttons with
   centred content and no field border. Fixes the reported affordance bug.
2. Make dark the default, add the header theme toggle with `localStorage`
   persistence and a pre-paint script compatible with the CSP.
3. Replace the dark palette with the neutral tokens above, add
   `--c-surface-3`, drop shadows on dark, move elevation to surface steps.
4. Formalise the button hierarchy (filled, tonal, text) and reserve
   `--c-line-strong` borders for form fields.
5. Trim bar refinements: larger handle hit areas, scrim outside range, neutral
   playhead, drag time chip.
6. Tabular numbers on all times and sizes.
7. Tighter radii (16/10/8) and weight cleanup (drop 800).
8. Unify segmented controls; success to green, warn tinted with an icon.
9. Refresh the mockups, dark first.

## 5. Open questions for the owner

- Should the toggle be two-state (dark, light) as specified, or three-state
  (dark, light, follow system)? Two-state matches the decision as given.
- Add `I` / `O` keyboard shortcuts for set start / set end?
- Keep teal as the brand accent, or move to a less green hue to further
  reduce tint next to footage? This doc assumes teal stays.
