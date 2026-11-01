import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Input } from 'mediabunny';
import { dbGain } from '../../src/core/audioProcess';
import {
  addedAudioTime,
  addedSchedule,
  mountPreviewAudio,
  previewGain,
  previewTrackGains,
  previewCeilingCurve,
} from '../../src/ui/previewAudio';

describe('preview audio gain', () => {
  const target = {
    processing: { gainDb: -6, fadeIn: 1, fadeOut: 2 },
    trim: { start: 10, end: 20 },
    channels: 2,
  };

  it('silences the routed preview without a target', () => {
    expect(previewGain(null, 0, 5)).toBe(0);
  });

  it('follows export gain and fades on the kept range, in source time', () => {
    expect(previewGain(target, 0, 10)).toBe(0);
    expect(previewGain(target, 0, 10.5)).toBeCloseTo(dbGain(-6) * 0.5, 6);
    expect(previewGain(target, 0, 15)).toBeCloseTo(dbGain(-6), 6);
    expect(previewGain(target, 0, 19)).toBeCloseTo(dbGain(-6) * 0.5, 6);
  });

  it('adds the measured normalization gain to user gain', () => {
    expect(previewGain(target, 4, 15)).toBeCloseTo(dbGain(-2), 6);
  });
});

describe('preview audio mix', () => {
  const trim = { start: 10, end: 20 };
  const added = { offset: 2, loop: false, volumeDb: 0 };

  it('aligns added audio to the kept output offset and pauses outside its range', () => {
    expect(addedAudioTime(11, trim, added, 3)).toBeNull();
    expect(addedAudioTime(12, trim, added, 3)).toBe(0);
    expect(addedAudioTime(14.5, trim, added, 3)).toBe(2.5);
    expect(addedAudioTime(15, trim, added, 3)).toBeNull();
    expect(addedAudioTime(20, trim, { ...added, loop: true }, 3)).toBeNull();
  });

  it('wraps loop positions and handles an empty added track', () => {
    expect(addedAudioTime(18.5, trim, { ...added, loop: true }, 3)).toBe(0.5);
    expect(addedAudioTime(13, trim, { ...added, loop: true }, 0)).toBeNull();
  });

  it('applies separate track gains and removes original audio', () => {
    expect(previewTrackGains(null)).toEqual({ original: 1, added: 0 });
    const target = {
      trim,
      channels: 2,
      mix: { original: { include: true, volumeDb: -6 }, added: { ...added, volumeDb: 6 } },
    };
    expect(previewTrackGains(target).original).toBeCloseTo(0.501187, 6);
    expect(previewTrackGains(target).added).toBeCloseTo(1.995262, 6);
    expect(
      previewTrackGains({
        ...target,
        mix: { ...target.mix, original: { include: false, volumeDb: 6 } },
      }).original,
    ).toBe(0);
  });
});

describe('preview graph', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resumes processing and silences GIF playback before restoring the mute state', () => {
    const resumes = vi.fn();
    const gains: number[] = [];
    const ceilings: { curve: Float32Array | null }[] = [];
    const node = () => ({
      gain: {
        setTargetAtTime: (value: number) => gains.push(value),
        setValueAtTime: (value: number) => gains.push(value),
      },
      connect(next: unknown) {
        return next;
      },
      channelCount: 2,
      channelCountMode: 'max',
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 0;
        destination = {};
        createGain = node;
        createWaveShaper = () => {
          const ceiling = { ...node(), curve: null as Float32Array | null };
          ceilings.push(ceiling);
          return ceiling;
        };
        createMediaElementSource = node;
        resume = resumes;
        close = () => Promise.resolve();
      },
    );
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const video = Object.assign(new EventTarget(), {
      currentTime: 15,
      paused: false,
      volume: 0.4,
      muted: false,
    });
    const preview = mountPreviewAudio(video as HTMLVideoElement, {} as Input);
    preview.update(
      {
        trim: { start: 10, end: 20 },
        channels: 2,
        processing: { gainDb: -6 },
        mix: { original: { include: false, volumeDb: 0 } },
      },
      false,
    );
    expect(resumes).toHaveBeenCalledOnce();
    expect(gains[0]).toBe(0);
    expect(gains[2]).toBeCloseTo(0.501187, 6);
    expect(ceilings[0]!.curve).not.toBeNull();
    preview.update({ trim: { start: 10, end: 20 }, channels: 2 }, false);
    expect(ceilings[0]!.curve).toBeNull();
    preview.update(null, true);
    expect(video.muted).toBe(true);
    expect(gains.at(-1)).toBe(0);
    video.muted = false;
    video.volume = 0.8;
    video.dispatchEvent(new Event('volumechange'));
    expect(video.muted).toBe(true);
    preview.update({ trim: { start: 10, end: 20 }, channels: 2 }, false);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.8);
    preview.destroy();
  });
});

