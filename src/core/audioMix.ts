import { AudioSample, AudioSampleSink, type Input, type InputAudioTrack } from 'mediabunny';
import {
  dbGain,
  LoudnessMeter,
  normalizeAudioProcessing,
  processPcm,
  SAMPLE_CEILING,
  type AudioProcessing,
} from './audioProcess';

export interface AudioMix {
  original: { include: boolean; volumeDb: number };
  added?: { volumeDb: number; offset: number; loop: boolean };
}

export interface AddedAudio {
  file: File;
  input: Input;
  duration: number;
  channels: number;
  sampleRate: number;
}

const finite = (value: number | undefined) => (Number.isFinite(value) ? value! : 0);
// A negative offset starts the added file partway in; callers clamp to the file's length.
const MAX_LEAD_IN_SEC = 86400;
const volume = (value: number | undefined) => Math.min(12, Math.max(-30, finite(value)));

export function normalizeAudioMix(value: AudioMix | undefined, duration: number): AudioMix {
  return {
    original: {
      include: value?.original?.include !== false,
      volumeDb: volume(value?.original?.volumeDb),
    },
    ...(value?.added
      ? {
          added: {
            volumeDb: volume(value.added.volumeDb),
            offset: Math.min(
              Math.max(0, finite(duration)),
              Math.max(-MAX_LEAD_IN_SEC, finite(value.added.offset)),
            ),
            loop: value.added.loop === true,
          },
        }
      : {}),
  };
}

/** Offset range for an added file: from almost its end playing at trim start, to trim end. */
export function addedOffsetRange(addedDuration: number, keptDuration: number) {
  return { min: -Math.max(0, addedDuration - 0.1), max: Math.max(0, keptDuration) };
}

/** Plain wording for an offset: when it starts, or how far into the file it starts. */
export function describeAddedOffset(offset: number): string {
  return offset < 0
    ? `${(-offset).toFixed(1)} s into the track`
    : `starts at ${offset.toFixed(1)} s`;
}

export function hasAudioMix(value?: AudioMix): boolean {
  const mix = normalizeAudioMix(value, Number.MAX_VALUE);
  return !mix.original.include || mix.original.volumeDb !== 0 || !!mix.added;
}

export function mixHasAudio(value: AudioMix | undefined, sourceHasAudio: boolean): boolean {
  const mix = normalizeAudioMix(value, Number.MAX_VALUE);
  return (mix.original.include && sourceHasAudio) || !!mix.added;
}

type Pcm = { planes: Float32Array[]; timestamp: number; rate: number; end: number };

function pcm(sample: AudioSample, channels: number): Pcm {
  const data = Array.from({ length: sample.numberOfChannels }, (_, c) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    return plane;
  });
  const n = data.length;
  const planes =
    n === channels
      ? data
      : Array.from({ length: channels }, (_, c) =>
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
            // shortcut: other layouts use discrete channels; add speaker matrices when layout metadata is available.
            return at(c);
          }),
        );
  return {
    planes,
    timestamp: sample.timestamp,
    rate: sample.sampleRate,
    end: sample.timestamp + sample.duration,
  };
}

// Keep only the current and next decoded sample; restarting the iterator implements looping.
class PcmReader {
  private iterator?: AsyncGenerator<AudioSample, void, unknown>;
  private current?: Pcm;
  private next?: Pcm;
  private ended = false;
  private lastTime = -Infinity;
  private readonly stop = () => {
    void this.iterator
      ?.return()
      .catch((error: unknown) => console.warn('Could not stop the audio decoder', error));
  };

  constructor(
    private track: InputAudioTrack,
    private start: number,
    private end: number,
    private channels: number,
    private signal: AbortSignal,
  ) {}

  private async pull(): Promise<Pcm | undefined> {
    this.signal.throwIfAborted();
    if (!this.iterator) {
      this.iterator = new AudioSampleSink(this.track).samples(this.start, this.end);
      this.signal.addEventListener('abort', this.stop, { once: true });
    }
    const result = await this.iterator.next();
    if (result.done) {
      this.ended = true;
      return undefined;
    }
    try {
      this.signal.throwIfAborted();
      return pcm(result.value, this.channels);
    } finally {
      result.value.close();
    }
  }

  async add(
    output: Float32Array[],
    timestamp: number,
    rate: number,
    gain: number,
    sourceTime: (time: number) => number | null,
  ): Promise<void> {
    for (let i = 0; i < output[0]!.length; i++) {
      const time = sourceTime(timestamp + i / rate);
      if (time === null || time < this.start || time >= this.end) continue;
      if (time < this.lastTime) {
        await this.close();
        this.ended = false;
      }
      this.lastTime = time;
      while (!this.current || time >= this.current.end - 1e-10) {
        this.current = this.next ?? (this.ended ? undefined : await this.pull());
        this.next = undefined;
        if (!this.current) break;
        if (time < this.current.end - 1e-10) break;
      }
      const current = this.current;
      if (!current || time < current.timestamp) continue;
      const position = Math.max(0, (time - current.timestamp) * current.rate);
      const index = Math.min(current.planes[0]!.length - 1, Math.floor(position));
      const fraction = position - index;
      if (fraction > 1e-8 && index + 1 === current.planes[0]!.length && !this.next && !this.ended)
        this.next = await this.pull();
      for (let c = 0; c < output.length; c++) {
        // shortcut: linear resampling can alias on downsampling; use a low-pass resampler for mastering fidelity.
        const left = current.planes[c]![index]!;
        const right =
          current.planes[c]![index + 1] ??
          (this.next && Math.abs(this.next.timestamp - current.end) < 1 / current.rate
            ? this.next.planes[c]![0]!
            : left);
        output[c]![i] += (left + (right - left) * fraction) * gain;
      }
    }
    this.signal.throwIfAborted();
  }

