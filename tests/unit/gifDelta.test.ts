import { describe, expect, it } from 'vitest';
import { createDeltaEncoder } from '../../src/core/gifDelta';

function frame(pixels: [number, number, number][]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => rgba.set([r, g, b, 255], i * 4));
  return rgba;
}

const red: [number, number, number] = [255, 0, 0];
const green: [number, number, number] = [0, 255, 0];
const blue: [number, number, number] = [0, 0, 255];

describe('GIF delta frames', () => {
  it('writes the first frame in full without transparency', () => {
    const encode = createDeltaEncoder(256, 0);
    const out = encode(frame([red, green, blue, red]));
    expect(out.transparentIndex).toBeNull();
    expect(out.index).toHaveLength(4);
    expect(out.palette[out.index[0]!]).toEqual(red);
    expect(out.palette[out.index[2]!]).toEqual(blue);
  });

  it('leaves unchanged pixels transparent and repaints only changed ones', () => {
    const encode = createDeltaEncoder(256, 0);
    encode(frame([red, green, blue, red]));
    const out = encode(frame([red, blue, blue, red]));
    const t = out.transparentIndex!;
    expect(t).not.toBeNull();
    expect([out.index[0], out.index[2], out.index[3]]).toEqual([t, t, t]);
    expect(out.palette[out.index[1]!]).toEqual(blue);
  });

  it('never maps a changed pixel to the transparent index', () => {
    const encode = createDeltaEncoder(256, 0);
    encode(frame([red, red]));
    const out = encode(frame([[0, 0, 0], red]));
    expect(out.index[0]).not.toBe(out.transparentIndex);
    expect(out.palette[out.index[0]!]).toEqual([0, 0, 0]);
  });

  it('treats differences within the threshold as unchanged', () => {
    const encode = createDeltaEncoder(256, 8);
    encode(frame([red, green]));
    const out = encode(
      frame([
        [250, 4, 3],
        [0, 200, 0],
      ]),
    );
    expect(out.index[0]).toBe(out.transparentIndex);
    expect(out.index[1]).not.toBe(out.transparentIndex);
  });

  it('compares against the shown image so small drifts cannot accumulate', () => {
    const encode = createDeltaEncoder(256, 8);
    encode(frame([[100, 100, 100]]));
    expect(encode(frame([[106, 100, 100]])).transparentIndex).not.toBeNull();
    const drifted = encode(frame([[112, 100, 100]]));
    expect(drifted.index[0]).not.toBe(drifted.transparentIndex);
  });

  it('writes a fully transparent frame when nothing changed', () => {
    const encode = createDeltaEncoder(64, 0);
    encode(frame([red, green]));
    const out = encode(frame([red, green]));
    expect(out.index.every((i) => i === out.transparentIndex)).toBe(true);
  });

  it('keeps the palette within GIF limits', () => {
    const encode = createDeltaEncoder(256, 0);
    const pixels = Array.from({ length: 4096 }, (_, i): [number, number, number] => [
      i % 256,
      (i * 7) % 256,
      (i * 13) % 256,
    ]);
    encode(frame(pixels));
    // Half the pixels change, so this stays a delta frame with its transparent slot.
    const out = encode(
      frame(pixels.map(([r, g, b], i) => (i % 2 ? [r, g, b] : [255 - r, 255 - g, 255 - b]))),
    );
    expect(out.transparentIndex).not.toBeNull();
    expect(out.palette.length).toBeLessThanOrEqual(256);
    expect(Math.max(...out.index)).toBeLessThan(256);
  });

  it('writes full frames when the threshold is null', () => {
    const encode = createDeltaEncoder(256, null);
    encode(frame([red, green]));
    expect(encode(frame([red, green])).transparentIndex).toBeNull();
  });

  it('writes a full frame when most pixels changed', () => {
    const encode = createDeltaEncoder(256, 0);
    encode(frame([red, red, red, red]));
    expect(encode(frame([blue, blue, blue, red])).transparentIndex).toBeNull();
    const next = encode(frame([blue, blue, blue, green]));
    expect(next.transparentIndex).not.toBeNull();
    expect(next.index[0]).toBe(next.transparentIndex);
  });
});
