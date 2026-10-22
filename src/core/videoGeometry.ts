import type { CropRectangle } from 'mediabunny';
import { scaleToLongEdge } from './autoSettings';
import type { CropPreset, Rotation, SourceInfo } from './types';

export function rotatedSize(width: number, height: number, rotate: Rotation) {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

export function cropRectangle(
  width: number,
  height: number,
  preset: CropPreset,
): CropRectangle | null {
  if (preset === 'original') return null;
  if (preset === 'landscape' && width < height) return null;
  const [unitWidth, unitHeight] =
    preset === 'square' ? [2, 2] : preset === 'portrait' ? [18, 32] : [32, 18];
  const units = Math.floor(Math.min(width / unitWidth, height / unitHeight));
  if (units < 1) return null;
  const cropWidth = units * unitWidth;
  const cropHeight = units * unitHeight;
  return {
    left: Math.floor((width - cropWidth) / 2),
    top: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

export function videoFrameSize(
  source: NonNullable<SourceInfo['video']>,
  rotate: Rotation,
  crop: CropPreset,
): { width: number; height: number } {
  const rotated = rotatedSize(source.displayWidth, source.displayHeight, rotate);
  const rect = cropRectangle(rotated.width, rotated.height, crop);
  return rect ? { width: rect.width, height: rect.height } : rotated;
}

export function outputSize(
  source: NonNullable<SourceInfo['video']>,
  rotate: Rotation,
  crop: CropPreset,
  longEdge: number,
): { width: number; height: number } {
  const frame = videoFrameSize(source, rotate, crop);
  return scaleToLongEdge(frame.width, frame.height, longEdge);
}
