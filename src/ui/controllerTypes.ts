import type { Input, canEncodeVideo } from 'mediabunny';
import type { AudioExtractSettings } from '../core/audioExtract';
import type { probeCapabilities as probeCapabilitiesFn } from '../core/capabilities';
import type { GifSettings } from '../core/gifExport';
import type { OverlayAssets } from '../core/overlays';
import type { openSink as openSinkFn, SinkPlan } from '../core/sink';
import type { readSource as readSourceFn } from '../core/source';
import type { AutoResult, Capabilities, Settings, SourceInfo } from '../core/types';
import type { startConversion as startConversionFn } from '../core/convert';
import type { AudioProcessing } from '../core/audioProcess';
import type { AddedAudio, AudioMix } from '../core/audioMix';
import { readAddedAudio } from '../core/addedAudio';

/** Above this the app warns before reading the file (decimal, matching formatBytes). */
export const LARGE_FILE_BYTES = 2e9;

export interface Notice {
  tone: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  /** A file waiting on the user's "Continue anyway". */
  pending?: File;
  /** An export waiting on the user's "Continue" past the in-memory size warning. */
  confirm?: 'memory';
}

export type Tool = 'shrink' | 'audio' | 'gif';

/** The loaded source and its derived limits, carried from prepare through result. */
export interface Loaded {
  addedAudio?: AddedAudio;
  overlayAssets?: OverlayAssets;
  file: File;
  source: SourceInfo;
  input: Input;
  auto: AutoResult;
  caps: Capabilities;
  settings: Settings;
  tool: Tool;
  /** Null when the audio tool is disabled; audioUnavailable(source) gives the reason. */
  audioAuto: AudioExtractSettings | null;
  /** Non-null whenever audioAuto is, so tool 'audio' always has settings. */
  audioSettings: AudioExtractSettings | null;
  gifAuto: GifSettings | null;
  gifSettings: GifSettings | null;
}

export type AppState =
  | { kind: 'drop'; notice?: Notice; reading?: string }
  | (Loaded & {
      kind: 'prepare';
      notice?: Notice;
      /** An export started and still awaits its encoder check or save picker. */
      exporting?: boolean;
      addingAudio?: boolean;
    })
  | (Loaded & {
      kind: 'working';
      outputName: string;
      sinkKind: SinkPlan['kind'];
      estimate: { low: number; high: number };
      progress: number;
      phase?: 'analysis' | 'encoding';
      bytes: number;
      startedAt: number;
    })
  | (Loaded & {
      kind: 'result';
      outputName: string;
      sinkKind: SinkPlan['kind'];
      elapsedMs: number;
      styleDropped?: boolean;
      /** Review Focus 4: the new file is the same size as the original or bigger. */
      notSmaller: boolean;
      output: { blob: Blob | null; sizeBytes: number; url: string | null; info: SourceInfo };
    });

export type AppAction =
  | { type: 'pick'; file: File }
  | { type: 'continueLarge' }
  | { type: 'dismissNotice' }
  | { type: 'reading'; name: string }
  | {
      type: 'loaded';
      file: File;
      source: SourceInfo;
      input: Input;
      auto: AutoResult;
      caps: Capabilities;
    }
  | { type: 'setTrim'; value: Settings['trim'] }
  | { type: 'setSettings'; value: Settings }
  | { type: 'setMix'; value: AudioMix }
  | { type: 'setAudioProcessing'; value: AudioProcessing }
  | { type: 'addAudio'; file: File }
  | { type: 'removeAddedAudio' }
  | { type: 'setOverlayImage'; file: File }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setAudioSettings'; value: AudioExtractSettings }
  | { type: 'setGifSettings'; value: GifSettings }
  | { type: 'export'; confirmed?: boolean }
  | { type: 'cancel' }
  | { type: 'smaller' }
  | { type: 'failed'; notice: Notice }
  | { type: 'resetAll' }
  | { type: 'reset' };

export interface AppDeps {
  readAddedAudio?: typeof readAddedAudio;
  probeCapabilities: typeof probeCapabilitiesFn;
  canEncodeVideo: typeof canEncodeVideo;
  readSource: typeof readSourceFn;
  startConversion: typeof startConversionFn;
  openSink: typeof openSinkFn;
  ensureMp3Encoder: () => Promise<void>;
  /** navigator.deviceMemory where the browser reports it. */
  deviceMemoryGB?: number;
}
