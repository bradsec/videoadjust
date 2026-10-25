import { autoSettings } from '../core/autoSettings';
import { UnsupportedSourceError } from '../core/source';
import type { Capabilities } from '../core/types';
import { formatBytes } from './format';
import { codecLabel } from './controllerSettings';
import { LARGE_FILE_BYTES, type AppAction, type AppDeps, type Notice } from './controllerTypes';

export function createSourceLoader(deps: AppDeps, dispatch: (action: AppAction) => void) {
  let loadToken = 0;
  let caps: Promise<Capabilities> | undefined;

  function cancel(): void {
    loadToken++;
  }

  function pick(file: File): void {
    // Size is checked before any bytes are read.
    if (file.size > LARGE_FILE_BYTES) {
      dispatch({
        type: 'failed',
        notice: {
          tone: 'warn',
          title: `This video is ${formatBytes(file.size)}`,
          message:
            'Files over 2 GB can run out of memory on phones and tablets, and the tab may reload. Close other tabs first, or trim it shorter.',
          pending: file,
        },
      });
      return;
    }
    void load(file);
  }

  function getCaps(): Promise<Capabilities> {
    // A rejected probe is not cached, so the next pick retries it.
    caps ??= deps.probeCapabilities().catch((err: unknown) => {
      caps = undefined;
      throw err;
    });
    return caps;
  }

  async function load(file: File): Promise<void> {
    const token = ++loadToken;
    dispatch({ type: 'reading', name: file.name });
    try {
      const capabilities = await getCaps();
      if (token !== loadToken) return;
      const { info, input } = await deps.readSource(file);
      if (token !== loadToken) {
        input.dispose();
        return;
      }
      dispatch({
        type: 'loaded',
        file,
        source: info,
        input,
        auto: autoSettings(info, capabilities),
        caps: capabilities,
      });
    } catch (err) {
      if (token !== loadToken) return;
      dispatch({ type: 'failed', notice: noticeForError(file, err) });
    }
  }

  return { pick, load, cancel };
}

function noticeForError(file: File, err: unknown): Notice {
  if (err instanceof UnsupportedSourceError) {
    return {
      tone: 'error',
      title: err.codec
        ? `This browser cannot read ${codecLabel(err.codec)} video`
        : 'This file is not a video',
      message: `${file.name}: ${err.message}`,
    };
  }
  console.error('reading the video failed', err);
  return {
    tone: 'error',
    title: 'This video could not be opened',
    message: `${file.name} could not be read. It may be damaged or cut short. Try another file.`,
  };
}
