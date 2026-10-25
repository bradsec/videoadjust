import { readFileSync } from 'node:fs';
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { expect, it } from 'vitest';
import { shrinkJob } from '../../src/core/convert';
import type { Settings } from '../../src/core/types';

const settings: Settings = {
  container: 'mp4',
  passthrough: true,
  trim: { start: 0.7, end: 1.7 },
  video: { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 2_000_000 },
  audio: null,
};

it('Mediabunny fast MP4 trim retains encoded footage from the preceding keyframe', async () => {
  const input = new Input({
    source: new BufferSource(
      readFileSync(new URL('../fixtures/land-1080p30-aac.mp4', import.meta.url)),
    ),
    formats: ALL_FORMATS,
  });
  const target = new BufferTarget();
  let result: Input | undefined;
  try {
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat(), target }),
      ...shrinkJob(settings).options,
      showWarnings: false,
    });
    expect(conversion.isValid).toBe(true);
    await conversion.execute();
    result = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS });
    const video = await result.getPrimaryVideoTrack();
    const packet = await new EncodedPacketSink(video!).getFirstPacket();
    expect(packet?.type).toBe('key');
    expect(packet?.timestamp).toBeCloseTo(-0.7);
  } finally {
    result?.dispose();
    input.dispose();
  }
});

it('Exact forces video encoding while retaining audio copy options', () => {
  const job = shrinkJob({
    ...settings,
    trimPrecision: 'exact',
    audio: { codec: 'aac', bitrate: 128000, channels: 2, copy: true },
  });
  expect(job.copiesVideo).toBe(false);
  expect(job.options.video).toMatchObject({ forceTranscode: true });
  expect(job.options.audio).toEqual({});
});
