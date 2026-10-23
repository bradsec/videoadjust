import {
  defaultOverlays,
  drawOverlays,
  ensureOverlayFonts,
  type OverlayAssets,
  type OverlayBounds,
  type Overlays,
} from '../core/overlays';
import type { Settings, SourceInfo } from '../core/types';
import { normalizeCrop, rotatedSize } from '../core/videoGeometry';
import { el } from './dom';

export function mountOverlayEditor(
  host: HTMLElement,
  video: HTMLVideoElement,
  source: NonNullable<SourceInfo['video']>,
  initial: Settings,
  onChange: (value: Overlays) => void,
): {
  update(settings: Settings, assets?: OverlayAssets): void;
  setTool(enabled: boolean): void;
  setPlayable(enabled: boolean): void;
  destroy(): void;
} {
  let settings = initial;
  let assets: OverlayAssets = {};
  let editing = false;
  let playable = true;
  let version = 0;
  let bounds: { text?: OverlayBounds; image?: OverlayBounds } = {};
  const toggle = el('button', 'btn btn-text crop-edit-toggle', 'Overlay');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  const editor = el('section', 'overlay-editor');
  editor.hidden = true;
  editor.setAttribute('aria-label', 'Overlay editor');
  const stage = el('div', 'overlay-stage');
  const canvas = el('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const oriented = document.createElement('canvas');
  stage.append(canvas);
  const selections = {
    text: el('button', 'overlay-selection'),
    image: el('button', 'overlay-selection'),
  };
  // Hidden until the first draw positions them, so they never show at the stage origin.
  selections.text.hidden = true;
  selections.image.hidden = true;
  const status = el('p', 'setting-help');
  status.setAttribute('role', 'status');
  const done = el('button', 'btn btn-text', 'Done');
  done.type = 'button';
  editor.append(
    stage,
    el('p', 'setting-help', 'Drag an overlay. Arrow keys nudge; Shift moves farther.'),
    status,
    done,
  );
  host.append(toggle, editor);
  function overlays(): Overlays {
    return settings.overlays ?? defaultOverlays();
  }
  function move(kind: 'text' | 'image', x: number, y: number): void {
    const value = overlays();
    const box = bounds[kind];
    if (!box) return;
    const position = {
      x: Math.max(0, Math.min(1 - box.width / canvas.width, x)),
      y: Math.max(0, Math.min(1 - box.height / canvas.height, y)),
    };
    onChange({ ...value, [kind]: { ...value[kind], position } });
  }
  for (const kind of ['text', 'image'] as const) {
    const selection = selections[kind];
    selection.type = 'button';
    selection.setAttribute('aria-label', `Move ${kind} overlay`);
    stage.append(selection);
    let drag: { x: number; y: number; left: number; top: number } | undefined;
    selection.addEventListener('pointerdown', (event) => {
      const box = bounds[kind];
      if (event.button !== 0 || !box) return;
      event.preventDefault();
      selection.focus();
      drag = {
        x: event.clientX,
        y: event.clientY,
        left: box.x / canvas.width,
        top: box.y / canvas.height,
      };
      selection.setPointerCapture(event.pointerId);
    });
    selection.addEventListener('pointermove', (event) => {
      if (!drag || !selection.hasPointerCapture(event.pointerId)) return;
      const rect = canvas.getBoundingClientRect();
      move(
        kind,
        drag.left + (event.clientX - drag.x) / rect.width,
        drag.top + (event.clientY - drag.y) / rect.height,
      );
    });
    selection.addEventListener('pointerup', (event) => {
      if (selection.hasPointerCapture(event.pointerId))
        selection.releasePointerCapture(event.pointerId);
    });
    selection.addEventListener('lostpointercapture', () => {
      drag = undefined;
    });
    selection.addEventListener('keydown', (event) => {
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = delta[event.key];
      const box = bounds[kind];
      if (!direction || !box) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.05 : 0.005;
      move(
        kind,
        box.x / canvas.width + direction[0] * step,
        box.y / canvas.height + direction[1] * step,
      );
    });
  }
  async function draw(): Promise<void> {
    const current = ++version;
    if (!editing || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    try {
      await ensureOverlayFonts(overlays());
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not load overlay font.';
      return;
    }
    if (current !== version || !editing) return;
    status.textContent = '';
    const transform = settings.transform;
    const rotate = transform?.rotate ?? 0;
    const frame = rotatedSize(source.displayWidth, source.displayHeight, rotate);
    const crop = normalizeCrop(
      frame.width,
      frame.height,
      transform?.crop ?? 'original',
      transform?.rect,
    ) ?? { left: 0, top: 0, ...frame };
    oriented.width = frame.width;
    oriented.height = frame.height;
    const context = oriented.getContext('2d');
    const target = canvas.getContext('2d');
    if (!context || !target) return;
    context.translate(frame.width / 2, frame.height / 2);
    if (transform?.flip) context.scale(-1, 1);
    context.rotate((rotate * Math.PI) / 180);
    context.drawImage(
      video,
      -source.displayWidth / 2,
      -source.displayHeight / 2,
      source.displayWidth,
      source.displayHeight,
    );
    canvas.width = settings.video?.width ?? crop.width;
    canvas.height = settings.video?.height ?? crop.height;
    stage.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    // Fit portrait frames to the viewport height as the crop editor does.
    stage.style.width = `min(100%, calc(70vh * ${canvas.width / canvas.height}))`;
    target.drawImage(
      oriented,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    bounds = drawOverlays(target, canvas.width, canvas.height, overlays(), assets);
    for (const kind of ['text', 'image'] as const) {
      const box = bounds[kind];
      const selection = selections[kind];
      selection.hidden = !box;
      if (!box) continue;
      selection.style.left = `${(box.x / canvas.width) * 100}%`;
      selection.style.top = `${(box.y / canvas.height) * 100}%`;
      selection.style.width = `${(box.width / canvas.width) * 100}%`;
      selection.style.height = `${(box.height / canvas.height) * 100}%`;
    }
  }
  function setEditing(next: boolean): void {
    editing = next && playable;
    editor.hidden = !editing;
    toggle.setAttribute('aria-pressed', String(editing));
    video.style.display = editing ? 'none' : '';
    if (editing) {
      const cropToggle = host.querySelector<HTMLButtonElement>(
        '.crop-edit-toggle[aria-pressed="true"]',
      );
      if (cropToggle && cropToggle !== toggle) cropToggle.click();
      video.style.display = 'none';
      video.pause();
      video.preload = 'auto';
      void draw();
    }
  }
  const closeForCrop = (event: Event) => {
    const target = event.target as HTMLElement;
    if (
      editing &&
      target.closest('.crop-edit-toggle') !== toggle &&
      target.closest('.crop-edit-toggle')
    ) {
      editing = false;
      editor.hidden = true;
      toggle.setAttribute('aria-pressed', 'false');
    }
  };
  host.addEventListener('click', closeForCrop);
  toggle.addEventListener('click', () => setEditing(!editing));
  done.addEventListener('click', () => {
    setEditing(false);
    toggle.focus();
  });
  const redraw = () => {
    void draw();
  };
  video.addEventListener('seeked', redraw);
  video.addEventListener('loadeddata', redraw);
  return {
    update(next, nextAssets) {
      settings = next;
      assets = nextAssets ?? {};
      void draw();
    },
    setTool(enabled) {
      toggle.hidden = !enabled;
      if (!enabled && editing) setEditing(false);
    },
    setPlayable(enabled) {
      playable = enabled;
      toggle.disabled = !enabled;
      if (!enabled) setEditing(false);
    },
    destroy() {
      version++;
      host.removeEventListener('click', closeForCrop);
      video.removeEventListener('seeked', redraw);
      video.removeEventListener('loadeddata', redraw);
    },
  };
}
