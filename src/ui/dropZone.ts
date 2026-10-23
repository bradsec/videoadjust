import { icon } from './dom';

const ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';

/**
 * Renders the hero and drop zone into `container` and reports the chosen file.
 * The zone opens the native picker from a real button (keyboard, and iOS needs
 * the picker opened inside a user gesture) and also accepts drag and drop.
 */
export function mountDropZone(
  container: HTMLElement,
  onFile: (file: File) => void,
): { focusPicker(): void } {
  const grid = document.createElement('div');
  grid.className = 'drop-grid';
  grid.innerHTML = `
    <div class="hero">
      <h1>Video tools that <span class="hl">stay on your device</span>.</h1>
      <p>Shrink, trim, crop and convert videos, add text or a watermark, or turn them into GIFs. Everything runs in this browser and nothing is uploaded.</p>
    </div>
    <div class="dropzone">
      <button class="btn btn-primary" type="button"></button>
      <p class="hint">or drop a video file here</p>
      <p class="formats">MP4, MOV, WebM, MKV. Works best up to 2&nbsp;GB.</p>
    </div>`;
  const zone = grid.querySelector<HTMLElement>('.dropzone')!;
  zone.querySelector('button')!.append(icon('i-film'), 'Choose video');

  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'file';
  input.accept = ACCEPT;
  input.className = 'sr';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  zone.append(input);

  const button = zone.querySelector<HTMLButtonElement>('button')!;
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // lets the same file be chosen again after an error
    if (file) onFile(file);
  });

  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  zone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', (e) => {
    if (e.relatedTarget instanceof Node && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('is-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    const file = e.dataTransfer?.files[0];
    if (file) onFile(file);
  });

  container.replaceChildren(grid);
  return { focusPicker: () => button.focus() };
}
