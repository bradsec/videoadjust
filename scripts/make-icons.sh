#!/usr/bin/env bash
# Regenerates public/ icons from scripts/icons/*.svg. Needs inkscape and ImageMagick.
# icon.svg is the bold-outline mark for small sizes; icon-app.svg the framed mark for app
# icons. The va glyphs are Inter Bold outlines. Maskable art keeps the mark inside the
# central 80% safe zone on a full-bleed background.
set -euo pipefail
cd "$(dirname "$0")/.."
png() { inkscape "$1" --export-type=png --export-filename="$3" -w "$2" -h "$2" >/dev/null 2>&1; }
png scripts/icons/icon.svg 16 public/favicon-16x16.png
png scripts/icons/icon.svg 32 public/favicon-32x32.png
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
png scripts/icons/icon.svg 48 "$tmp/icon-48.png"
png scripts/icons/icon-maskable.svg 180 public/apple-touch-icon.png  # opaque: iOS fills transparency with black
png scripts/icons/icon-app.svg 192 public/android-chrome-192x192.png
png scripts/icons/icon-app.svg 512 public/android-chrome-512x512.png
png scripts/icons/icon-maskable.svg 512 public/android-chrome-maskable-512x512.png
convert public/favicon-16x16.png public/favicon-32x32.png "$tmp/icon-48.png" public/favicon.ico
cp scripts/icons/icon.svg public/icon.svg
