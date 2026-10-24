#!/usr/bin/env bash
# Generates small test videos into tests/fixtures with ffmpeg lavfi sources.
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures"
mkdir -p "$out"
ff() { ffmpeg -y -loglevel error "$@"; }

# 1080p30, H.264 + AAC stereo, 3 s
ff -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 3 -c:v libx264 -preset veryfast -b:v 200k -pix_fmt yuv420p -c:a aac -b:a 128k -ac 2 \
  "$out/land-1080p30-aac.mp4"

# 4K60, 2 s
ff -f lavfi -i testsrc2=size=3840x2160:rate=60 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 2 -c:v libx264 -preset veryfast -b:v 300k -pix_fmt yuv420p -c:a aac -b:a 128k -ac 2 \
  "$out/land-4k60-aac.mp4"

# Portrait phone clip: coded 1920x1080 with a 90 degree display rotation (displays 1080x1920)
ff -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 3 -c:v libx264 -preset veryfast -b:v 200k -pix_fmt yuv420p -c:a aac -b:a 128k -ac 2 \
  "$out/.portrait-src.mp4"
ff -display_rotation 90 -i "$out/.portrait-src.mp4" -c copy "$out/portrait-rot90.mp4"
rm "$out/.portrait-src.mp4"

# No audio track
ff -f lavfi -i testsrc2=size=1280x720:rate=30 -t 3 -an \
  -c:v libx264 -preset veryfast -b:v 200k -pix_fmt yuv420p "$out/noaudio.mp4"

# Mono AAC
ff -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=44100 \
  -t 3 -c:v libx264 -preset veryfast -b:v 200k -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 \
  "$out/mono-aac.mp4"

# VP9 + Opus in WebM
ff -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 3 -c:v libvpx-vp9 -b:v 200k -deadline realtime -cpu-used 8 -c:a libopus -b:a 96k \
  "$out/vp9-opus.webm"

# Already small: 640x360 at 300 kbps
ff -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 3 -c:v libx264 -preset veryfast -b:v 300k -maxrate 300k -bufsize 600k -pix_fmt yuv420p \
  -c:a aac -b:a 64k -ac 2 "$out/small-h264-lowbitrate.mp4"

# Green centre is exactly the square crop of this 16:9 frame; red and blue reveal stretching.
ff -f lavfi -i "color=c=green:s=640x360:r=30:d=1,drawbox=x=0:y=0:w=140:h=360:color=red:t=fill,drawbox=x=500:y=0:w=140:h=360:color=blue:t=fill" \
  -an -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out/crop-bands.mp4"
# 31 s, past the GIF length limit, so the GIF tab shows its blocked-export warning.
ff -f lavfi -i "color=c=gray:s=320x180:r=10:d=31" \
  -an -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p "$out/long-31s.mp4"
