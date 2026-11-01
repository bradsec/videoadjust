import { makePreviewProxy, previewStreamType } from '../core/previewProxy';
import type { AppAction, AppState } from './controller';
import { el } from './dom';
import { mountPreviewNotices, previewSoundUnavailable } from './previewNotices';
import { createAppendQueue } from './previewStream';

/** Seconds of streamed copy buffered before playback starts. */
const START_AFTER_SEC = 2;

/** A copy played through MediaSource while the rest of it converts. */
interface PreviewStream {
  media: MediaSource;
  url: string;
  queue?: ReturnType<typeof createAppendQueue>;
  started: boolean;
  /** Appending stopped; the whole copy plays once it is done. */
  stalled: boolean;
}

export function mountPreviewProxy(
  video: HTMLVideoElement,
  state: Extract<AppState, { kind: 'prepare' }>,
  dispatch: (action: AppAction) => void,
  originalUrl: string,
  referenceAt: (time: number) => CanvasImageSource | null,
) {
  const notices = mountPreviewNotices(video, state.source, referenceAt, () => proxy.start());
  let attempted = false;
  let bypassed = false;
  let destroyed = false;
  let job: ReturnType<typeof makePreviewProxy> | undefined;
  const status = el('p', 'note preview-proxy-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  const say = (text: string | null) => {
    status.hidden = text === null;
    status.textContent = text ?? '';
  };
  const actions = el('div', 'row preview-proxy-actions');
  const cancel = el('button', 'btn', 'Cancel');
  const useOriginal = el('button', 'btn btn-text', 'Use original');
  cancel.type = useOriginal.type = 'button';
  actions.append(cancel, useOriginal);
  actions.hidden = true;

  let stream: PreviewStream | undefined;
  const onWaiting = () => {
    if (stream?.started) say('Buffering…');
  };
  const onResumed = () => {
    if (stream?.started) say(null);
  };
  const endStream = (detach: boolean) => {
    if (!stream) return;
    stream.queue?.destroy();
    URL.revokeObjectURL(stream.url);
    stream = undefined;
    video.removeEventListener('waiting', onWaiting);
    for (const type of ['playing', 'canplay', 'pause']) video.removeEventListener(type, onResumed);
    if (detach) {
      video.removeAttribute('src');
      video.load();
    }
  };
  const startPlayback = () => {
    if (!stream || stream.started || stream.stalled) return;
    stream.started = true;
    say(null);
    void video.play().catch((error: unknown) => console.info('Preview waits for Play', error));
  };
  const openStream = (type: string) =>
    new Promise<void>((resolve, reject) => {
      const media = new MediaSource();
      const current: PreviewStream = {
        media,
        url: URL.createObjectURL(media),
        started: false,
        stalled: false,
      };
      stream = current;
      media.addEventListener(
        'sourceopen',
        () => {
          if (stream !== current) return resolve();
          try {
            const duration = state.source.durationSec;
            if (Number.isFinite(duration) && duration > 0) media.duration = duration;
            const buffer = media.addSourceBuffer(type);
            current.queue = createAppendQueue(buffer, video, (error) => {
              // The rest of the copy still converts; it plays from the whole file when done.
              console.warn('Streaming the preview copy stopped', error);
              current.stalled = true;
              current.started = false;
              video.pause();
              say('Preparing preview');
            });
            buffer.addEventListener('updateend', () => {
              const ranges = video.buffered;
              if (
                ranges.length &&
                ranges.end(ranges.length - 1) - video.currentTime >= START_AFTER_SEC
              )
                startPlayback();
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      video.addEventListener('waiting', onWaiting);
      for (const type of ['playing', 'canplay', 'pause']) video.addEventListener(type, onResumed);
      video.src = current.url;
      notices.proxyPlaying();
    });

  const stop = (original: boolean) => {
    bypassed = true;
    void job?.cancel().catch((error: unknown) => console.warn('Could not cancel preview', error));
    endStream(!original);
    actions.hidden = true;
    say(original ? null : 'Preview preparation canceled.');
    notices.sound.hidden = !previewSoundUnavailable(video, state.source);
    if (original) video.src = originalUrl;
  };
  cancel.addEventListener('click', () => stop(false));
  useOriginal.addEventListener('click', () => stop(true));

  const failed = (error: unknown) => {
    if (destroyed || bypassed) return;
    endStream(true);
    actions.hidden = true;
    say(`Preview could not be prepared: ${error instanceof Error ? error.message : String(error)}`);
    notices.sound.hidden = !previewSoundUnavailable(video, state.source);
  };

  const finished = async (blob: Blob) => {
    if (destroyed || bypassed) return;
    const url = URL.createObjectURL(blob);
    dispatch({ type: 'previewProxyReady', url });
    job = undefined;
    if (stream) {
      const { media, queue } = stream;
      await queue?.finish();
      if (destroyed || bypassed) return;
      if (!queue || queue.incomplete) {
        // Removed or missing pieces cannot be seeked to, so the whole copy takes over.
        const time = video.currentTime;
        const playing = !video.paused;
        endStream(false);
        video.src = url;
        video.currentTime = time;
        if (playing)
          void video.play().catch((e: unknown) => console.info('Preview waits for Play', e));
      } else {
        if (media.readyState === 'open') media.endOfStream();
        startPlayback();
        endStream(false);
      }
    } else video.src = url;
    notices.proxyPlaying();
    say(null);
    actions.hidden = true;
  };

  const convert = () => {
    if (destroyed || bypassed) return;
    try {
      job = makePreviewProxy(
        state.input,
        state.source,
        state.caps,
        (progress) => {
          if (!destroyed && !bypassed && !stream?.started)
            say(`Preparing preview ${Math.round(progress * 100)}%`);
        },
        stream ? (data) => stream?.queue?.push(data) : undefined,
      );
      void job.done.then(finished).catch(failed);
    } catch (error) {
      failed(error);
    }
  };

  const proxy = {
    notices,
    status,
    actions,
    show(wanted: boolean) {
      if (state.previewProxyUrl) {
        video.src = state.previewProxyUrl;
        notices.proxyPlaying();
      } else if (wanted) this.start();
      else video.src = originalUrl;
    },
    start() {
      if (attempted || destroyed || state.previewProxyUrl) return;
      attempted = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      say('Preparing preview 0%');
      actions.hidden = false;
      notices.sound.hidden = true;
      const type = previewStreamType(state.source, state.caps);
      if (type && typeof MediaSource === 'function' && MediaSource.isTypeSupported(type))
        void openStream(type).then(convert, failed);
      else convert();
    },
    destroy() {
      destroyed = true;
      void job?.cancel().catch((error: unknown) => console.warn('Could not cancel preview', error));
      endStream(false);
    },
  };
  return proxy;
}
