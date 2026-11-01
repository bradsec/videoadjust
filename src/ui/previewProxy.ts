import { makePreviewProxy } from '../core/previewProxy';
import type { AppAction, AppState } from './controller';
import { el } from './dom';
import { mountPreviewNotices, previewSoundUnavailable } from './previewNotices';

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
  status.hidden = true;
  const actions = el('div', 'row preview-proxy-actions');
  const cancel = el('button', 'btn', 'Cancel');
  const useOriginal = el('button', 'btn btn-text', 'Use original');
  cancel.type = useOriginal.type = 'button';
  actions.append(cancel, useOriginal);
  actions.hidden = true;

  const stop = (original: boolean) => {
    bypassed = true;
    void job?.cancel().catch((error: unknown) => console.warn('Could not cancel preview', error));
    actions.hidden = true;
    status.textContent = original ? '' : 'Preview preparation canceled.';
    status.hidden = original;
    notices.sound.hidden = !previewSoundUnavailable(video, state.source);
    if (original) video.src = originalUrl;
  };
  cancel.addEventListener('click', () => stop(false));
  useOriginal.addEventListener('click', () => stop(true));

  const failed = (error: unknown) => {
    if (destroyed || bypassed) return;
    actions.hidden = true;
    status.textContent = `Preview could not be prepared: ${error instanceof Error ? error.message : String(error)}`;
    notices.sound.hidden = !previewSoundUnavailable(video, state.source);
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
      status.hidden = false;
      status.textContent = 'Preparing preview 0%';
      actions.hidden = false;
      notices.sound.hidden = true;
      try {
        job = makePreviewProxy(state.input, state.source, state.caps, (progress) => {
          if (!destroyed && !bypassed)
            status.textContent = `Preparing preview ${Math.round(progress * 100)}%`;
        });
        void job.done.then((blob) => {
          if (destroyed || bypassed) return;
          const url = URL.createObjectURL(blob);
          dispatch({ type: 'previewProxyReady', url });
          video.src = url;
          notices.proxyPlaying();
          status.hidden = actions.hidden = true;
          job = undefined;
        }, failed);
      } catch (error) {
        failed(error);
      }
    },
    destroy() {
      destroyed = true;
      void job?.cancel().catch((error: unknown) => console.warn('Could not cancel preview', error));
    },
  };
  return proxy;
}
