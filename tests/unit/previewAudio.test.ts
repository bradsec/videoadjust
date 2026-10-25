import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Input } from 'mediabunny';
import type { AddedAudio } from '../../src/core/audioMix';
import { dbGain } from '../../src/core/audioProcess';
import {
  addedAudioTime,
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

  it('is unity without a target', () => {
    expect(previewGain(null, 0, 5)).toBe(1);
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

  it('resumes a graph created by an edit during active video playback', () => {
    const resumes = vi.fn();
    const gains: number[] = [];
    const ceilings: { curve: Float32Array | null }[] = [];
    const node = () => ({
      gain: { setTargetAtTime: (value: number) => gains.push(value) },
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
    const video = Object.assign(new EventTarget(), { currentTime: 15, paused: false });
    const preview = mountPreviewAudio(video as HTMLVideoElement, {} as Input);
    preview.update({
      trim: { start: 10, end: 20 },
      channels: 2,
      processing: { gainDb: -6 },
      mix: { original: { include: false, volumeDb: 0 } },
    });
    expect(resumes).toHaveBeenCalledOnce();
    expect(gains[0]).toBe(0);
    expect(gains[2]).toBeCloseTo(0.501187, 6);
    expect(ceilings[0]!.curve).not.toBeNull();
    preview.update({ trim: { start: 10, end: 20 }, channels: 2 });
    expect(ceilings[0]!.curve).toBeNull();
    preview.destroy();
  });
});

describe('added preview lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(play: () => Promise<void>) {
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
        currentTime = 0;
        destination = {};
        createGain = node;
        createWaveShaper = node;
        createMediaElementSource = node;
        resume = () => Promise.resolve();
        close = () => Promise.resolve();
      },
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const playCalls = vi.fn(play);
    const audio: { current?: EventTarget & { volume: number; muted: boolean } } = {};
    vi.stubGlobal(
      'Audio',
      class extends EventTarget {
        paused = true;
        readyState = 1;
        currentTime = 0;
        volume = 1;
        muted = false;
        constructor() {
          super();
          audio.current = this;
        }
        play = playCalls;
        pause() {}
        removeAttribute() {}
        load() {}
      },
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const video = Object.assign(new EventTarget(), {
      paused: false,
      currentTime: 1,
      playbackRate: 1,
      seeking: false,
      volume: 0.4,
      muted: false,
    });
    const messages: string[] = [];
    const preview = mountPreviewAudio(
      video as HTMLVideoElement,
      {} as Input,
      () => {},
      (message) => messages.push(message),
    );
    const target = {
      channels: 2,
      trim: { start: 0, end: 5 },
      mix: {
        original: { include: true, volumeDb: 0 },
        added: { volumeDb: 0, offset: 0, loop: true },
      },
      added: {
        file: new File([''], 'audio.mp3'),
        input: {} as Input,
        duration: 2,
        channels: 1,
        sampleRate: 48000,
      } satisfies AddedAudio,
    };
    const update = () => preview.update(target);
    return { preview, update, video, audio: () => audio.current!, playCalls, messages };
  }

  it('keeps one play pending and shares native video volume and mute', () => {
    const h = setup(() => new Promise(() => {}));
    h.update();
    h.update();
    expect(h.playCalls).toHaveBeenCalledOnce();
    expect(h.audio().volume).toBe(0.4);
    h.video.muted = true;
    h.video.volume = 0.2;
    h.video.dispatchEvent(new Event('volumechange'));
    expect(h.audio().muted).toBe(true);
    expect(h.audio().volume).toBe(0.2);
    h.preview.destroy();
  });

  it('reports native playback failure once and retries only after explicit play', () => {
    const h = setup(() => new Promise(() => {}));
    h.update();
    h.audio().dispatchEvent(new Event('error'));
    h.audio().dispatchEvent(new Event('error'));
    h.update();
    expect(h.messages.filter(Boolean)).toHaveLength(1);
    expect(h.messages.at(-1)).toContain('export');
    h.video.dispatchEvent(new Event('play'));
    expect(h.playCalls).toHaveBeenCalledTimes(2);
    h.preview.destroy();
  });

  it('stops retrying after a rejected native play promise', async () => {
    const h = setup(() =>
      Promise.reject(new DOMException('Unsupported codec', 'NotSupportedError')),
    );
    h.update();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    h.update();
    expect(h.playCalls).toHaveBeenCalledOnce();
    expect(h.messages.filter(Boolean)).toHaveLength(1);
    h.preview.destroy();
  });

  it('does not permanently disable playback after an expected play AbortError', async () => {
    const h = setup(() => Promise.reject(new DOMException('Playback paused', 'AbortError')));
    h.update();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    h.update();
    expect(h.playCalls).toHaveBeenCalledTimes(2);
    expect(h.messages.filter(Boolean)).toHaveLength(0);
    h.preview.destroy();
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
