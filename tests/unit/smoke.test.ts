import { expect, test } from 'vitest';
import config from '../../vite.config';

test('vite base is relative', () => {
  expect(config.base).toBe('./');
});
