# Changelog

Newest releases appear first. Version numbers match `package.json`.

## [0.22.25] - 2026-10-27

### Changed

- On phones, hid the styled preview label and made Show original a single fixed switch pill.

## [0.22.24] - 2026-10-27

### Fixed

- Kept the styled preview frame and corner pills in place when showing the original. On phones, narrow frames place the style label below the fixed button and hide it in original view.

## [0.22.23] - 2026-10-27

### Fixed

- Kept About's Close button visible on phones and returned focus to the About button after closing.

## [0.22.22] - 2026-10-27

### Fixed

- Removed empty gaps between Help sections on desktop.

## [0.22.21] - 2026-10-27

### Added

- Added a Help dialog with tools, trim controls, shortcuts, settings, and export guidance.

## [0.22.20] - 2026-10-27

### Fixed

- Kept only the video pinned on phones, with compact styled preview controls below it and Show original on the stage.

## [0.22.19] - 2026-10-27

### Fixed

- Kept the phone preview pinned through the Prepare inspector and added space below its bottom edge.

## [0.22.18] - 2026-10-27

### Changed

- Moved kept duration to the Trim header and grouped frame steps around a playhead time readout with hundredths, so each frame step shows.

## [0.22.17] - 2026-10-27

### Changed

- Kept the capped video preview visible above Trim controls while scrolling on phones.

## [0.22.16] - 2026-10-27

### Added

- Added previous and next frame controls beside the kept duration, with comma and period shortcuts across all three tools.

## [0.22.15] - 2026-10-27

### Fixed

- Muted GIF preview audio from the video and mixed tracks, and restored the player's previous mute state when switching tools.

## [0.22.14] - 2026-10-27

### Changed

- Compacted the Trim start and end controls into a row below the waveform, with the kept duration between them.

## [0.22.13] - 2026-10-26

### Fixed

- Styled live preview stuttered on iPhone/iPad Safari because each frame went video -> 2D canvas -> texImage2D(canvas), costing 14-56 ms per frame on device. The preview now uploads the video element directly (1.4-2.3 ms), applies crop, rotation and mirroring in a GPU pass, and uses a WebGL context that does not preserve its drawing buffer. The smaller render size in 0.22.11 did not fix the stutter.

## [0.22.12] - 2026-10-26

### Changed

- Replaced app icons with Lucide icons and gave GIF its own tab icon.
- Hid Theater mode on touch tablets where it barely changed the layout.

## [0.22.11] - 2026-10-26

### Changed

- Rendered styled and GIF previews at display size, capped by output size, to reduce preview work.

## [0.22.10] - 2026-10-25

Maintenance release; no app behavior changed.

## [0.22.9] - 2026-10-25

### Added

- Added a boomerang GIF loop option.

## [0.22.8] - 2026-10-25

### Fixed

- Applied the selected GIF colour palette in the live preview.

## [0.22.7] - 2026-10-25

### Changed

- Updated the About dialog's support link to Ko-fi.

## [0.22.6] - 2026-10-25

### Fixed

- Named GIF downloads `-animated.gif` instead of `-gif.gif`.
- Removed the duplicate format label from GIF results.

## [0.22.5] - 2026-10-25

### Fixed

- Kept the Export button label consistent for copied and re-encoded exports.

## [0.22.4] - 2026-10-25

Maintenance release; no app behavior changed.

## [0.22.3] - 2026-10-25

### Fixed

- Kept user fonts selected and showed an error when deleting their saved copy failed.
- Reported user fonts as saved only after storage committed.
- Named the saved file when sharing a disk-streamed export failed.

## [0.22.2] - 2026-10-25

Maintenance release; no app behavior changed.

## [0.22.1] - 2026-10-25

### Added

- Added Reset trim and Reset original audio controls.

### Changed

- Centered 0 dB on track volume sliders.

## [0.22.0] - 2026-10-25

### Changed

