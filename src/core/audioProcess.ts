import {
  AudioSample,
  AudioSampleSink,
  type Input,
  type InputAudioTrack,
  type ConversionAudioOptions,
} from 'mediabunny';

export interface AudioProcessing {
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  normalize: -14 | -16 | -23 | null;
}

export const SAMPLE_CEILING = 10 ** (-1 / 20);
export const dbGain = (db: number): number => 10 ** (db / 20);
const finite = (n: number | undefined) => (Number.isFinite(n) ? n! : 0);

export function normalizeAudioProcessing(
  value: Partial<AudioProcessing> = {},
  duration: number,
): AudioProcessing {
  const span = Math.max(0, finite(duration));
  let fadeIn = Math.min(span, Math.max(0, finite(value.fadeIn)));
  let fadeOut = Math.min(span, Math.max(0, finite(value.fadeOut)));
  const sum = fadeIn + fadeOut;
  if (sum > span) {
    fadeIn *= span / sum;
    fadeOut *= span / sum;
  }
  return {
    gainDb: Math.min(20, Math.max(-20, finite(value.gainDb))),
    fadeIn,
    fadeOut,
    normalize:
      value.normalize === -14 || value.normalize === -16 || value.normalize === -23
        ? value.normalize
        : null,
  };
}

export function hasAudioProcessing(value?: Partial<AudioProcessing>): boolean {
  const s = normalizeAudioProcessing(value, Number.MAX_VALUE);
  return !!(s.gainDb || s.fadeIn || s.fadeOut || s.normalize);
}

type Coefficients = [number, number, number, number, number];

// Bilinear transforms of the BS.1770-4 K-weighting stages, matched to its 48 kHz coefficients.
function kWeighting(rate: number): [Coefficients, Coefficients] {
  const k = Math.tan((Math.PI * 1681.974450955533) / rate);
  const q = 0.7071752369554196;
  const vh = dbGain(3.999843853973347);
  const vb = vh ** 0.4996667741545416;
  const a = 1 + k / q + k * k;
  const shelf: Coefficients = [
    (vh + (vb * k) / q + k * k) / a,
    (2 * (k * k - vh)) / a,
    (vh - (vb * k) / q + k * k) / a,
    (2 * (k * k - 1)) / a,
    (1 - k / q + k * k) / a,
  ];
  const h = Math.tan((Math.PI * 38.13547087602444) / rate);
  const d = 1 + h / 0.5003270373238773 + h * h;
  return [shelf, [1, -2, 1, (2 * (h * h - 1)) / d, (1 - h / 0.5003270373238773 + h * h) / d]];
}

