import { AudioSample, AudioSampleSink, InputAudioTrack, type Input } from 'mediabunny';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LoudnessMeter,
  dbGain,
  normalizeAudioProcessing,
  processPcm,
  SAMPLE_CEILING,
  createAudioProcessor,
  processedAudioOptions,
} from '../../src/core/audioProcess';

const sine = (rate: number, seconds: number, amplitude = 0.1, frequency = 997) =>
  Float32Array.from(
    { length: rate * seconds },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate),
  );

afterEach(() => vi.restoreAllMocks());

const track = Object.assign(Object.create(InputAudioTrack.prototype) as InputAudioTrack, {
  getFirstTimestamp: async () => 0,
});
const input = { getPrimaryAudioTrack: async () => track } as unknown as Input;
const audioSample = (data: Float32Array, timestamp = 0) =>
  new AudioSample({
    data,
    timestamp,
    format: 'f32-planar',
    sampleRate: 48000,
    numberOfChannels: 1,
  });

describe('audio analysis pass', () => {
  it('normalizes each retained audio track independently', async () => {
    const tracks = [0, 1].map(() =>
      Object.assign(Object.create(InputAudioTrack.prototype) as InputAudioTrack, {
        canDecode: async () => true,
      }),
    );
    const input = { getAudioTracks: async () => tracks } as unknown as Input;
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* (
      this: AudioSampleSink,
    ) {
      const track = (this as unknown as { _track: InputAudioTrack })._track;
      yield audioSample(sine(48000, 1, track === tracks[0] ? 0.01 : 0.3));
    });
    const job = processedAudioOptions({ normalize: -16 }, { start: 0, end: 1 }, 1, {
      codec: 'pcm-s16',
    });
    await job.prepare(input, new AbortController().signal, () => {});
    for (let i = 0; i < tracks.length; i++) {
      const options = typeof job.audio === 'function' ? job.audio(tracks[i]!) : job.audio;
      const raw = audioSample(sine(48000, 1, i === 0 ? 0.01 : 0.3));
      const result = (await options.process!(raw)) as AudioSample;
      const plane = new Float32Array(48000);
      result.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      const meter = new LoudnessMeter(48000, 1);
      meter.add([plane]);
      expect(Math.abs(meter.integrated() + 16)).toBeLessThan(0.05);
      raw.close();
      result.close();
    }
  });
  it('measures only the trim and normalizes the output channel layout before adding user gain', async () => {
    const data = sine(48000, 3);
    const sample = audioSample(data, 5);
    const close = vi.spyOn(sample, 'close');
    const sink = vi
      .spyOn(AudioSampleSink.prototype, 'samples')
      .mockImplementation(async function* () {
        yield sample;
      });
    const processor = createAudioProcessor(
      { normalize: -16, gainDb: -2 },
      { start: 5.5, end: 7.5 },
      1,
    );
    const progress = vi.fn();
    await processor.prepare(input, new AbortController().signal, progress);
    expect(sink).toHaveBeenCalledWith(5.5, 7.5);
    expect(close).toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(1);
    const raw = audioSample(sine(48000, 2));
    const result = processor.process(raw);
    const plane = new Float32Array(result.numberOfFrames);
    result.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
    const meter = new LoudnessMeter(48000, 1);
    meter.add([plane]);
    expect(Math.abs(meter.integrated() + 18)).toBeLessThan(0.05);
    result.close();
    raw.close();
  });
  it('caps normalization gain so measured peaks stay under the ceiling instead of clipping', async () => {
    const data = sine(48000, 1, 0.05);
    data[24000] = 0.9;
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield audioSample(data.slice());
    });
    const processor = createAudioProcessor({ normalize: -14 }, { start: 0, end: 1 }, 1);
    await processor.prepare(input, new AbortController().signal, () => {});
    const raw = audioSample(data.slice());
    const result = processor.process(raw);
    const plane = new Float32Array(48000);
    result.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
    const gain = plane[24000]! / data[24000]!;
    expect(plane[24000]!).toBeLessThanOrEqual(SAMPLE_CEILING);
    expect(gain).toBeCloseTo(SAMPLE_CEILING / 0.9, 4);
    expect(plane[1000]! / data[1000]!).toBeCloseTo(gain, 4);
    raw.close();
    result.close();
  });
  it('skips normalization for silence and rejects cancellation while closing decoded samples', async () => {
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      yield audioSample(new Float32Array(48000));
    });
    const processor = createAudioProcessor({ normalize: -14 }, { start: 0, end: 1 }, 1);
    await processor.prepare(input, new AbortController().signal, () => {});
    const raw = audioSample(new Float32Array([0.1]));
    const result = processor.process(raw);
    const plane = new Float32Array(1);
    result.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
    expect(plane[0]).toBe(Math.fround(0.1));
    raw.close();
    result.close();
    const controller = new AbortController();
    const sample = audioSample(new Float32Array(48000));
    const close = vi.spyOn(sample, 'close');
    vi.spyOn(AudioSampleSink.prototype, 'samples').mockImplementation(async function* () {
      controller.abort();
      yield sample;
    });
    await expect(processor.prepare(input, controller.signal, () => {})).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(close).toHaveBeenCalled();
  });
});

