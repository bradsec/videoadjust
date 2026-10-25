import { AudioSample, AudioSampleSink, InputAudioTrack, type Input } from 'mediabunny';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMixProcessor,
  hasAudioMix,
  mixHasAudio,
  normalizeAudioMix,
  type AddedAudio,
  type AudioMix,
  addedOffsetRange,
  describeAddedOffset,
} from '../../src/core/audioMix';
import { LoudnessMeter, SAMPLE_CEILING } from '../../src/core/audioProcess';

afterEach(() => vi.restoreAllMocks());

const neutral: AudioMix = { original: { include: true, volumeDb: 0 } };
const trim = { start: 0, end: 1 };
const signal = () => new AbortController().signal;

function source(data: Float32Array[], rate = 8) {
  const track = Object.assign(Object.create(InputAudioTrack.prototype) as InputAudioTrack, {
    canDecode: async () => true,
  });
  const input = { getPrimaryAudioTrack: async () => track } as unknown as Input;
  return { input, track, data, rate };
}

function decode(...sources: ReturnType<typeof source>[]) {
  return vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* (
    this: AudioSampleSink,
  ) {
    const track = (this as unknown as { _track: InputAudioTrack })._track;
    const { data, rate } = sources.find((source) => source.track === track)!;
    const pcm = new Float32Array(data.length * data[0]!.length);
    data.forEach((plane, c) => pcm.set(plane, c * plane.length));
    yield new AudioSample({
      data: pcm,
      format: 'f32-planar',
      sampleRate: rate,
      numberOfChannels: data.length,
      timestamp: 0,
    });
  });
}

function added(value: ReturnType<typeof source>): AddedAudio {
  return {
    input: value.input,
    file: new File([], 'music.wav'),
    duration: value.data[0]!.length / value.rate,
    channels: value.data.length,
    sampleRate: value.rate,
  };
}

async function render(processor: ReturnType<typeof createMixProcessor>) {
  const result: number[][] = [];
  for await (const sample of processor.samples(signal())) {
    try {
      for (let c = 0; c < sample.numberOfChannels; c++) {
        const plane = new Float32Array(sample.numberOfFrames);
        sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
        (result[c] ??= []).push(...plane);
      }
    } finally {
      sample.close();
    }
  }
  return result;
}

describe('audio mix settings', () => {
  it('keeps a neutral mix eligible for copying and clamps invalid settings', () => {
    expect(hasAudioMix()).toBe(false);
    expect(hasAudioMix(neutral)).toBe(false);
    expect(
      normalizeAudioMix(
        {
          original: { include: false, volumeDb: 20 },
          added: { volumeDb: -50, offset: 20, loop: true },
        },
        3,
      ),
    ).toEqual({
      original: { include: false, volumeDb: 20 },
      added: { volumeDb: -20, offset: 3, loop: true },
    });
    expect(
      normalizeAudioMix(
        {
          original: { include: true, volumeDb: NaN },
          added: { volumeDb: Infinity, offset: -1, loop: false },
        },
        3,
      ),
    ).toEqual({
      original: { include: true, volumeDb: 0 },
      // Negative offsets start the added file partway in.
      added: { volumeDb: 0, offset: -1, loop: false },
    });
    expect(addedOffsetRange(60, 10)).toEqual({ min: -59.9, max: 10 });
    expect(describeAddedOffset(-12)).toBe('12.0 s into the track');
    expect(describeAddedOffset(2.5)).toBe('starts at 2.5 s');
    expect(mixHasAudio({ original: { include: false, volumeDb: 0 } }, true)).toBe(false);
    expect(mixHasAudio({ ...neutral, added: { volumeDb: 0, offset: 0, loop: false } }, false)).toBe(
      true,
    );
  });
});

