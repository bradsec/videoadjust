import { AudioSampleSink, InputAudioTrack, type AudioSample, type Input } from 'mediabunny';
import { describe, expect, it, vi } from 'vitest';
import { computePeaks, peaksFromSamples } from '../../src/ui/waveform';

describe('peaksFromSamples', () => {
  it('returns one peak per bin', () => {
    const peaks = peaksFromSamples([new Float32Array(1000).fill(0.5)], 10);
    expect(peaks).toHaveLength(10);
    expect([...peaks].every((p) => p === 0.5)).toBe(true);
  });

  it('takes the largest absolute value across channels and samples in each bin', () => {
    const left = new Float32Array([0.1, -0.2, 0.1, 0.1]);
    const right = new Float32Array([0, 0, 0.1, -0.9]);
    const peaks = peaksFromSamples([left, right], 2);
    expect(peaks[0]).toBeCloseTo(0.2);
    expect(peaks[1]).toBeCloseTo(0.9);
  });

  it('returns zeros for silence and for no channels', () => {
    expect([...peaksFromSamples([new Float32Array(64)], 4)]).toEqual([0, 0, 0, 0]);
    expect([...peaksFromSamples([], 3)]).toEqual([0, 0, 0]);
  });

  it('clamps to 0..1', () => {
    expect(peaksFromSamples([new Float32Array([-1.5, 0.2])], 2)[0]).toBe(1);
  });

  it('handles fewer samples than bins', () => {
    const peaks = peaksFromSamples([new Float32Array([0.4, 0.8])], 6);
    expect(peaks).toHaveLength(6);
    expect(Math.max(...peaks)).toBeCloseTo(0.8);
    expect(peaks.filter((p) => p > 0)).toHaveLength(2);
  });
});

it('stops a pending waveform decoder immediately on cancellation', async () => {
  const track = Object.assign(Object.create(InputAudioTrack.prototype) as InputAudioTrack, {
    canDecode: async () => true,
  });
  const input = { getPrimaryAudioTrack: async () => track } as unknown as Input;
  let resolve!: (result: IteratorResult<AudioSample, void>) => void;
  const iterator = {
    next: vi.fn(
      () =>
        new Promise<IteratorResult<AudioSample, void>>((done) => {
          resolve = done;
        }),
    ),
    return: vi.fn(async () => {
      resolve({ done: true, value: undefined });
      return { done: true, value: undefined };
    }),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as unknown as AsyncGenerator<AudioSample, void, unknown>;
  const samples = vi.spyOn(AudioSampleSink.prototype, 'samples').mockReturnValue(iterator);
  const controller = new AbortController();
  const result = computePeaks(input, { start: 0, end: 1 }, 2048, controller.signal);
  await new Promise((done) => setTimeout(done, 0));
  try {
    controller.abort();
    expect(iterator.return).toHaveBeenCalled();
  } finally {
    await iterator.return();
    expect(await result).toBeNull();
    samples.mockRestore();
  }
});
