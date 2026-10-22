import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { AudioCodecId, Capabilities, VideoCodecId } from './types';

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
// Registering twice would add a second custom encoder, so the first call's
// promise is reused. A failed load is not cached, so a later call can retry.
let aacRegistration: Promise<boolean> | undefined;

export function registerAacFallback(): Promise<boolean> {
  aacRegistration ??= import('@mediabunny/aac-encoder').then(
    ({ registerAacEncoder }) => {
      registerAacEncoder();
      return true;
    },
    (err: unknown) => {
      aacRegistration = undefined;
      throw err;
    },
  );
  return aacRegistration;
}

// The encoder package embeds LAME 3.100 (LGPL-2.0-or-later) as WASM. It is loaded on the
// first MP3 export only, never by probeCapabilities, and shares the retry rule above.
let mp3Registration: Promise<boolean> | undefined;

export function registerMp3Fallback(): Promise<boolean> {
  mp3Registration ??= import('@mediabunny/mp3-encoder').then(
    ({ registerMp3Encoder }) => {
      registerMp3Encoder();
      return true;
    },
    (err: unknown) => {
      mp3Registration = undefined;
      throw err;
    },
  );
  return mp3Registration;
}

export async function ensureMp3Encoder(
  deps: { canEncodeAudio: typeof canEncodeAudio; register: () => Promise<boolean> } = {
    canEncodeAudio,
    register: registerMp3Fallback,
  },
): Promise<void> {
  if (await deps.canEncodeAudio('mp3')) return;
  if (!(await deps.register())) throw new Error('No MP3 encoder is available in this browser');
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
  const video = Object.fromEntries(
    VIDEO_CODECS.map((c, i) => [c, videoResults[i]]),
  ) as Capabilities['video'];
  const audio = Object.fromEntries(
    AUDIO_CODECS.map((c, i) => [c, audioResults[i]]),
  ) as Capabilities['audio'];

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
