import { expect, test } from '@playwright/test';
import type { Capabilities } from '../src/core/types';

test('probes capabilities after load', async ({ page, browserName }) => {
  await page.goto('/');
  const raw = await page.locator('html[data-caps]').getAttribute('data-caps');
  const caps = JSON.parse(raw!) as Capabilities;

  expect(Object.keys(caps.video).sort()).toEqual(['av1', 'avc', 'hevc', 'vp9']);
  expect(typeof caps.audio.aac).toBe('boolean');
  expect(typeof caps.fileStreamSave).toBe('boolean');
  expect(typeof caps.shareFiles).toBe('boolean');
  if (browserName === 'chromium') expect(caps.video.avc).toBe(true);
});