- Led app and site copy with private, local video editing and clarified large-file handling.
- Kept comparison labels near the wipe line and waveform lanes stable while loading.
- Showed mixed-audio loudness measurement progress and kept iOS toasts from pausing after a tap.

## [0.21.4] - 2026-10-25

### Fixed

- Kept overlay percentage values and their `%` unit inside one field.

## [0.21.3] - 2026-10-25

### Fixed

- Kept Edit controls from overlapping on phones.

## [0.21.2] - 2026-10-25

### Fixed

- Scheduled added audio on the audio clock to stop preview stutter from repeated seeks.

### Added

- Allowed negative added-track offsets and dragging or keyboard nudging of its waveform lane.

## [0.21.1] - 2026-10-25

### Changed

- Moved audio waveform lanes beneath the trim filmstrip.

## [0.21.0] - 2026-10-25

### Added

- Mixed original and added audio with per-track volume, offsets, looping and live preview.
- Added per-track waveforms, Reset all, and toast confirmations.

### Changed

- Grouped inspector settings into sections with change counts.
- Matched preview resolution and frame rate to lower output settings.
- Stripped source metadata by default.

## [0.20.1] - 2026-10-25

### Changed

- Replaced gain and fade fields with live sliders and accessible value readouts.

## [0.20.0] - 2026-10-25

### Added

- Added audio gain, fades and loudness normalization with audible preview.
- Added exposure, contrast, saturation and temperature controls.
- Added exact trim and saving the edited current frame as PNG or JPEG.

### Fixed

- Warned when an export saved without its selected style after a renderer failure.

## [0.19.0] - 2026-10-25

### Added

- Labeled the selected style over the live preview.

### Changed

- Adapted trim thumbnails to strip width and aspect ratio.
- Scaled grain size with output resolution.

## [0.18.1] - 2026-10-25

### Changed

- Combined trim time readouts with editable fields and compact Set buttons.

## [0.18.0] - 2026-10-25

### Added

- Added desktop Theater mode, a timeline ruler, scrubbing and typed trim times.

## [0.17.4] - 2026-10-25

### Changed

- Renamed the style panel heading to Style Filter.

## [0.17.3] - 2026-10-25

### Changed

- Refined glitch, bloom, diffusion, black-and-white, duotone and cinematic looks.

## [0.17.2] - 2026-10-25

### Added

- Added tape, chroma and sync artifacts to the VHS style.

## [0.17.1] - 2026-10-25

### Changed

- Softened VHS and glitch effects and strengthened soft diffusion.

## [0.17.0] - 2026-10-25

### Added

- Added ten WebGL video styles for live preview and video or GIF export.

## [0.16.5] - 2026-10-24

### Changed

- Enlarged and centered the desktop drop zone and moved About to the header.

## [0.16.4] - 2026-10-24

### Changed

- Showed the app name beside the footer version and shortened the About button.

## [0.16.3] - 2026-10-24

### Fixed

- Moved focus into the prepare and editor views when they opened.
- Added click and tap placement controls for crop and overlays, with larger targets.
- Explained blocked GIF export beside the phone and tablet action button.

## [0.16.2] - 2026-10-24

### Changed

- Lowercased the app name across the interface and made About a footer button.

## [0.16.1] - 2026-10-24

### Changed

- Linked the footer icon and version to the repository.

## [0.16.0] - 2026-10-24

### Added

- Added a support link to the About dialog.

## [0.15.0] - 2026-10-24

### Added

- Added crop and overlay position resets and hover tips for settings and editors.

### Changed

- Grouped overlay controls and kept Show original in the same preview controls.

## [0.14.0] - 2026-10-24

### Changed

- Made the desktop inspector scroll independently so the preview stays visible.

## [0.13.0] - 2026-10-24

### Added

- Paired overlay percentage sliders with precise number fields and accessible value readouts.

## [0.12.0] - 2026-10-24

### Added

