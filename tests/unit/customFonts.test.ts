import { afterEach, beforeEach, expect, test, vi } from 'vitest';

function request<T>(result: T) {
  const pending = { result, onsuccess: null as (() => void) | null };
  queueMicrotask(() => pending.onsuccess?.());
  return pending;
}

const fonts = new Set<unknown>();
let load: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fonts.clear();
  load = vi.fn(function (this: unknown) {
    return Promise.resolve(this);
  });
  vi.stubGlobal(
    'FontFace',
    class {
      load = load;
    },
  );
  vi.stubGlobal('document', { fonts });
  vi.stubGlobal('indexedDB', {
    open: () =>
      request({
        transaction: () => ({
          objectStore: () => ({
            getAll: () => request([{ id: 'saved', name: 'Saved', data: new ArrayBuffer(1) }]),
            delete: () => request(undefined),
          }),
        }),
        close: () => {},
      }),
  });
});

afterEach(() => vi.unstubAllGlobals());

test('removing a custom font unregisters its loaded FontFace', async () => {
  const { loadCustomFont, removeCustomFont } = await import('../../src/core/customFonts');
  await loadCustomFont('saved');
  expect(fonts.size).toBe(1);
  await removeCustomFont('saved');
  expect(fonts.size).toBe(0);
});

test('removing a custom font while it loads prevents later registration', async () => {
  const { listCustomFonts, loadCustomFont, removeCustomFont } =
    await import('../../src/core/customFonts');
  await listCustomFonts();
  let finish!: () => void;
  load.mockImplementation(function (this: unknown) {
    return new Promise((resolve) => {
      finish = () => resolve(this);
    });
  });
  const loading = loadCustomFont('saved');
  expect(load).toHaveBeenCalledOnce();
  await removeCustomFont('saved');
  finish();
  await loading;
  expect(fonts.size).toBe(0);
});
