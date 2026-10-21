import type { SourceInfo } from '../core/types';
import { codecLabel, createController, type AppAction, type AppDeps, type AppState } from './controller';
import { el, icon } from './dom';
import { mountDropZone } from './dropZone';
import { formatBytes, formatDuration } from './format';

export * from './controller';

/** "212 MB · 3840x2160 · 60 fps · HEVC · 1:24.6" */
export function summarySource(s: SourceInfo): string {
  const parts = [formatBytes(s.sizeBytes)];
  if (s.video) {
    parts.push(`${s.video.displayWidth}x${s.video.displayHeight}`);
    parts.push(`${Number(s.video.fps.toFixed(1))} fps`);
    parts.push(codecLabel(s.video.codec));
  } else if (s.audio) {
    parts.push(`${codecLabel(s.audio.codec)} audio`);
  }
  parts.push(formatDuration(s.durationSec));
  return parts.join(' · ');
}

export function createApp(root: HTMLElement, deps: AppDeps): { dispatch(a: AppAction): void; getState(): AppState } {
  const controller = createController(deps, () => render());
  const { dispatch } = controller;
  const state = () => controller.getState();

  const noticeSlot = el('div', 'notice-slot');
  const status = el('p', 'sr');
  status.setAttribute('role', 'status');
  const view = el('div', 'view');
  root.replaceChildren(noticeSlot, status, view);

  let mountedKind: AppState['kind'] | null = null;
  let dropZone: { focusPicker(): void } | undefined;

  // The browser would otherwise navigate to a file dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  function render(): void {
    const s = state();
    renderNotice(s);
    status.textContent = s.kind === 'drop' && s.reading ? `Reading ${s.reading}` : '';
    // The drop screen stays mounted across notice changes so the picker keeps focus.
    if (s.kind === mountedKind && s.kind === 'drop') return;
    mountedKind = s.kind;
    dropZone = undefined;
    switch (s.kind) {
      case 'drop':
        dropZone = mountDropZone(view, (file) => dispatch({ type: 'pick', file }));
        return;
      case 'prepare':
        renderPrepare(view, s, () => dispatch({ type: 'reset' }));
        return;
      case 'working':
      case 'result':
        // Rendered by the progress and result tasks.
        view.replaceChildren();
        return;
    }
  }

  function renderNotice(s: AppState): void {
    const notice = s.kind === 'drop' ? s.notice : undefined;
    if (!notice) {
      noticeSlot.replaceChildren();
      return;
    }
    // role=alert is an assertive live region: inserting the box announces it.
    const box = el('div', `notice ${notice.tone}`);
    box.setAttribute('role', 'alert');
    box.append(icon(notice.tone === 'error' ? 'i-stop' : 'i-warn'));
    const body = el('div', 'body');
    body.append(el('h2', undefined, notice.title), el('p', undefined, notice.message));
    const row = el('div', 'row');
    if (notice.pending) {
      const go = el('button', 'btn', 'Continue anyway');
      go.type = 'button';
      go.addEventListener('click', () => dispatch({ type: 'continueLarge' }));
      row.append(go);
    }
    const another = el('button', notice.pending ? 'btn btn-quiet' : 'btn', 'Choose another video');
    another.type = 'button';
    another.addEventListener('click', () => {
      dispatch({ type: 'dismissNotice' });
      dropZone?.focusPicker();
    });
    row.append(another);
    body.append(row);
    box.append(body);
    noticeSlot.replaceChildren(box);
  }

  render();
  return controller;
}

/** Prepare screen. Trim, settings and the estimate mount into the regions below in later tasks. */
function renderPrepare(
  container: HTMLElement,
  state: Extract<AppState, { kind: 'prepare' }>,
  onReset: () => void,
): void {
  const head = el('div', 'file-line');
  head.append(el('h1', 'file-name', state.file.name), el('p', 'file-summary num', summarySource(state.source)));
  const stage = el('div', 'prepare-regions');
  stage.dataset.region = 'prepare';
  const another = el('button', 'btn btn-quiet', 'Choose another video');
  another.type = 'button';
  another.addEventListener('click', onReset);
  container.replaceChildren(head, stage, another);
}
