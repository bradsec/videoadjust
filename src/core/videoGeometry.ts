import { scaleToLongEdge } from './autoSettings';
import type { CropPreset, CropRect, Rotation, SourceInfo } from './types';

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const nearestEven = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const units: Record<Exclude<CropPreset, 'original' | 'free'>, [number, number]> = {
  square: [2, 2],
  '4:5': [8, 10],
  portrait: [18, 32],
  landscape: [32, 18],
};

function originalUnits(width: number, height: number): [number, number, boolean] {
  let a = width;
  let b = height;
  while (b) [a, b] = [b, a % b];
  let unitWidth = width / a;
  let unitHeight = height / a;
  if (unitWidth % 2 || unitHeight % 2) {
    unitWidth *= 2;
    unitHeight *= 2;
  }
  // Coarse reduced units make each drag jump too far; use two-pixel widths and round heights to even.
  if (unitWidth > width / 8 || unitHeight > height / 8) return [2, (2 * height) / width, true];
  return [unitWidth, unitHeight, false];
}

function lockedSize(count: number, unitWidth: number, unitHeight: number, approximate: boolean) {
  return {
    width: count * unitWidth,
    height: approximate ? nearestEven(count * unitHeight) : count * unitHeight,
  };
}

export function rotatedSize(width: number, height: number, rotate: Rotation) {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

export function cropRectangle(width: number, height: number, preset: CropPreset): CropRect | null {
  if (preset === 'original') return null;
  if (preset === 'free') return { left: 0, top: 0, width: even(width), height: even(height) };
  const [unitWidth, unitHeight] = units[preset];
  const count = Math.floor(Math.min(width / unitWidth, height / unitHeight));
  if (count < 1) return null;
  const cropWidth = count * unitWidth;
  const cropHeight = count * unitHeight;
  return {
    left: Math.floor((width - cropWidth) / 2),
    top: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

export function normalizeCrop(
  width: number,
  height: number,
  preset: CropPreset,
  rect?: CropRect | null,
): CropRect | null {
  if (
    preset === 'original' &&
    (!rect ||
      (rect.left <= 0 &&
        rect.top <= 0 &&
        rect.left + rect.width >= width &&
        rect.top + rect.height >= height))
  )
    return null;
  const fitted =
    preset === 'original'
      ? { left: 0, top: 0, width, height }
      : cropRectangle(width, height, preset);
  if (!fitted || !rect) return fitted;
  const rawWidth = Number.isFinite(rect.width) ? rect.width : fitted.width;
  const rawHeight = Number.isFinite(rect.height) ? rect.height : fitted.height;
  let cropWidth: number;
  let cropHeight: number;
  if (preset === 'free') {
    cropWidth = even(clamp(rawWidth, 2, width));
    cropHeight = even(clamp(rawHeight, 2, height));
  } else {
    const [unitWidth, unitHeight, approximate] =
      preset === 'original' ? originalUnits(width, height) : ([...units[preset], false] as const);
    const widthCount = Math.round(rawWidth / unitWidth);
    const count = clamp(
      approximate && nearestEven(widthCount * unitHeight) === rawHeight
        ? widthCount
        : Math.round(Math.min(rawWidth / unitWidth, rawHeight / unitHeight)),
      1,
      Math.floor(Math.min(width / unitWidth, height / unitHeight)),
    );
    const size = lockedSize(count, unitWidth, unitHeight, approximate);
    cropWidth = size.width;
    cropHeight = size.height;
  }
  if (preset === 'original' && cropWidth >= width && cropHeight >= height) return null;
  const centerX = Number.isFinite(rect.left) ? rect.left + rawWidth / 2 : width / 2;
  const centerY = Number.isFinite(rect.top) ? rect.top + rawHeight / 2 : height / 2;
  return {
    left: Math.round(clamp(centerX - cropWidth / 2, 0, width - cropWidth)),
    top: Math.round(clamp(centerY - cropHeight / 2, 0, height - cropHeight)),
    width: cropWidth,
    height: cropHeight,
  };
}

export function moveCrop(
  rect: CropRect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): CropRect {
  return {
    ...rect,
    left: Math.round(clamp(rect.left + dx, 0, width - rect.width)),
    top: Math.round(clamp(rect.top + dy, 0, height - rect.height)),
  };
}

export type CropHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  width: number,
  height: number,
  preset: CropPreset,
): CropRect {
  const x = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const y = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const min = Math.min(32, even(Math.min(width, height)));
  if (preset === 'free') {
    let left = rect.left + (x < 0 ? dx : 0);
    let right = rect.left + rect.width + (x > 0 ? dx : 0);
    let top = rect.top + (y < 0 ? dy : 0);
    let bottom = rect.top + rect.height + (y > 0 ? dy : 0);
    left = clamp(left, 0, right - min);
    right = clamp(right, left + min, width);
    top = clamp(top, 0, bottom - min);
    bottom = clamp(bottom, top + min, height);
    const cropWidth = even(right - left);
    const cropHeight = even(bottom - top);
    return {
      left: Math.round(clamp(x < 0 ? right - cropWidth : left, 0, width - cropWidth)),
      top: Math.round(clamp(y < 0 ? bottom - cropHeight : top, 0, height - cropHeight)),
      width: cropWidth,
      height: cropHeight,
    };
  }
  const [unitWidth, unitHeight, approximate] =
    preset === 'original' ? originalUnits(width, height) : ([...units[preset], false] as const);
  const horizontal = (x * dx) / unitWidth;
  const vertical = (y * dy) / unitHeight;
  const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxWidth =
    x > 0
      ? width - rect.left
      : x < 0
        ? rect.left + rect.width
        : 2 * Math.min(centerX, width - centerX);
  const maxHeight =
    y > 0
      ? height - rect.top
      : y < 0
        ? rect.top + rect.height
        : 2 * Math.min(centerY, height - centerY);
  const maxUnits = Math.floor(Math.min(maxWidth / unitWidth, maxHeight / unitHeight));
  const minUnits = Math.min(
    maxUnits,
    Math.max(1, Math.ceil(min / Math.min(unitWidth, unitHeight))),
  );
  const previousCount = Math.round(rect.width / unitWidth);
  let count = Math.round(previousCount + delta);
  if (preset === 'original' && delta !== 0 && count === previousCount) count += Math.sign(delta);
  count = clamp(count, minUnits, maxUnits);
  let size = lockedSize(count, unitWidth, unitHeight, approximate);
  while (count > minUnits && (size.width > maxWidth || size.height > maxHeight)) {
    size = lockedSize(--count, unitWidth, unitHeight, approximate);
  }
  const cropWidth = size.width;
  const cropHeight = size.height;
  return {
    left: Math.round(
      x > 0 ? rect.left : x < 0 ? rect.left + rect.width - cropWidth : centerX - cropWidth / 2,
    ),
    top: Math.round(
      y > 0 ? rect.top : y < 0 ? rect.top + rect.height - cropHeight : centerY - cropHeight / 2,
    ),
    width: cropWidth,
    height: cropHeight,
  };
}

export function remapCrop(
  rect: CropRect,
  width: number,
  height: number,
  fromRotate: Rotation,
  fromFlip: boolean,
  toRotate: Rotation,
  toFlip: boolean,
  preset: CropPreset,
): CropRect | null {
  const fromSize = rotatedSize(width, height, fromRotate);
  const toSize = rotatedSize(width, height, toRotate);
  const mapPoint = (x: number, y: number) => {
    if (fromFlip) x = fromSize.width - x;
    const [sourceX, sourceY] =
      fromRotate === 90
        ? [y, height - x]
        : fromRotate === 180
          ? [width - x, height - y]
          : fromRotate === 270
            ? [width - y, x]
            : [x, y];
    const [nextX, nextY] =
      toRotate === 90
        ? [height - sourceY, sourceX]
        : toRotate === 180
          ? [width - sourceX, height - sourceY]
          : toRotate === 270
            ? [sourceY, width - sourceX]
            : [sourceX, sourceY];
    return [toFlip ? toSize.width - nextX : nextX, nextY];
  };
  const corners = [
    mapPoint(rect.left, rect.top),
    mapPoint(rect.left + rect.width, rect.top),
    mapPoint(rect.left, rect.top + rect.height),
    mapPoint(rect.left + rect.width, rect.top + rect.height),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return normalizeCrop(toSize.width, toSize.height, preset, {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  });
}

export function videoFrameSize(
  source: NonNullable<SourceInfo['video']>,
  rotate: Rotation,
  crop: CropPreset,
  rect?: CropRect | null,
): { width: number; height: number } {
  const rotated = rotatedSize(source.displayWidth, source.displayHeight, rotate);
  const effective = normalizeCrop(rotated.width, rotated.height, crop, rect);
  return effective ? { width: effective.width, height: effective.height } : rotated;
}

export function outputSize(
  source: NonNullable<SourceInfo['video']>,
  rotate: Rotation,
  crop: CropPreset,
  longEdge: number,
  rect?: CropRect | null,
): { width: number; height: number } {
  const frame = videoFrameSize(source, rotate, crop, rect);
  return scaleToLongEdge(frame.width, frame.height, longEdge);
}
