// Test-only page. vite.config.ts builds it only when VR_E2E=1, so the deployed site has no harness.
import { chooseSink } from '../src/core/sink';
import { readSource, UnsupportedSourceError } from '../src/core/source';
import type { SourceInfo } from '../src/core/types';

export type ReadResult =
  | { ok: true; info: SourceInfo }
  | { ok: false; error: { name: string; message: string; codec: string | null } };

const fileInput = document.getElementById('file') as HTMLInputElement;

const harness = {
  async readSource(): Promise<ReadResult> {
    const file = fileInput.files?.[0];
    if (!file) throw new Error('No file selected in the harness');
    try {
      const { info } = await readSource(file);
      return { ok: true, info };
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        error: { name: e.name, message: e.message, codec: err instanceof UnsupportedSourceError ? err.codec : null },
      };
    }
  },
  chooseSink,
};

declare global {
  interface Window {
    vrHarness: typeof harness;
  }
}
window.vrHarness = harness;