- Showed rotation, mirroring, crop and overlays live in preview, with a Show original toggle.

## [0.11.4] - 2026-10-24

### Fixed

- Preserved GIF settings after transform edits and accepted source-capped frame rates.
- Copied AAC only when channel count stayed the same and skipped needless encoder checks for copied video.
- Kept the precached page for offline navigation and removed deleted custom fonts from the document.

## [0.11.3] - 2026-10-24

### Fixed

- Scrolled to the top when switching screens.

## [0.11.2] - 2026-10-23

### Changed

- Kept rotation, mirroring and crop controls in the visual editor only.

## [0.11.1] - 2026-10-23

### Fixed

- Prevented iOS tap and focus zoom.

## [0.11.0] - 2026-10-23

### Added

- Previewed exports saved directly to disk on the result screen.

### Changed

- Clarified export completion times and warning colours.

## [0.10.2] - 2026-10-23

### Fixed

- Limited GIF exports to 30 seconds and explained the limit beside Export GIF.

## [0.10.1] - 2026-10-23

### Fixed

- Restored the footer version and tightened footer and About typography.

## [0.10.0] - 2026-10-23

### Changed

- Switched to a dark-only theme, cool grey palette and new app mark.
- Added an About dialog with version, offline use, credits and licences.

## [0.9.3] - 2026-10-23

### Changed

- Turned checkboxes into accessible switches and reorganized overlay settings.
- Showed Position overlay only when content could be moved.

## [0.9.2] - 2026-10-23

### Changed

- Put file details first and moved crop and overlay editors into the preview area.

## [0.9.1] - 2026-10-23

### Fixed

- Showed an expected size range while an in-memory export was still assembling.

### Changed

- Renamed the overlay Legibility control to Text effect.

## [0.9.0] - 2026-10-23

### Added

- Added text and image overlays to video and GIF exports, with bundled or saved custom fonts.
- Added drag and keyboard controls for overlay placement.

## [0.8.0] - 2026-10-23

### Added

- Added target file sizes for Shrink, with automatic bitrate and resolution adjustment and a smaller retry after overshoot.

## [0.7.2] - 2026-10-23

### Changed

- Made GIF Size set the long edge and lowered default size and colour count.

## [0.7.1] - 2026-10-23

### Added

- Added GIF file-size modes that use delta frames for smaller animations.

## [0.7.0] - 2026-10-23

### Added

- Added animated GIF export with trim, transform, size, frame-rate, loop and colour controls.

## [0.6.0] - 2026-10-23

### Added

- Added a visual crop and rotate editor with presets, handles and keyboard controls.

### Fixed

- Prevented squashed cropped exports in WebKit.

## [0.5.0] - 2026-10-23

### Added

- Added rotate, mirror, crop, output metadata, keyframe interval and source diagnostics.

## [0.4.1] - 2026-10-23

### Fixed

- Corrected tablet, phone, result and progress layouts after visual review.

## [0.4.0] - 2026-10-22

### Changed

- Redesigned the app as a canvas and inspector workspace with an ink and chartreuse palette.

## [0.3.1] - 2026-10-22

### Changed

- Renamed the app VideoAdjust and updated its interface and icons.

### Fixed

- Kept trim and comparison time counters from changing width during playback.

## [0.3.0] - 2026-10-22

### Added

- Added Extract audio with MP3, M4A and WAV export, audio settings and a result player.

### Fixed

- Kept MP3 duration and seeking data in files saved directly to disk.

## [0.2.0] - 2026-10-22

### Changed

- Renamed the app videomate and broadened its copy beyond shrinking videos for sharing.
- Added the version and repository link to the footer.

## [0.1.0] - 2026-10-22

### Added

- Added private browser-based video conversion with automatic settings, trim, progress, results and comparison.
- Added offline support and direct-to-disk output where available.

### Fixed

- Rejected undecodable video and preserved quality across size changes.
