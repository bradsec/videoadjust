import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { AudioCodecId, Capabilities, VideoCodecId } from './types';

declare global {
  interface Window {
    // File System Access API; absent from TypeScript's DOM lib and from Safari and Firefox.
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

export type ProbeDeps = {
  canEncodeVideo: typeof canEncodeVideo;
  canEncodeAudio: typeof canEncodeAudio;
  registerAacFallback: () => Promise<boolean>;
  win: Pick<Window, 'showSaveFilePicker'> & { navigator: Navigator };
};

const VIDEO_CODECS: VideoCodecId[] = ['avc', 'hevc', 'av1', 'vp9'];
const AUDIO_CODECS: AudioCodecId[] = ['aac', 'opus'];
const VIDEO_PROBE = { width: 1280, height: 720, frameRate: 30 };

// The encoder package embeds FFmpeg's LGPL-2.1+ AAC encoder as WASM. The dynamic
// import keeps it in its own same-origin chunk, fetched only when the browser has
// no native AAC encoder.
export async function registerAacFallback(): Promise<boolean> {
  const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
  registerAacEncoder();
  return true;
}

async function probe(check: () => Promise<boolean>, label: string): Promise<boolean> {
  try {
    return (await check()) === true;
  } catch (err) {
    console.warn(`capability probe failed: ${label}`, err);
    return false;
  }
}

export async function probeCapabilities(deps?: ProbeDeps): Promise<Capabilities> {
  const d: ProbeDeps = deps ?? {
    canEncodeVideo,
    canEncodeAudio,
    registerAacFallback,
    win: window,
  };

  const videoResults = await Promise.all(
    VIDEO_CODECS.map((codec) => probe(() => d.canEncodeVideo(codec, VIDEO_PROBE), codec)),
  );
  const audioResults = await Promise.all(
    AUDIO_CODECS.map((codec) => probe(() => d.canEncodeAudio(codec), codec)),
  );
  const video = Object.fromEntries(VIDEO_CODECS.map((c, i) => [c, videoResults[i]])) as Capabilities['video'];
  const audio = Object.fromEntries(AUDIO_CODECS.map((c, i) => [c, audioResults[i]])) as Capabilities['audio'];

  let aacViaFallback = false;
  if (!audio.aac) {
    aacViaFallback = await probe(d.registerAacFallback, 'aac fallback');
    audio.aac = aacViaFallback;
  }

  const sample = new File([], 'x.mp4', { type: 'video/mp4' });
  return {
    video,
    audio,
    aacViaFallback,
    fileStreamSave: 'showSaveFilePicker' in d.win,
    shareFiles: d.win.navigator.canShare?.({ files: [sample] }) === true,
  };
}
