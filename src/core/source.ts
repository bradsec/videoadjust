import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { SourceInfo } from './types';

export class UnsupportedSourceError extends Error {
  constructor(public readonly codec: string | null, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsupportedSourceError';
  }
}

function describeCodec(codec: string | null): string {
  return codec ? `the ${codec} codec` : 'an unrecognised codec';
}

export async function readSource(file: File): Promise<{ info: SourceInfo; input: Input }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    return { info: await describe(file, input), input };
  } catch (err) {
    input.dispose();
    throw err;
  }
}

async function describe(file: File, input: Input): Promise<SourceInfo> {
  let videoTrack, audioTrack;
  try {
    [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
  } catch (err) {
    // Mediabunny throws when no known container matches the bytes.
    throw new UnsupportedSourceError(null, 'This file is not a video this browser can read.', { cause: err });
  }

  const video = videoTrack
    ? await (async () => {
        const [codec, decodable, displayWidth, displayHeight, rotation, stats] = await Promise.all([
          videoTrack.getCodec(),
          videoTrack.canDecode(),
          videoTrack.getDisplayWidth(),
          videoTrack.getDisplayHeight(),
          videoTrack.getRotation(),
          videoTrack.computePacketStats(),
        ]);
        return {
          codec,
          decodable,
          displayWidth,
          displayHeight,
          rotation,
          fps: stats.averagePacketRate,
          bitrate: stats.averageBitrate > 0 ? stats.averageBitrate : null,
        };
      })()
    : null;

  const audio = audioTrack
    ? await (async () => {
        const [codec, decodable, channels, sampleRate, stats] = await Promise.all([
          audioTrack.getCodec(),
          audioTrack.canDecode(),
          audioTrack.getNumberOfChannels(),
          audioTrack.getSampleRate(),
          audioTrack.computePacketStats(),
        ]);
        return { codec, decodable, channels, sampleRate, bitrate: stats.averageBitrate > 0 ? stats.averageBitrate : null };
      })()
    : null;

  if (!video?.decodable && !audio?.decodable) {
    const codec = video?.codec ?? audio?.codec ?? null;
    throw new UnsupportedSourceError(
      codec,
      video || audio
        ? `This browser cannot decode ${describeCodec(codec)} used by this file.`
        : 'This file has no video or audio track.',
    );
  }

  const [containerMime, durationSec] = await Promise.all([input.getMimeType(), input.computeDuration()]);
  return { name: file.name, sizeBytes: file.size, durationSec, containerMime, video, audio };
}
