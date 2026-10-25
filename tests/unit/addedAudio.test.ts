import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readAddedAudio } from '../../src/core/addedAudio';

describe('added audio files', () => {
  it('rejects video without audio with a clear message', async () => {
    const bytes = await readFile(new URL('../fixtures/noaudio.mp4', import.meta.url));
    const file = new File([bytes], 'noaudio.mp4');
    await expect(readAddedAudio(file, new AbortController().signal)).rejects.toThrow(
      'no decodable audio',
    );
  });
  it('rejects unknown containers and respects cancellation before reading', async () => {
    const file = new File(['invalid'], 'invalid.wav');
    await expect(readAddedAudio(file, new AbortController().signal)).rejects.toThrow(
      'no decodable audio',
    );
    await expect(readAddedAudio(file, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
