import { describe, expect, it } from 'vitest';
import { DRIFT_SEC, canPlaySource, needsResync } from '../../src/ui/compare';

describe('needsResync', () => {
  it('leaves small drift alone', () => {
    expect(needsResync(1.0, 1.05)).toBe(false);
    expect(needsResync(1.05, 1.0)).toBe(false);
  });
  it('resyncs drift above DRIFT_SEC in either direction', () => {
    expect(DRIFT_SEC).toBe(0.1);
    expect(needsResync(1.0, 1.2)).toBe(true);
    expect(needsResync(1.2, 1.0)).toBe(true);
  });
});

describe('canPlaySource', () => {
  it('checks MOV codec support using the MP4 MIME type', () => {
    const checks: string[] = [];
    const video = {
      canPlayType(mime: string) {
        checks.push(mime);
        return mime.startsWith('video/mp4') ? 'probably' : '';
      },
    } as HTMLVideoElement;
    expect(canPlaySource(video, 'video/quicktime; codecs="avc1.640028"')).toBe(true);
    expect(checks).toEqual(['video/mp4; codecs="avc1.640028"']);
  });

  it('rejects an unsupported codec', () => {
    const video = { canPlayType: () => '' } as unknown as HTMLVideoElement;
    expect(canPlaySource(video, 'video/quicktime; codecs="hvc1"')).toBe(false);
  });
});
