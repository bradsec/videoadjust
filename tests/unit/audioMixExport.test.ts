import { readFileSync } from 'node:fs';
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WavOutputFormat,
} from 'mediabunny';
import { expect, it, vi } from 'vitest';
import { audioExtractJob, startConversion } from '../../src/core/convert';

async function toneInput(amplitude: number): Promise<Input> {
  const target = new BufferTarget();
  const output = new Output({ target, format: new WavOutputFormat() });
  const source = new AudioSampleSource({ codec: 'pcm-s16' });
  output.addAudioTrack(source);
  await output.start();
  const sample = new AudioSample({
    data: new Float32Array(8000).fill(amplitude),
    format: 'f32-planar',
    sampleRate: 8000,
    numberOfChannels: 1,
    timestamp: 0,
  });
  try {
    await source.add(sample);
    source.close();
    await output.finalize();
  } finally {
    sample.close();
  }
  return new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS });
}

it('preserves the original export error when output cancellation also fails', async () => {
  const input = await toneInput(0.1);
  const failure = new Error('Audio decoding failed.');
  const cancel = vi
    .spyOn(Output.prototype, 'cancel')
    .mockRejectedValue(new Error('Cleanup failed.'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(
      startConversion({
        input,
        target: new BufferTarget(),
        format: new WavOutputFormat(),
        onProgress: () => {},
        job: {
          ...audioExtractJob({
            format: 'wav',
            trim: { start: 0, end: 1 },
            channels: 1,
            bitrate: 128000,
            copy: false,
            mix: { original: { include: true, volumeDb: 1 } },
          }),
          prepare: async () => {
            throw failure;
          },
        },
      }).done,
    ).rejects.toBe(failure);
  } finally {
    cancel.mockRestore();
    warning.mockRestore();
    input.dispose();
  }
});

it('exports a real summed WAV through a composable conversion and custom audio source', async () => {
  const input = await toneInput(0.1);
  const music = await toneInput(0.2);
  const target = new BufferTarget();
  let result: Input | undefined;
  try {
    const job = audioExtractJob(
      {
        format: 'wav',
        trim: { start: 0.25, end: 0.75 },
        channels: 2,
        bitrate: 128000,
        copy: false,
        mix: {
          original: { include: true, volumeDb: 0 },
          added: { volumeDb: 0, offset: 0.125, loop: false },
        },
      },
      { input: music, file: new File([], 'tone.wav'), duration: 1, channels: 1, sampleRate: 8000 },
    );
    await startConversion({
      input,
      job,
      format: new WavOutputFormat(),
      target,
      onProgress: () => {},
    }).done;
    result = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS });
    const track = await result.getPrimaryAudioTrack();
    expect(track?.numberOfChannels).toBe(2);
    expect(track?.sampleRate).toBe(48000);
    expect(await track?.computeDuration()).toBeCloseTo(0.5);
    const first = await new AudioSampleSink(track!).getSample(0);
    expect(first).not.toBeNull();
    const plane = new Float32Array(first!.numberOfFrames);
    first!.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
    expect(plane[0]).toBeCloseTo(0.1, 3);
    first!.close();
    const later = await new AudioSampleSink(track!).getSample(0.25);
    const data = new Float32Array(later!.numberOfFrames);
    later!.copyTo(data, { planeIndex: 1, format: 'f32-planar' });
    expect(data[Math.round((0.25 - later!.timestamp) * 48000)]).toBeCloseTo(0.3, 3);
    later!.close();
  } finally {
    result?.dispose();
    input.dispose();
    music.dispose();
  }
});

it('extracts added audio from a real input with no source audio', async () => {
  const input = new Input({
    source: new BufferSource(readFileSync(new URL('../fixtures/noaudio.mp4', import.meta.url))),
    formats: ALL_FORMATS,
  });
  const music = await toneInput(0.2);
  const target = new BufferTarget();
  let result: Input | undefined;
  try {
    await startConversion({
      input,
      job: audioExtractJob(
        {
          format: 'wav',
          trim: { start: 0, end: 0.5 },
          channels: 1,
          bitrate: 128000,
          copy: false,
          mix: {
            original: { include: true, volumeDb: 0 },
            added: { volumeDb: 0, offset: 0, loop: false },
          },
        },
        {
          input: music,
          file: new File([], 'tone.wav'),
          duration: 1,
          channels: 1,
          sampleRate: 8000,
        },
      ),
      format: new WavOutputFormat(),
      target,
      onProgress: () => {},
    }).done;
    result = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS });
    expect(await result.getPrimaryAudioTrack()).not.toBeNull();
    expect(await (await result.getPrimaryAudioTrack())?.computeDuration()).toBeCloseTo(0.5);
  } finally {
    result?.dispose();
    input.dispose();
    music.dispose();
  }
});

it.each([true, false])(
  'exports a titled mixed MP4 with strip source metadata = %s',
  async (strip) => {
    const original = new Input({
      source: new BufferSource(readFileSync(new URL('../fixtures/noaudio.mp4', import.meta.url))),
      formats: ALL_FORMATS,
    });
    const tagged = new BufferTarget();
    const seed = await Conversion.init({
      input: original,
      output: new Output({ target: tagged, format: new Mp4OutputFormat() }),
      tags: { title: 'Source title', artist: 'Source artist' },
    });
    await seed.execute();
    const input = new Input({ source: new BufferSource(tagged.buffer!), formats: ALL_FORMATS });
    const music = await toneInput(0.2);
    const target = new BufferTarget();
    let result: Input | undefined;
    try {
      const job = audioExtractJob(
        {
          format: 'wav',
          trim: { start: 0.25, end: 0.75 },
          channels: 1,
          bitrate: 128000,
          copy: false,
          mix: {
            original: { include: false, volumeDb: 0 },
            added: { volumeDb: 0, offset: 0, loop: false },
          },
        },
        {
          input: music,
          file: new File([], 'tone.wav'),
          duration: 1,
          channels: 1,
          sampleRate: 8000,
        },
      );
      job.options.video = {};
      job.keeps.video = true;
      job.options.tags = strip
        ? { title: 'Mix title' }
        : (tags) => ({ ...tags, title: 'Mix title' });
      await startConversion({
        input,
        job,
        format: new Mp4OutputFormat(),
        target,
        onProgress: () => {},
      }).done;
      result = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS });
      expect(await result.getPrimaryVideoTrack()).not.toBeNull();
      expect(await result.getPrimaryAudioTrack()).not.toBeNull();
      expect(await (await result.getPrimaryAudioTrack())?.computeDuration()).toBeCloseTo(0.5);
      expect(await result.getMetadataTags()).toMatchObject({ title: 'Mix title' });
      expect((await result.getMetadataTags()).artist).toBe(strip ? undefined : 'Source artist');
    } finally {
      result?.dispose();
      input.dispose();
      music.dispose();
      original.dispose();
    }
  },
);
