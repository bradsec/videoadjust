import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPTIONS,
  captionAt,
  captionOverlays,
  hasCaptions,
  normalizeCaptions,
  parseSubtitles,
} from '../../src/core/captions';

describe('parseSubtitles', () => {
  it('reads SRT cues with comma milliseconds, CRLF and multi-line text', () => {
    const srt =
      '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\nthere\r\n\r\n2\r\n00:01:02,250 --> 00:01:03,000\r\n<i>Second</i>\r\n';
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2.5, text: 'Hello\nthere' },
      { start: 62.25, end: 63, text: 'Second' },
    ]);
  });

  it('reads WebVTT with a header, cue ids, settings and short timestamps', () => {
    const vtt =
      'WEBVTT\n\nNOTE skipped\n\nintro\n00:01.000 --> 00:02.000 align:start line:90%\nOne\n\n00:00:03.000 --> 00:00:04.000\n<v Speaker>Two</v>\n';
    expect(parseSubtitles(vtt)).toEqual([
      { start: 1, end: 2, text: 'One' },
      { start: 3, end: 4, text: 'Two' },
    ]);
  });

  it('skips malformed blocks and cues that end before they start', () => {
    expect(
      parseSubtitles(
        'garbage\n\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n00:00:06,000 --> x\nBad',
      ),
    ).toEqual([]);
  });

  it('strips a byte order mark', () => {
    expect(parseSubtitles('\uFEFF1\n00:00:00,000 --> 00:00:01,000\nA')).toEqual([
      { start: 0, end: 1, text: 'A' },
    ]);
  });
});

describe('normalizeCaptions', () => {
  it('sorts cues, drops empty or invalid ones and clamps text length', () => {
    const value = normalizeCaptions({
      cues: [
        { start: 4, end: 5, text: 'B' },
        { start: 1, end: 2, text: 'A' },
        { start: 3, end: 3, text: 'zero length' },
        { start: 6, end: 7, text: '   ' },
        { start: Number.NaN, end: 1, text: 'nan' },
        { start: 8, end: 9, text: 'x'.repeat(600) },
      ],
      size: 'huge',
      position: 'top',
      background: 'box',
    });
    expect(value.cues.map((cue) => cue.text.slice(0, 1))).toEqual(['A', 'B', 'x']);
    expect(value.cues[2]!.text).toHaveLength(500);
    expect(value).toMatchObject({ size: 'medium', position: 'top', background: 'box' });
  });

  it('returns defaults for missing input and limits the cue count', () => {
    expect(normalizeCaptions(undefined)).toEqual(DEFAULT_CAPTIONS);
    const cues = Array.from({ length: 2100 }, (_, i) => ({ start: i, end: i + 0.5, text: 'c' }));
    expect(normalizeCaptions({ cues }).cues).toHaveLength(2000);
  });
});

describe('captionAt and overlays', () => {
  const captions = normalizeCaptions({
    cues: [
      { start: 1, end: 2, text: 'A' },
      { start: 2, end: 3, text: 'B' },
    ],
  });

  it('finds the cue showing at a source time, end exclusive', () => {
    expect(captionAt(captions, 0.5)).toBe(-1);
    expect(captionAt(captions, 1)).toBe(0);
    expect(captionAt(captions, 2)).toBe(1);
    expect(captionAt(captions, 3)).toBe(-1);
    expect(hasCaptions(captions)).toBe(true);
    expect(hasCaptions(DEFAULT_CAPTIONS)).toBe(false);
  });

  it('builds a text overlay sized to the short edge at the chosen position', () => {
    const landscape = captionOverlays(captions, 'Hi', 1920, 1080);
    const portrait = captionOverlays(
      { ...captions, position: 'top', background: 'box' },
      'Hi',
      1080,
      1920,
    );
    expect(landscape.text).toMatchObject({
      enabled: true,
      content: 'Hi',
      anchor: 'bottom-center',
      legibility: 'outline',
    });
    expect(landscape.image.enabled).toBe(false);
    expect(portrait.text).toMatchObject({ anchor: 'top-center', legibility: 'box' });
    expect(portrait.text.fontSize * 1920).toBeCloseTo(landscape.text.fontSize * 1080, 6);
  });
});

describe('subtitle character references', () => {
  it('decodes WebVTT escapes in cue text', () => {
    const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\nTom &amp; Jerry &lt;3\n';
    expect(parseSubtitles(vtt)[0]!.text).toBe('Tom & Jerry <3');
  });
});
