# Draft upstream issue: AAC pre-roll exposes WebKit AudioDecoder timestamp regression

Do not file without reviewing against the target WebKit and Mediabunny versions.

## Summary

Mediabunny 1.63.0 began decoding the AAC pre-roll packet at a negative timestamp. Playwright WebKit 2370's native `AudioDecoder` returns incorrect timestamps when the first chunk has a negative timestamp. Mediabunny 1.63.0 through 1.65.0 then pass a backward timestamp to the native AAC encoder, and the MP4 muxer rejects its output. Mediabunny 1.62.1 does not decode the negative-timestamp packet and completes the export.

## Environment and app reproduction

- Linux Debian 13, Node 22.19.0, Playwright 1.64.1, WebKit revision 2370 (user agent `Version/27.2 Safari/605.1.15`).
- Source: `tests/fixtures/land-1080p30-aac.mp4`, AAC 48 kHz, first packet pts -0.021333 s with 1024 skip samples.
- `CI=1 pnpm exec playwright test --project=webkit e2e/convert.spec.ts:200 -g m4a --reporter=line`
- Mediabunny 1.65.0: 3 of 3 runs failed. Mediabunny 1.63.0: failed. Mediabunny 1.62.1: passed. Chromium passed at 1.65.0.
- Failure: `Timestamps cannot be smaller than the largest timestamp of the previous GOP (a GOP begins with a key packet and ends right before the next key packet). Got 2.996s, but largest timestamp is 3.017333333333333s.`

The smaller `e2e/webkit-aac.spec.ts` uses `tests/fixtures/land-aac-only.m4a`, which retains the same AAC packets and negative first timestamp without video. It fails with the same `Got 2.996s` error on Mediabunny 1.65.0 and passes on 1.62.1. Run `CI=1 pnpm exec playwright test --project=webkit e2e/webkit-aac.spec.ts --reporter=line` after selecting the Mediabunny version.

The same error appears in 21 WebKit-family CI failures in run 41231773447. The app shows `The export failed`; UI tests wait for a result that never appears.

## Standalone WebCodecs reproduction

This script uses neither the app nor Mediabunny. Run it from a checkout with `@playwright/test` 1.64.1 installed as `node webkit-aac-negative-ts.mjs`.

```js
import { webkit } from '@playwright/test';

const browser = await webkit.launch();
const page = await browser.newPage();
await page.route('https://repro.test/', (route) =>
  route.fulfill({ contentType: 'text/html', body: '<p>repro</p>' }),
);
await page.goto('https://repro.test/');
console.log(
  JSON.stringify(
    await page.evaluate(async () => {
      const sampleRate = 48000;
      const channels = 2;
      const frameCount = 1024;
      const timestamp = (i) => Math.round(((i * frameCount) / sampleRate) * 1e6);
      const chunks = [];
      let config;
      const encoder = new AudioEncoder({
        output: (chunk, metadata) => {
          config ??= metadata?.decoderConfig;
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          chunks.push(bytes);
        },
        error: (error) => {
          throw error;
        },
      });
      encoder.configure({
        codec: 'mp4a.40.2',
        sampleRate,
        numberOfChannels: channels,
        bitrate: 128000,
      });
      for (let i = 0; i < 8; i++) {
        encoder.encode(
          new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfChannels: channels,
            numberOfFrames: frameCount,
            timestamp: timestamp(i),
            data: new Float32Array(frameCount * channels).map((_, k) => Math.sin(k / 10) * 0.2),
          }),
        );
      }
      await encoder.flush();
      const decode = async (offset) => {
        const output = [];
        const decoder = new AudioDecoder({
          output: (audio) => {
            output.push(audio.timestamp);
            audio.close();
          },
          error: (error) => output.push(String(error)),
        });
        decoder.configure(config);
        chunks.forEach((bytes, i) =>
          decoder.decode(
            new EncodedAudioChunk({
              type: 'key',
              timestamp: offset + timestamp(i),
              duration: timestamp(1),
              data: bytes,
            }),
          ),
        );
        await decoder.flush();
        return output;
      };
      return { fromZero: await decode(0), fromNegative: await decode(-21333) };
    }),
  ),
);
await browser.close();
```

Observed on WebKit 2370:

```text
fromZero     inputs  [0, 21333, 42667, 64000, 85333, 106667, 128000, 149333]
             outputs [0, 21333, 42667, 64000, 85333, 106667, 128000, 149333]
fromNegative inputs  [-21333, 0, 21334, 42667, 64000, 85334, 106667, 128000]
             outputs [-128000, -106667, -85334, -64000, -42667, -21334, 0, -21333]
```

The final negative-start output steps backward. In Mediabunny, `AudioDecoderWrapper` resyncs to that timestamp, so the last sample is assigned 2.944 s after a 2.965333 s sample. The native encoder retains the backward order, and the MP4 muxer rejects the packet. The 1.63.0 release's audio decoder pre-roll change makes the negative packet reachable; see [v1.63.0 release notes](https://github.com/Vanilagy/mediabunny/releases/tag/v1.63.0), accessed 2026-11-01. This points to a WebKit decoder defect. Mediabunny could consider keeping its native decode input timestamps non-negative or avoiding backward resyncs.

Real Safari on macOS and iOS has not been tested. The standalone script could not run on Playwright Chromium because it lacks native AAC encoding.