describe('streaming audio mix', () => {
  it('closes both decoders even if one decoder cleanup fails', async () => {
    const original = source([new Float32Array(8000).fill(0.1)], 8000);
    const music = source([new Float32Array(8000).fill(0.1)], 8000);
    const returned = [vi.fn(), vi.fn()];
    let opened = 0;
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(() => {
      const index = opened++;
      const iterator = (async function* () {
        yield new AudioSample({
          data: new Float32Array(8000).fill(0.1),
          format: 'f32-planar',
          sampleRate: 8000,
          numberOfChannels: 1,
          timestamp: 0,
        });
      })();
      const close = iterator.return.bind(iterator);
      iterator.return = async (...args) => {
        returned[index]!();
        const result = await close(...args);
        if (index === 0) throw new Error('Decoder cleanup failed');
        return result;
      };
      return iterator;
    });
    const samples = createMixProcessor(
      original.input,
      added(music),
      {
        ...neutral,
        added: { volumeDb: 0, offset: 0, loop: false },
      },
      trim,
      1,
      8000,
    ).samples(signal());
    const first = await samples.next();
    first.value?.close();
    await expect(samples.return(undefined)).rejects.toThrow('Decoder cleanup failed');
    expect(returned[1]).toHaveBeenCalled();
  });
  it('stops both decoding iterators immediately when a yielded mix is cancelled', async () => {
    const original = source([new Float32Array(8000).fill(0.1)], 8000);
    const music = source([new Float32Array(8000).fill(0.1)], 8000);
    const returned = [vi.fn(), vi.fn()];
    let opened = 0;
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(() => {
      const onReturn = returned[opened++]!;
      const iterator = (async function* () {
        yield new AudioSample({
          data: new Float32Array(8000).fill(0.1),
          format: 'f32-planar',
          sampleRate: 8000,
          numberOfChannels: 1,
          timestamp: 0,
        });
      })();
      const close = iterator.return.bind(iterator);
      iterator.return = (...args) => {
        onReturn();
        return close(...args);
      };
      return iterator;
    });
    const controller = new AbortController();
    const samples = createMixProcessor(
      original.input,
      added(music),
      {
        ...neutral,
        added: { volumeDb: 0, offset: 0, loop: false },
      },
      trim,
      1,
      8000,
    ).samples(controller.signal);
    const first = await samples.next();
    first.value?.close();
    controller.abort();
    expect(returned[0]).toHaveBeenCalled();
    expect(returned[1]).toHaveBeenCalled();
    await samples.return(undefined);
  });
  it('interpolates across decoded sample boundaries and aligns the source trim', async () => {
    const original = source([new Float32Array(4)], 4);
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      for (const [timestamp, data] of [
        [0, [0, 0.2]],
        [0.5, [0.4, 0.6]],
      ] as const)
        yield new AudioSample({
          data: Float32Array.from(data),
          format: 'f32-planar',
          sampleRate: 4,
          numberOfChannels: 1,
          timestamp,
        });
    });
    const result = await render(
      createMixProcessor(original.input, undefined, neutral, { start: 0.125, end: 0.875 }, 1, 8),
    );
    expect(result[0]).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(Math.fround));
  });
  it('aligns added audio by output offset, loops, and cuts at the kept end', async () => {
    const original = source([new Float32Array(8)]);
    const music = source([new Float32Array([0.1, 0.2])]);
    decode(original, music);
    const mix = { ...neutral, added: { volumeDb: 0, offset: 0.25, loop: true } };
    const result = await render(createMixProcessor(original.input, added(music), mix, trim, 1, 8));
    expect(result[0]).toEqual([0, 0, ...[0.1, 0.2, 0.1, 0.2, 0.1, 0.2].map(Math.fround)]);
    const once = await render(
      createMixProcessor(
        original.input,
        added(music),
        {
          ...mix,
          added: { ...mix.added, loop: false },
        },
        trim,
        1,
        8,
      ),
    );
    expect(once[0]).toEqual([0, 0, Math.fround(0.1), Math.fround(0.2), 0, 0, 0, 0]);
  });

  it('resamples, duplicates mono into stereo, and applies separate track gains before the master', async () => {
    const original = source([new Float32Array(8).fill(0.2), new Float32Array(8).fill(-0.1)]);
    const music = source([new Float32Array(4).fill(0.4)], 4);
    decode(original, music);
    const mix = {
      original: { include: true, volumeDb: -6.020599913 },
      added: { volumeDb: -6.020599913, offset: 0, loop: false },
    };
    const result = await render(
      createMixProcessor(original.input, added(music), mix, trim, 2, 8, {
        gainDb: -6.020599913,
      }),
    );
    expect(result[0]).toHaveLength(8);
    expect(result[0]![0]).toBeCloseTo(0.15);
    expect(result[1]![0]).toBeCloseTo(0.075);
  });

  it('downmixes stereo and removes original audio while retaining the added track', async () => {
    const original = source([new Float32Array(8).fill(0.8)]);
    const music = source([new Float32Array(8).fill(0.2), new Float32Array(8).fill(0.4)]);
    decode(original, music);
    const result = await render(
      createMixProcessor(
        original.input,
        added(music),
        {
          original: { include: false, volumeDb: 0 },
          added: { volumeDb: 0, offset: 0, loop: false },
        },
        trim,
        1,
        8,
      ),
    );
    expect(result[0]![0]).toBeCloseTo(0.3);
  });

  it('sums before master gain, fades, and the sample ceiling', async () => {
    const original = source([new Float32Array(8).fill(0.8)]);
    const music = source([new Float32Array(8).fill(0.8)]);
    decode(original, music);
    const result = await render(
      createMixProcessor(
        original.input,
        added(music),
        {
          ...neutral,
          added: { volumeDb: 0, offset: 0, loop: false },
        },
        trim,
        1,
        8,
        { gainDb: -6.020599913, fadeIn: 0.5 },
      ),
    );
    expect(result[0]![0]).toBe(0);
    expect(result[0]![2]).toBeCloseTo(0.4);
    expect(result[0]![4]).toBeCloseTo(0.8);
    const clipped = await render(
      createMixProcessor(
        original.input,
        added(music),
        {
          ...neutral,
          added: { volumeDb: 0, offset: 0, loop: false },
        },
        trim,
        1,
        8,
      ),
    );
    expect(clipped[0]![0]).toBeCloseTo(SAMPLE_CEILING);
  });

  it('normalizes the summed mix rather than each track separately', async () => {
    const rate = 8000;
    const tone = Float32Array.from(
      { length: rate },
      (_, i) => 0.02 * Math.sin((2 * Math.PI * 997 * i) / rate),
    );
    const original = source([tone], rate);
    const music = source([tone], rate);
    decode(original, music);
    const processor = createMixProcessor(
      original.input,
      added(music),
      {
        ...neutral,
        added: { volumeDb: 0, offset: 0, loop: false },
      },
      trim,
      1,
      rate,
      { normalize: -16 },
    );
    await processor.prepare(signal(), () => {});
    const result = await render(processor);
    const meter = new LoudnessMeter(rate, 1);
    meter.add([Float32Array.from(result[0]!)]);
    expect(meter.integrated()).toBeCloseTo(-16, 1);
  });

  it('supports added audio when the source has no audio and stops on cancellation', async () => {
    const input = { getPrimaryAudioTrack: async () => null } as unknown as Input;
    const music = source([new Float32Array(8).fill(0.2)]);
    decode(music);
    const processor = createMixProcessor(
      input,
      added(music),
      {
        ...neutral,
        added: { volumeDb: 0, offset: 0, loop: false },
      },
      trim,
      1,
      8,
    );
    expect((await render(processor))[0]![0]).toBeCloseTo(0.2);
    const controller = new AbortController();
    controller.abort();
    await expect(processor.samples(controller.signal).next()).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
