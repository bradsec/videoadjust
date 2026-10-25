import {
  createController,
  type AppAction,
  type AppDeps,
  type AppState,
  type Notice,
} from './controller';
import { el, icon } from './dom';
import { mountDropZone } from './dropZone';
import { renderPrepare } from './prepareView';
import { renderWorking } from './workingView';
import { renderResult } from './resultView';
import { mountToasts } from './toast';

interface Mounted {
  update(value: AppState): void;
  destroy(): void;
}

export * from './controller';
export { summarySource } from './viewSummaries';

export function createApp(
  root: HTMLElement,
  deps: AppDeps,
): { dispatch(a: AppAction): void; getState(): AppState } {
  const controller = createController(deps, () => render());
  const { dispatch } = controller;
  const state = () => controller.getState();

  const noticeSlot = el('div', 'notice-slot');
  mountToasts();
  const status = el('p', 'sr');
  status.setAttribute('role', 'status');
  const view = el('div', 'view');
  root.replaceChildren(noticeSlot, status, view);

  let mountedKind: AppState['kind'] | null = null;
  let dropZone: { focusPicker(): void } | undefined;
  let mounted: Mounted | undefined;
  let shownNotice: Notice | undefined;

  // The browser would otherwise navigate to a file dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  function render(): void {
    const s = state();
    renderNotice(s);
    status.textContent =
      s.kind === 'drop' && s.reading
        ? `Reading ${s.reading}`
        : s.kind === 'result'
          ? 'Export finished'
          : '';
    // The drop screen stays mounted across notice changes so the picker keeps focus.
    if (s.kind === mountedKind && s.kind === 'drop') return;
    if (s.kind === mountedKind && mounted) {
      mounted.update(s);
      return;
    }
    mounted?.destroy();
    mounted = undefined;
    // Prepare borrows the notice slot; every other screen shows it above the view.
    if (noticeSlot.parentElement !== root) root.prepend(noticeSlot);
    mountedKind = s.kind;
    dropZone = undefined;
    // A new screen starts at the top; a shorter one would otherwise keep the previous
    // screen's scroll offset and show empty space. Mounting may then focus and scroll.
    window.scrollTo(0, 0);
    switch (s.kind) {
      case 'drop':
        dropZone = mountDropZone(view, (file) => dispatch({ type: 'pick', file }));
        return;
      case 'prepare':
        mounted = renderPrepare(view, s, dispatch, noticeSlot);
        return;
      case 'working':
        mounted = renderWorking(view, s, () => dispatch({ type: 'cancel' }));
        return;
      case 'result':
        mounted = renderResult(view, s, dispatch);
    }
  }

  function renderNotice(s: AppState): void {
    const notice = s.kind === 'drop' || s.kind === 'prepare' ? s.notice : undefined;
    // Re-rendering the same notice would re-announce it and drop focus from its buttons.
    if (notice === shownNotice) return;
    shownNotice = notice;
    if (!notice) {
      noticeSlot.replaceChildren();
      return;
    }
    // role=alert is an assertive live region: inserting the box announces it.
    const box = el('div', `notice ${notice.tone}`);
    box.setAttribute('role', 'alert');
    box.append(
      icon(notice.tone === 'error' ? 'i-stop' : notice.tone === 'info' ? 'i-info' : 'i-warn'),
    );
    const body = el('div', 'body');
    body.append(el('h2', undefined, notice.title), el('p', undefined, notice.message));
    const row = el('div', 'row');
    if (s.kind === 'prepare') {
      if (notice.confirm === 'memory') {
        const go = el('button', 'btn', 'Continue');
        go.type = 'button';
        go.addEventListener('click', () => dispatch({ type: 'export', confirmed: true }));
        row.append(go);
      }
      const back = el(
        'button',
        notice.confirm ? 'btn btn-text' : 'btn',
        notice.confirm ? 'Go back' : 'Dismiss',
      );
      back.type = 'button';
      back.addEventListener('click', () => dispatch({ type: 'dismissNotice' }));
      row.append(back);
      body.append(row);
      box.append(body);
      noticeSlot.replaceChildren(box);
      return;
    }
    if (notice.pending) {
      const go = el('button', 'btn', 'Continue anyway');
      go.type = 'button';
      go.addEventListener('click', () => dispatch({ type: 'continueLarge' }));
      row.append(go);
    }
    const another = el('button', notice.pending ? 'btn btn-text' : 'btn', 'Choose another video');
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
