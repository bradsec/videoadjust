import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import type { AddedAudio } from './audioMix';

export async function readAddedAudio(file: File, signal: AbortSignal): Promise<AddedAudio> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const stop = () => input.dispose();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error('This file has no decodable audio.');
    const samples = new AudioSampleSink(track).samples();
    try {
      const first = await samples.next();
      if (first.done) throw new Error('This file has no decodable audio samples.');
      first.value.close();
    } finally {
      await samples.return();
    }
    const [duration, channels, sampleRate] = await Promise.all([
      track.computeDuration(),
      track.getNumberOfChannels(),
      track.getSampleRate(),
    ]);
    signal.throwIfAborted();
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error('This file has no decodable audio duration.');
    return { file, input, duration, channels, sampleRate };
  } catch (error) {
    input.dispose();
    signal.throwIfAborted();
    throw new Error('This file has no decodable audio. Choose another audio or video file.', {
      cause: error,
    });
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