describe('integrated loudness', () => {
  it.each([44100, 48000, 96000])('measures a -20 dBFS stereo reference sine at %i Hz', (rate) => {
    const meter = new LoudnessMeter(rate, 2);
    const data = sine(rate, 3);
    meter.add([data, data]);
    expect(meter.integrated()).toBeCloseTo(-20, 0);
    expect(Math.abs(meter.integrated() + 20)).toBeLessThan(0.2);
  });
  it('keeps filter and overlap state across chunks; gates silence and quiet blocks', () => {
    const rate = 48000;
    const data = new Float32Array(rate * 6);
    data.set(sine(rate, 2), rate * 2);
    const whole = new LoudnessMeter(rate, 2);
    const chunks = new LoudnessMeter(rate, 2);
    whole.add([data, data]);
    for (let i = 0; i < data.length; i += 1024) {
      const part = data.subarray(i, i + 1024);
      chunks.add([part, part]);
    }
    expect(chunks.integrated()).toBeCloseTo(whole.integrated(), 8);
    expect(whole.integrated()).toBeGreaterThan(-21);
    const silence = new LoudnessMeter(rate, 1);
    silence.add([new Float32Array(rate)]);
    expect(silence.integrated()).toBe(-Infinity);
    const quiet = new LoudnessMeter(rate, 1);
    quiet.add([sine(rate, 1, 0.00001)]);
    expect(quiet.integrated()).toBe(-Infinity);
  });
  it('applies surround weights and excludes LFE', () => {
    const rate = 48000;
    const tone = sine(rate, 1);
    const zero = new Float32Array(rate);
    const mono = new LoudnessMeter(rate, 1);
    mono.add([tone]);
    const surround = new LoudnessMeter(rate, 6);
    surround.add([zero, zero, zero, tone, tone, zero]);
    expect(surround.integrated() - mono.integrated()).toBeCloseTo(10 * Math.log10(1.41), 6);
  });
  it('excludes blocks below the relative -10 LU gate', () => {
    const rate = 48000;
    const tone = sine(rate, 3);
    const reference = new LoudnessMeter(rate, 2);
    reference.add([tone, tone]);
    const gated = new LoudnessMeter(rate, 2);
    gated.add([tone, tone]);
    const quiet = sine(rate, 6, 0.001);
    gated.add([quiet, quiet]);
    expect(Math.abs(gated.integrated() - reference.integrated())).toBeLessThan(0.3);
  });
});

describe('PCM processing', () => {
  it('keeps fades on the trim timeline when an audio sample starts late', () => {
    const processor = createAudioProcessor({ fadeIn: 1 }, { start: 5, end: 7 }, 1);
    const raw = audioSample(new Float32Array([0.5]), 0.5);
    const result = processor.process(raw);
    const data = new Float32Array(1);
    result.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
    expect(data[0]).toBe(0.25);
    raw.close();
    result.close();
  });
  it('combines gain with sample-accurate fades across chunks', () => {
    expect(dbGain(20)).toBe(10);
    expect(dbGain(-20)).toBe(0.1);
    const settings = normalizeAudioProcessing({ gainDb: -6.020599913, fadeIn: 1, fadeOut: 1 }, 3);
    const first = new Float32Array(4).fill(1);
    const last = new Float32Array(4).fill(1);
    processPcm([first], 4, 0, 3, settings);
    processPcm([last], 4, 2, 3, settings);
    expect([...first]).toEqual([0, 0.125, 0.25, 0.375]);
    expect([...last]).toEqual([0.5, 0.375, 0.25, 0.125]);
  });
  it('limits both polarities to -1 dBFS sample peak', () => {
    const data = new Float32Array([0.5, -0.5, 0.01]);
    processPcm([data], 48000, 0, 1, normalizeAudioProcessing({ gainDb: 20 }, 1));
    expect(data[0]).toBeCloseTo(SAMPLE_CEILING);
    expect(data[1]).toBeCloseTo(-SAMPLE_CEILING);
    expect(data[2]).toBeCloseTo(0.1);
  });
  it('clamps invalid controls and scales fades to fit the kept duration', () => {
    expect(normalizeAudioProcessing({ gainDb: Infinity, fadeIn: -1, fadeOut: NaN }, 1)).toEqual({
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      normalize: null,
    });
    expect(normalizeAudioProcessing({ gainDb: 50, fadeIn: 2, fadeOut: 2 }, 2)).toEqual({
      gainDb: 20,
      fadeIn: 1,
      fadeOut: 1,
      normalize: null,
    });
  });
  it('returns processed samples with original timing and channel layout', () => {
    const processor = createAudioProcessor({ gainDb: -20 }, { start: 5, end: 6 }, 2);
    const sample = new AudioSample({
      data: new Float32Array([1, -1, 0.5, -0.5]),
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: 48000,
      timestamp: 0,
    });
    const result = processor.process(sample);
    const plane = new Float32Array(2);
    result.copyTo(plane, { planeIndex: 1, format: 'f32-planar' });
    expect([...plane]).toEqual([Math.fround(0.05), Math.fround(-0.05)]);
    expect(result.timestamp).toBe(0);
    result.close();
    sample.close();
  });
});
