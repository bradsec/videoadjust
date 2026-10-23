import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';

test('network navigation keeps precached HTML for offline use', async () => {
  const request = new Request('https://videoadjust.test/index.html');
  const html = new Map([[request.url, new Response('precached version')]]);
  const cache = {
    match: async (key: Request | string) => html.get(typeof key === 'string' ? key : key.url),
    put: async (key: Request, response: Response) => {
      html.set(key.url, response);
    },
  };
  const fetch = vi.fn().mockResolvedValue(new Response('new deploy'));
  const navigate = runInNewContext(
    `${readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')}\nnetworkFirst`,
    {
      self: { registration: { scope: 'https://videoadjust.test/' }, addEventListener: () => {} },
      caches: { open: async () => cache },
      fetch,
      URL,
      setTimeout: () => {},
    },
  ) as (request: Request) => Promise<Response>;

  expect(await (await navigate(request)).text()).toBe('new deploy');
  fetch.mockRejectedValue(new Error('offline'));
  expect(await (await navigate(request)).text()).toBe('precached version');
});