function biquad(coefficients: Coefficients): (x: number) => number {
  const [b0, b1, b2, a1, a2] = coefficients;
  let z1 = 0;
  let z2 = 0;
  return (x) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

const lufs = (energy: number) => -0.691 + 10 * Math.log10(energy);

export class LoudnessMeter {
  private readonly filters;
  private readonly weights: number[];
  private readonly ring: Float64Array;
  private readonly hop: number;
  private readonly blocks: number[] = [];
  private frames = 0;
  private sum = 0;

  constructor(rate: number, channels: number) {
    if (
      !Number.isFinite(rate) ||
      rate < 8000 ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 8
    )
      throw new Error('Unsupported loudness sample rate or channel layout.');
    const [shelf, highpass] = kWeighting(rate);
    this.filters = Array.from(
      { length: channels },
      () => [biquad(shelf), biquad(highpass)] as const,
    );
    // Web Audio channel order: L, R, C, LFE, surrounds. Quad has no centre or LFE.
    this.weights =
      channels === 4
        ? [1, 1, 1.41, 1.41]
        : channels === 5
          ? [1, 1, 1, 1.41, 1.41]
          : Array.from({ length: channels }, (_, c) => (c === 3 ? 0 : c >= 4 ? 1.41 : 1));
    this.hop = Math.round(rate * 0.1);
    this.ring = new Float64Array(this.hop * 4);
  }

  add(channels: Float32Array[]): void {
    if (
      channels.length !== this.filters.length ||
      channels.some((p) => p.length !== channels[0]!.length)
    )
      throw new Error('Loudness channel layout changed.');
    for (let i = 0; i < channels[0]!.length; i++) {
      let energy = 0;
      for (let c = 0; c < channels.length; c++) {
        const [shelf, highpass] = this.filters[c]!;
        const y = highpass(shelf(channels[c]![i]!));
        energy += this.weights[c]! * y * y;
      }
      const index = this.frames % this.ring.length;
      this.sum += energy - this.ring[index]!;
      this.ring[index] = energy;
      this.frames++;
      if (this.frames >= this.ring.length && this.frames % this.hop === 0)
        this.blocks.push(Math.max(0, this.sum / this.ring.length));
    }
  }

  integrated(): number {
    const absolute = this.blocks.filter((e) => lufs(e) > -70);
    if (!absolute.length) return -Infinity;
    const mean = (blocks: number[]) => blocks.reduce((sum, e) => sum + e, 0) / blocks.length;
    const relative = lufs(mean(absolute)) - 10;
    const gated = absolute.filter((e) => lufs(e) > relative);
    return gated.length ? lufs(mean(gated)) : -Infinity;
  }
}

/** Linear fade gain at `time` seconds into the kept range; shared by export and the live preview. */
export function fadeEnvelope(settings: AudioProcessing, time: number, duration: number): number {
  return Math.max(
    0,
    Math.min(
      1,
      settings.fadeIn ? time / settings.fadeIn : 1,
      settings.fadeOut ? (duration - time) / settings.fadeOut : 1,
    ),
  );
}

export function processPcm(
  channels: Float32Array[],
  rate: number,
  timestamp: number,
  duration: number,
  settings: AudioProcessing,
  normalizationDb = 0,
): void {
  const gain = dbGain(settings.gainDb + normalizationDb);
  for (let i = 0; i < (channels[0]?.length ?? 0); i++) {
    const fade = fadeEnvelope(settings, timestamp + i / rate, duration);
    for (const plane of channels)
      plane[i] = Math.max(-SAMPLE_CEILING, Math.min(SAMPLE_CEILING, plane[i]! * gain * fade));
  }
}

function planes(sample: AudioSample, start = 0, end = sample.numberOfFrames): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, c) => {
    const data = new Float32Array(end - start);
    sample.copyTo(data, {
      planeIndex: c,
      format: 'f32-planar',
      frameOffset: start,
      frameCount: end - start,
    });
    return data;
  });
}

// Match Mediabunny 1.62's Web Audio downmix before measuring the selected output channels.
function downmix(data: Float32Array[], channels: number): Float32Array[] {
  const n = data.length;
  if (n === channels) return data;
  return Array.from({ length: channels }, (_, c) =>
    Float32Array.from(data[0]!, (_, i) => {
      const at = (channel: number) => data[channel]?.[i] ?? 0;
      if (n === 1) return at(0);
      if (n === 2 && channels === 1) return (at(0) + at(1)) / 2;
      if (n === 4)
        return channels === 1 ? (at(0) + at(1) + at(2) + at(3)) / 4 : (at(c) + at(c + 2)) / 2;
      if (n === 6)
        return channels === 1
          ? Math.SQRT1_2 * (at(0) + at(1)) + at(2) + (at(4) + at(5)) / 2
          : at(c) + Math.SQRT1_2 * (at(2) + at(c + 4));
      return at(c);
    }),
  );
}

