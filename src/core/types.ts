export type Container = 'mp4' | 'webm';
export type VideoCodecId = 'avc' | 'hevc' | 'av1' | 'vp9';
export type AudioCodecId = 'aac' | 'opus';

export interface SourceInfo {
  name: string;
  sizeBytes: number;
  durationSec: number;
  containerMime: string;
  video: null | {
    codec: string | null;      // Mediabunny codec id, null if unknown
    decodable: boolean;
    displayWidth: number;      // after rotation
    displayHeight: number;
    rotation: 0 | 90 | 180 | 270;
    fps: number;
    bitrate: number | null;    // bits/s, estimated from packet stats
  };
  audio: null | {
    codec: string | null;
    decodable: boolean;
    channels: number;
    sampleRate: number;
    bitrate: number | null;
  };
}

export interface Capabilities {
  video: Record<VideoCodecId, boolean>;   // probed at 1280x720 30fps
  audio: Record<AudioCodecId, boolean>;   // native or via fallback
  aacViaFallback: boolean;
  fileStreamSave: boolean;                // window.showSaveFilePicker
  shareFiles: boolean;                    // navigator.canShare({files})
}

export interface Settings {
  container: Container;
  passthrough: boolean;
  trim: { start: number; end: number };
  video: null | { codec: VideoCodecId; width: number; height: number; fps: number; bitrate: number };
  audio: null | { codec: AudioCodecId; bitrate: number; channels: number; copy: boolean };
}

export interface AutoResult {
  settings: Settings;
  alreadyOptimal: boolean;      // spec rule 5
  sizeSteps: number[];          // long-edge options <= source, e.g. [1920, 1280, 854]
  notes: string[];              // user-facing reasons, e.g. "No H.264 encoder in this browser"
}
