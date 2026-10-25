import { expect, it } from 'vitest';
import type { SourceInfo } from '../../src/core/types';
import { videoStatsLabel } from '../../src/ui/viewSummaries';

const source: SourceInfo = {
  name: 'clip.mp4',
  sizeBytes: 100,
  durationSec: 1,
  containerMime: 'video/mp4',
  video: {
    codec: 'avc',
    decodable: true,
    displayWidth: 320,
    displayHeight: 180,
    rotation: 0,
    fps: 30,
    bitrate: 1000,
  },
  audio: null,
};

it('shows the video and container labels once when their displayed strings match', () => {
  expect(
    videoStatsLabel({
      ...source,
      video: { ...source.video!, codec: 'gif' },
      containerMime: 'image/gif',
    }),
  ).toBe('GIF');
  expect(videoStatsLabel(source)).toBe('H.264, MP4');
  expect(videoStatsLabel({ ...source, video: null })).toBe('No video, MP4');
  expect(
    videoStatsLabel({
      ...source,
      video: { ...source.video!, codec: 'webm' },
      containerMime: 'video/webm',
    }),
  ).toBe('WEBM, WebM');
});