export function createAudioProcessor(
  value: Partial<AudioProcessing>,
  trim: { start: number; end: number },
  channels: number,
) {
  const duration = trim.end - trim.start;
  const settings = normalizeAudioProcessing(value, duration);
  let normalizationDb = 0;
  return {
    async prepare(
      input: Input,
      signal: AbortSignal,
      progress: (p: number) => void,
      audioTrack?: InputAudioTrack,
    ): Promise<void> {
      signal.throwIfAborted();
      if (settings.normalize === null) return;
      const track = audioTrack ?? (await input.getPrimaryAudioTrack());
      if (!track) throw new Error('Audio processing needs an audio track.');
      let meter: LoudnessMeter | undefined;
      let rate: number | undefined;
      let nextFrame = 0;
      let peak = 0;
      const samples = new AudioSampleSink(track).samples(trim.start, trim.end);
      try {
        for await (const sample of samples) {
          try {
            signal.throwIfAborted();
            if (rate !== undefined && rate !== sample.sampleRate)
              throw new Error('Audio sample rate changed during loudness analysis.');
            rate = sample.sampleRate;
            meter ??= new LoudnessMeter(rate, channels);
            const start = Math.max(0, Math.round((trim.start - sample.timestamp) * rate));
            const end = Math.min(
              sample.numberOfFrames,
              Math.round((trim.end - sample.timestamp) * rate),
            );
            if (start >= end) continue;
            const at = Math.max(0, Math.round((sample.timestamp - trim.start) * rate) + start);
            while (nextFrame < at) {
              const count = Math.min(at - nextFrame, rate);
              meter.add(Array.from({ length: channels }, () => new Float32Array(count)));
              nextFrame += count;
              signal.throwIfAborted();
            }
            const mixed = downmix(planes(sample, start, end), channels);
            for (const plane of mixed) for (const x of plane) peak = Math.max(peak, Math.abs(x));
            meter.add(mixed);
            nextFrame = at + end - start;
            progress(Math.min(1, nextFrame / (duration * rate)));
          } finally {
            sample.close();
          }
        }
      } finally {
        await samples.return();
      }
      signal.throwIfAborted();
      const measured = meter?.integrated() ?? -Infinity;
      // Hard-clipping a normalized peak distorts audibly, so fall short of the target instead.
      normalizationDb = Number.isFinite(measured)
        ? Math.min(settings.normalize - measured, 20 * Math.log10(SAMPLE_CEILING / peak))
        : 0;
      progress(1);
    },
    normalizationDb: () => normalizationDb,
    process(sample: AudioSample): AudioSample {
      // Conversion's default copy.shiftTolerance=0 keeps hook timestamps relative to the trim start.
      const data = planes(sample);
      processPcm(data, sample.sampleRate, sample.timestamp, duration, settings, normalizationDb);
      const pcm = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
      data.forEach((plane, c) => pcm.set(plane, c * sample.numberOfFrames));
      return new AudioSample({
        data: pcm,
        format: 'f32-planar',
        sampleRate: sample.sampleRate,
        numberOfChannels: sample.numberOfChannels,
        timestamp: sample.timestamp,
      });
    },
  };
}

export function processedAudioOptions(
  value: Partial<AudioProcessing>,
  trim: { start: number; end: number },
  channels: number,
  options: ConversionAudioOptions,
) {
  const processor = createAudioProcessor(value, trim, channels);
  const normalizing = normalizeAudioProcessing(value, trim.end - trim.start).normalize !== null;
  const processors = new Map<InputAudioTrack, ReturnType<typeof createAudioProcessor>>();
  const audio = { ...options, forceTranscode: true, process: processor.process };
  return {
    audio: normalizing
      ? (track: InputAudioTrack): ConversionAudioOptions => ({
          ...audio,
          process: (processors.get(track) ?? processor).process,
        })
      : audio,
    async prepare(input: Input, signal: AbortSignal, progress: (p: number) => void): Promise<void> {
      if (!normalizing) return;
      const tracks = await input.getAudioTracks();
      for (let i = 0; i < tracks.length; i++) {
        signal.throwIfAborted();
        const track = tracks[i]!;
        if (!(await track.canDecode())) continue;
        const processor = createAudioProcessor(value, trim, channels);
        processors.set(track, processor);
        await processor.prepare(input, signal, (p) => progress((i + p) / tracks.length), track);
      }
      progress(1);
    },
  };
}
