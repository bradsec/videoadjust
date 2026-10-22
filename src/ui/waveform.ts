import { AudioSampleSink, type Input } from 'mediabunny';

/** Largest absolute sample per bin across all channels, clamped to 0..1. */
export function peaksFromSamples(channels: Float32Array[], bins: number): Float32Array {
  const peaks = new Float32Array(bins);
  const length = channels[0]?.length ?? 0;
  if (length === 0) return peaks;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const bin = Math.min(bins - 1, Math.floor((i * bins) / length));
      const v = Math.abs(data[i]!);
      if (v > peaks[bin]!) peaks[bin] = Math.min(1, v);
    }
  }
  return peaks;
}

/**
 * Peaks of the source's primary audio track over the trim, or null if it cannot be decoded or
 * the signal aborts. Peaks are merged bin by bin as samples arrive, so memory stays flat.
 */
export async function computePeaks(
  input: Input,
  trim: { start: number; end: number },
  bins: number,
  signal: AbortSignal,
): Promise<Float32Array | null> {
  const span = trim.end - trim.start;
  if (span <= 0 || bins <= 0) return null;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new AudioSampleSink(track);
    const peaks = new Float32Array(bins);
    for await (const sample of sink.samples(trim.start, trim.end)) {
      if (signal.aborted) {
        sample.close();
        return null;
      }
      try {
        const frames = sample.numberOfFrames;
        const channels: Float32Array[] = [];
        for (let c = 0; c < sample.numberOfChannels; c++) {
          const plane = new Float32Array(frames);
          sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          channels.push(plane);
        }
        // A sample can straddle a trim edge; each frame goes in the bin of its own time.
        const rate = sample.sampleRate;
        for (const plane of channels) {
          for (let i = 0; i < frames; i++) {
            const t = sample.timestamp + i / rate - trim.start;
            if (t < 0 || t >= span) continue;
            const bin = Math.min(bins - 1, Math.floor((t / span) * bins));
            const v = Math.abs(plane[i]!);
            if (v > peaks[bin]!) peaks[bin] = Math.min(1, v);
          }
        }
      } finally {
        sample.close();
      }
    }
    return signal.aborted ? null : peaks;
  } catch (err) {
    if (!signal.aborted) console.warn('computing the waveform failed', err);
    return null;
  }
}
