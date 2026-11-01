import { describe, expect, it, vi } from 'vitest';
import { createPictureCheck, peakLevel } from '../../src/ui/previewNotices';

const pixels = (level: number, alpha = 255) =>
  new Uint8ClampedArray([level, level, level, alpha, level, level, level, alpha]);
const black = pixels(0);
const transparent = pixels(0, 0);
const picture = pixels(120);

function check(video: Uint8ClampedArray | null, decoded: Uint8ClampedArray | null) {
  const onBroken = vi.fn();
  const sampleDecoded = vi.fn(async () => decoded);
  const result = createPictureCheck({ sampleVideo: () => video, sampleDecoded, onBroken });
  return { result, onBroken, sampleDecoded };
}

describe('preview picture check', () => {
  it('reads the brightest channel', () => {
    expect(peakLevel(new Uint8ClampedArray([1, 200, 3, 255, 9, 9, 9, 255]))).toBe(200);
  });

  it('flags black video frames when the decoded frames have a picture at two positions', async () => {
    const { result, onBroken } = check(black, picture);
    await result.frame(0);
    expect(onBroken).not.toHaveBeenCalled();
    await result.frame(1);
    expect(onBroken).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(true);
  });

  it('treats a transparent sample as black', async () => {
    const { result, onBroken } = check(transparent, picture);
    await result.frame(0);
    await result.frame(1);
    expect(onBroken).toHaveBeenCalledTimes(1);
  });

  it('needs separate positions, not repeated frames at the same time', async () => {
    const { result, onBroken } = check(black, picture);
    await result.frame(0);
    await result.frame(0.1);
    await result.frame(0.2);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it('never flags footage that is black in the decoded frames too', async () => {
    const { result, onBroken } = check(black, black);
    for (let t = 0; t < 10; t++) await result.frame(t);
    expect(onBroken).not.toHaveBeenCalled();
    expect(result.done).toBe(true);
  });

  it('stops checking once the video shows a picture', async () => {
    const { result, onBroken, sampleDecoded } = check(picture, picture);
    await result.frame(0);
    await result.frame(1);
    expect(onBroken).not.toHaveBeenCalled();
    expect(sampleDecoded).not.toHaveBeenCalled();
    expect(result.done).toBe(true);
  });

  it('does not flag when the decoded frame is unavailable', async () => {
    const { result, onBroken } = check(black, null);
    await result.frame(0);
    await result.frame(1);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it('flags a fade-in only if the video stays black after the decoded frames brighten', async () => {
    const decoded = [black, picture, picture];
    let call = 0;
    const onBroken = vi.fn();
    const result = createPictureCheck({
      sampleVideo: () => black,
      sampleDecoded: async () => decoded[call++] ?? picture,
      onBroken,
    });
    await result.frame(0);
    await result.frame(1);
    expect(onBroken).not.toHaveBeenCalled();
    await result.frame(2);
    expect(onBroken).toHaveBeenCalledTimes(1);
  });
});
