import type { CropPreset, CropRect, Settings, SourceInfo, Rotation } from '../core/types';
import {
  cropRectangle,
  moveCrop,
  resizeCrop,
  rotatedSize,
  type CropHandle,
} from '../core/videoGeometry';
import { el, icon } from './dom';

const ratios: { value: CropPreset; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: 'square', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: 'portrait', label: '9:16' },
  { value: 'landscape', label: '16:9' },
];
const handles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function mountCropEditor(
  host: HTMLElement,
  video: HTMLVideoElement,
  source: NonNullable<SourceInfo['video']>,
  initial: Settings,
  onTransform: (transform: NonNullable<Settings['transform']>) => void,
  toolbar: HTMLElement = host,
): {
  update(s: Settings): void;
  setTool(shrink: boolean): void;
  setPlayable(playable: boolean): void;
  destroy(): void;
} {
  let transform = initial.transform ?? {
    rotate: 0 as const,
    flip: false,
    crop: 'original' as const,
    rect: null,
  };
  let editing = false;
  let playable = true;
  let shrinkTool = true;
  const toggle = el('button', 'btn edit-tool crop-edit-toggle');
  toggle.append(icon('i-crop'), 'Crop and rotate');
  toggle.type = 'button';
  toggle.title = 'Open the editor to crop, rotate or mirror the video before export';
  toggle.setAttribute('aria-pressed', 'false');
  const editor = el('section', 'crop-editor');
  editor.setAttribute('aria-label', 'Crop and rotate editor');
  editor.hidden = true;
  const stage = el('div', 'crop-editor-stage');
  const canvas = el('canvas', 'crop-editor-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const picture = el('div', 'crop-picture');
  const guide = el('div', 'crop-guide');
  guide.tabIndex = 0;
  guide.setAttribute('role', 'group');
  const grid = el('div', 'crop-thirds');
  grid.setAttribute('aria-hidden', 'true');
  guide.append(grid);
  for (const handle of handles) {
    const node = el('span', `crop-handle crop-handle-${handle}`);
    node.dataset.handle = handle;
    node.setAttribute('aria-hidden', 'true');
    guide.append(node);
  }
  picture.append(guide);
  stage.append(canvas, picture);
  const bar = el('div', 'crop-editor-bar');
  const ratioLabel = el('label', 'setting-label', 'Aspect ratio');
  const ratioSelect = el('select', 'setting-select');
  ratioLabel.title =
    'Lock the crop to a shape, or choose Free to resize freely. Original uses the rotated frame ratio';
  ratioSelect.setAttribute('aria-label', 'Crop aspect ratio');
  for (const item of ratios) {
    const option = el('option', undefined, item.label);
    option.value = item.value;
    ratioSelect.append(option);
  }
  ratioLabel.append(ratioSelect);
  const rotateLabel = el('label', 'setting-label', 'Rotate clockwise');
  const rotateSelect = el('select', 'setting-select');
  rotateLabel.title = 'Rotate the frame clockwise before cropping and resizing';
  rotateSelect.setAttribute('aria-label', 'Editor rotation');
  for (const angle of [0, 90, 180, 270]) {
    const option = el('option', undefined, `${angle}°`);
    option.value = String(angle);
    rotateSelect.append(option);
  }
  rotateLabel.append(rotateSelect);
  const mirrorLabel = el('label', 'setting-label crop-editor-mirror');
  const mirrorInput = el('input') as HTMLInputElement;
  mirrorLabel.title = 'Flip the rotated frame horizontally before cropping';
  mirrorInput.type = 'checkbox';
  mirrorInput.setAttribute('aria-label', 'Editor mirror');
  mirrorLabel.append(mirrorInput, document.createTextNode('Mirror'));
  const reset = el('button', 'btn editor-reset', 'Reset');
  reset.type = 'button';
  reset.title = 'Remove the crop and restore the original rotation and mirroring';
  reset.setAttribute('aria-label', 'Reset crop, rotation and mirror');
  const done = el('button', 'btn editor-done', 'Done');
  done.type = 'button';
  bar.append(ratioLabel, rotateLabel, mirrorLabel, reset, done);
  const help = el(
    'p',
    'setting-help',
    'Drag the crop or its handles, use the buttons, or use arrow keys. Shift moves farther; Alt and arrows resize.',
  );
  const clickControls = el('div', 'crop-click-controls');
  clickControls.setAttribute('role', 'group');
  clickControls.setAttribute('aria-label', 'Adjust crop without dragging');
  for (const [label, dx, dy, resize] of [
    ['Move left', -20, 0, false],
    ['Move right', 20, 0, false],
    ['Move up', 0, -20, false],
    ['Move down', 0, 20, false],
    ['Narrower', -20, 0, true],
    ['Wider', 20, 0, true],
    ['Shorter', 0, -20, true],
    ['Taller', 0, 20, true],
  ] as const) {
    const button = el('button', 'btn', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const { width, height } = frame();
      const current = rect();
      const next = resize
        ? resizeCrop(current, dx ? 'e' : 's', dx, dy, width, height, transform.crop)
        : moveCrop(current, dx, dy, width, height);
      onTransform({ ...transform, rect: next });
    });
    clickControls.append(button);
  }
  const status = el('p', 'sr');
  status.setAttribute('aria-live', 'polite');
  editor.append(stage, bar, help, clickControls, status);
  toolbar.append(toggle);
  host.append(editor);

  const frame = () => rotatedSize(source.displayWidth, source.displayHeight, transform.rotate);
  const rect = () => {
    const { width, height } = frame();
    return (
      transform.rect ??
      (transform.crop === 'original'
        ? { left: 0, top: 0, width, height }
        : cropRectangle(width, height, transform.crop)) ??
      cropRectangle(width, height, 'free')!
    );
  };

  function draw(): void {
    if (!editing || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const { width, height } = frame();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    if (transform.flip) context.scale(-1, 1);
    context.rotate((transform.rotate * Math.PI) / 180);
    context.drawImage(
      video,
      -source.displayWidth / 2,
      -source.displayHeight / 2,
      source.displayWidth,
      source.displayHeight,
    );
    context.restore();
  }

  function layout(): void {
    if (!editing) return;
    const { width, height } = frame();
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (!stageWidth || !stageHeight) return;
    const scale = Math.min(stageWidth / width, stageHeight / height);
    const shownWidth = width * scale;
    const shownHeight = height * scale;
    picture.style.width = `${shownWidth}px`;
    picture.style.height = `${shownHeight}px`;
    picture.style.left = `${(stageWidth - shownWidth) / 2}px`;
    picture.style.top = `${(stageHeight - shownHeight) / 2}px`;
    const crop = rect();
    guide.style.left = `${(crop.left / width) * 100}%`;
    guide.style.top = `${(crop.top / height) * 100}%`;
    guide.style.width = `${(crop.width / width) * 100}%`;
    guide.style.height = `${(crop.height / height) * 100}%`;
    guide.setAttribute(
      'aria-label',
      `Crop selection, ${crop.width} by ${crop.height} pixels, left ${crop.left}, top ${crop.top}`,
    );
    status.textContent = `Crop ${crop.width} by ${crop.height} pixels, left ${crop.left}, top ${crop.top}`;
  }

  function setEditing(next: boolean): void {
    editing = next && playable && shrinkTool;
    editor.hidden = !editing;
    video.style.display = editing ? 'none' : '';
    toggle.setAttribute('aria-pressed', String(editing));
    if (editing) {
      video.pause();
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        video.preload = 'auto';
        const frameTime = video.currentTime;
        video.currentTime = frameTime;
      }
      draw();
      layout();
      // The toggle sits below the editor, so on a phone the editor can open above the screen.
      editor.scrollIntoView({ block: 'nearest' });
      guide.focus({ preventScroll: true });
    } else if (next) toggle.focus();
  }
  toggle.addEventListener('click', () => setEditing(!editing));
  done.addEventListener('click', () => {
    setEditing(false);
    toggle.focus();
  });
  ratioSelect.addEventListener('change', () =>
    onTransform({ ...transform, crop: ratioSelect.value as CropPreset, rect: null }),
  );
  rotateSelect.addEventListener('change', () =>
    onTransform({ ...transform, rotate: Number(rotateSelect.value) as Rotation }),
  );
  reset.addEventListener('click', () =>
    onTransform({ rotate: 0, flip: false, crop: 'original', rect: null }),
  );
  mirrorInput.addEventListener('change', () =>
    onTransform({ ...transform, flip: mirrorInput.checked }),
  );

  let drag: { x: number; y: number; rect: CropRect; handle: CropHandle | null } | null = null;
  guide.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    guide.focus();
    drag = {
      x: event.clientX,
      y: event.clientY,
      rect: rect(),
      handle: ((event.target as HTMLElement).dataset.handle as CropHandle | undefined) ?? null,
    };
    guide.setPointerCapture(event.pointerId);
  });
  guide.addEventListener('pointermove', (event) => {
    if (!drag || !guide.hasPointerCapture(event.pointerId)) return;
    const { width, height } = frame();
    const dx = ((event.clientX - drag.x) / picture.clientWidth) * width;
    const dy = ((event.clientY - drag.y) / picture.clientHeight) * height;
    const next = drag.handle
      ? resizeCrop(drag.rect, drag.handle, dx, dy, width, height, transform.crop)
      : moveCrop(drag.rect, dx, dy, width, height);
    onTransform({ ...transform, rect: next });
  });
  guide.addEventListener('lostpointercapture', () => {
    drag = null;
  });
  guide.addEventListener('keydown', (event) => {
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    const { width, height } = frame();
    const step = event.shiftKey ? 20 : 2;
    const current = rect();
    const next = event.altKey
      ? resizeCrop(
          current,
          delta[0] ? 'e' : 's',
          delta[0] * step,
          delta[1] * step,
          width,
          height,
          transform.crop,
        )
      : moveCrop(current, delta[0] * step, delta[1] * step, width, height);
    onTransform({ ...transform, rect: next });
  });

  const observer = new ResizeObserver(layout);
  observer.observe(stage);
  video.addEventListener('seeked', draw);
  video.addEventListener('loadeddata', draw);

  function update(settings: Settings): void {
    const next = settings.transform ?? {
      rotate: 0,
      flip: false,
      crop: 'original' as const,
      rect: null,
    };
    const redraw = next.rotate !== transform.rotate || next.flip !== transform.flip;
    transform = next;
    ratioSelect.value = transform.crop;
    rotateSelect.value = String(transform.rotate);
    mirrorInput.checked = transform.flip;
    const size = frame();
    stage.style.aspectRatio = `${size.width} / ${size.height}`;
    if (redraw) draw();
    layout();
  }
  update(initial);
  return {
    update,
    setTool(shrink) {
      shrinkTool = shrink;
      toggle.hidden = !shrink;
      if (!shrink) setEditing(false);
    },
    setPlayable(next) {
      playable = next;
      toggle.disabled = !next;
      if (!next) setEditing(false);
    },
    destroy() {
      observer.disconnect();
      video.removeEventListener('seeked', draw);
      video.removeEventListener('loadeddata', draw);
    },
  };
}