  async close(): Promise<void> {
    this.signal.removeEventListener('abort', this.stop);
    await this.iterator?.return();
    this.iterator = undefined;
    this.current = undefined;
    this.next = undefined;
  }
}

export function createMixProcessor(
  input: Input,
  added: AddedAudio | undefined,
  value: AudioMix | undefined,
  trim: { start: number; end: number },
  channels: number,
  rate = 48000,
  processing: Partial<AudioProcessing> = {},
) {
  const duration = Math.max(0, trim.end - trim.start);
  const mix = normalizeAudioMix(value, duration);
  const master = normalizeAudioProcessing(processing, duration);
  let normalizationDb = 0;

  async function* mixed(
    signal: AbortSignal,
  ): AsyncGenerator<{ planes: Float32Array[]; timestamp: number }> {
    signal.throwIfAborted();
    if (mix.added && !added) throw new Error('Choose an added audio file before exporting.');
    const originalTrack = mix.original.include ? await input.getPrimaryAudioTrack() : null;
    const addedTrack = mix.added && added ? await added.input.getPrimaryAudioTrack() : null;
    if (originalTrack && !(await originalTrack.canDecode()))
      throw new Error('The original audio cannot be decoded for mixing.');
    if (mix.added && (!addedTrack || !(await addedTrack.canDecode())))
      throw new Error('The added file has no decodable audio.');
    const original = originalTrack
      ? new PcmReader(originalTrack, trim.start, trim.end, channels, signal)
      : undefined;
    const music =
      addedTrack && added
        ? new PcmReader(addedTrack, 0, added.duration, channels, signal)
        : undefined;
    try {
      const frames = Math.floor(duration * rate);
      for (let start = 0; start < frames; start += 4096) {
        signal.throwIfAborted();
        const planes = Array.from(
          { length: channels },
          () => new Float32Array(Math.min(4096, frames - start)),
        );
        const timestamp = start / rate;
        await original?.add(
          planes,
          timestamp,
          rate,
          dbGain(mix.original.volumeDb),
          (time) => trim.start + time,
        );
        if (music && mix.added && added) {
          const settings = mix.added;
          const length = added.duration;
          await music.add(planes, timestamp, rate, dbGain(settings.volumeDb), (time) => {
            const at = time - settings.offset;
            if (at < 0 || length <= 0 || (!settings.loop && at >= length)) return null;
            return settings.loop ? at % length : at;
          });
        }
        yield { planes, timestamp };
      }
    } finally {
      await Promise.all([original?.close(), music?.close()]);
    }
  }

  return {
    async prepare(signal: AbortSignal, progress: (p: number) => void): Promise<void> {
      signal.throwIfAborted();
      if (master.normalize === null) return;
      const meter = new LoudnessMeter(rate, channels);
      let peak = 0;
      for await (const { planes, timestamp } of mixed(signal)) {
        meter.add(planes);
        for (const plane of planes)
          for (const sample of plane) peak = Math.max(peak, Math.abs(sample));
        progress(Math.min(1, (timestamp + planes[0]!.length / rate) / duration));
      }
      const measured = meter.integrated();
      normalizationDb = Number.isFinite(measured)
        ? Math.min(master.normalize - measured, 20 * Math.log10(SAMPLE_CEILING / peak))
        : 0;
      progress(1);
    },
    normalizationDb: () => normalizationDb,
    async *samples(signal: AbortSignal): AsyncGenerator<AudioSample> {
      for await (const { planes, timestamp } of mixed(signal)) {
        processPcm(planes, rate, timestamp, duration, master, normalizationDb);
        const data = new Float32Array(planes[0]!.length * channels);
        planes.forEach((plane, c) => data.set(plane, c * plane.length));
        yield new AudioSample({
          data,
          format: 'f32-planar',
          sampleRate: rate,
          numberOfChannels: channels,
          timestamp,
        });
      }
    },
  };
}

/** Edits in the Audio section: each track change and each non-neutral master control. */
export function audioChangeCount(
  value: AudioMix | undefined,
  processing: Partial<AudioProcessing> | undefined,
): number {
  const mix = normalizeAudioMix(value, Number.MAX_VALUE);
  const master = normalizeAudioProcessing(processing, Number.MAX_VALUE);
  return (
    Number(!mix.original.include) +
    Number(mix.original.volumeDb !== 0) +
    Number(!!mix.added) +
    Number(master.gainDb !== 0) +
    Number(master.fadeIn !== 0) +
    Number(master.fadeOut !== 0) +
    Number(master.normalize !== null)
  );
}