describe('preview sample ceiling', () => {
  it('keeps quiet samples linear and clamps both signs at -1 dBFS', () => {
    const curve = previewCeilingCurve();
    expect(curve[0]).toBeCloseTo(-0.89125094, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(0.89125094, 6);
    expect(curve[(curve.length - 1) / 2]).toBe(0);
    expect(curve[((curve.length - 1) * 3) / 4]).toBe(0.5);
  });
});

describe('added track schedule', () => {
  const trim = { start: 10, end: 20 };
  it('waits until the offset before starting the buffer', () => {
    expect(addedSchedule(11, trim, { offset: 2, loop: false }, 3)).toEqual({
      delay: 1,
      offset: 0,
      until: 9,
    });
  });
  it('starts mid-buffer inside its range and wraps when looping', () => {
    expect(addedSchedule(13, trim, { offset: 2, loop: false }, 3)).toEqual({
      delay: 0,
      offset: 1,
      until: 7,
    });
    expect(addedSchedule(18.5, trim, { offset: 2, loop: true }, 3)).toEqual({
      delay: 0,
      offset: 0.5,
      until: 1.5,
    });
  });
  it('does not schedule after the buffer ends, past trim end or for an empty file', () => {
    expect(addedSchedule(16, trim, { offset: 2, loop: false }, 3)).toBeNull();
    expect(addedSchedule(20, trim, { offset: 0, loop: true }, 3)).toBeNull();
    expect(addedSchedule(12, trim, { offset: 0, loop: true }, 0)).toBeNull();
  });
});

describe('added buffer playback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('schedules the decoded buffer at the video position and reschedules on seek', async () => {
    const starts: [number, number][] = [];
    const stops: number[] = [];
    const node = () => ({
      gain: { setTargetAtTime() {} },
      connect(next: unknown) {
        return next;
      },
      disconnect() {},
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 5;
        destination = {};
        createGain = node;
        createWaveShaper = node;
        createMediaElementSource = node;
        createBufferSource = () => ({
          ...node(),
          playbackRate: { value: 1 },
          start: (when: number, offset: number) => starts.push([when, offset]),
          stop: (when?: number) => stops.push(when ?? -1),
        });
        decodeAudioData = () => Promise.resolve({ duration: 2 });
        resume = () => Promise.resolve();
        close = () => Promise.resolve();
      },
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const video = Object.assign(new EventTarget(), {
      paused: false,
      seeking: false,
      currentTime: 3,
      playbackRate: 1,
      volume: 1,
      muted: false,
    });
    const preview = mountPreviewAudio(video as HTMLVideoElement, {} as Input);
    preview.update(
      {
        channels: 2,
        trim: { start: 0, end: 10 },
        mix: {
          original: { include: true, volumeDb: 0 },
          added: { volumeDb: 0, offset: 0, loop: true },
        },
        added: {
          file: new File(['x'], 'music.mp3'),
          input: {} as Input,
          duration: 2,
          channels: 2,
          sampleRate: 48000,
        },
      },
      false,
    );
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    // 3 s into a looping 2 s file is 1 s in; it stops at trim end, 7 s away.
    expect(starts[0]).toEqual([5, 1]);
    expect(stops.at(-1)).toBe(12);
    video.dispatchEvent(new Event('seeking'));
    expect(stops.at(-1)).toBe(-1);
    video.currentTime = 6.5;
    video.dispatchEvent(new Event('seeked'));
    expect(starts.at(-1)).toEqual([5, 0.5]);
    video.paused = true;
    video.dispatchEvent(new Event('pause'));
    expect(stops.at(-1)).toBe(-1);
    preview.destroy();
  });
});
