import { hasOverlays, renderOverlayLayer, type OverlayAssets } from '../core/overlays';
import { createStyleRenderer, hasStyle, type StyleSettings } from '../core/style';
import type { Settings } from '../core/types';
import { normalizeCrop, rotatedSize } from '../core/videoGeometry';
import { el, icon } from './dom';
import { formatDuration } from './format';

type Size = { width: number; height: number };

export function livePreviewGeometry(
  source: Size,
  transform: Settings['transform'],
  container: Size,
) {
  if (
    ![source.width, source.height, container.width, container.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const rotate = transform?.rotate ?? 0;
  const rotated = rotatedSize(source.width, source.height, rotate);
  const crop = normalizeCrop(
    rotated.width,
    rotated.height,
    transform?.crop ?? 'original',
    transform?.rect,
  );
  const frame = crop ?? { left: 0, top: 0, ...rotated };
  const scale = Math.min(container.width / frame.width, container.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    crop,
    width,
    height,
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    videoWidth: source.width * scale,
    videoHeight: source.height * scale,
    // CSS applies these right to left: centre the source, rotate, then flip in output space.
    transform: `translate(${(rotated.width / 2 - frame.left) * scale}px, ${(rotated.height / 2 - frame.top) * scale}px) scaleX(${transform?.flip ? -1 : 1}) rotate(${rotate}deg) translate(-50%, -50%)`,
  };
}

function looksDifferent(a: PreviewSettings, b: PreviewSettings): boolean {
  return (
    a.enabled !== b.enabled ||
    a.assets?.image !== b.assets?.image ||
    JSON.stringify([a.transform, a.overlays, a.output, a.style]) !==
      JSON.stringify([b.transform, b.overlays, b.output, b.style])
  );
}

interface PreviewSettings {
  transform: Settings['transform'];
  overlays: Settings['overlays'];
  style: StyleSettings | undefined;
  output: Size;
  assets?: OverlayAssets;
  enabled: boolean;
}

export function mountLivePreview(
  video: HTMLVideoElement,
  host: HTMLElement,
  source: Size,
  duration: number,
  onStyleUnavailable: () => void,
): { update(settings: PreviewSettings): void; destroy(): void } {
  const stage = el('div', 'live-preview-stage');
  const frame = el('div', 'live-preview-frame');
  const styleCanvas = el('canvas', 'live-preview-style');
  styleCanvas.setAttribute('aria-hidden', 'true');
  styleCanvas.hidden = true;
  const overlay = el('canvas', 'live-preview-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  frame.append(video, styleCanvas, overlay);
  stage.append(frame);
  const bar = el('div', 'live-preview-bar');
  const controls = el('div', 'scrub');
  const play = el('button', 'btn');
  play.type = 'button';
  const range = el('input', 'scrub-range');
  range.type = 'range';
  range.min = '0';
  range.max = String(duration);
  range.step = 'any';
  range.setAttribute('aria-label', 'Preview position');
  const time = el('span', 'num scrub-time');
  controls.append(play, range, time);
  controls.hidden = true;
  const original = el('button', 'btn edit-tool', 'Show original');
  original.type = 'button';
  original.title =
    'Show the source without crop, rotation, mirroring or overlays. Changing any of these returns to the edited view';
  original.hidden = true;
  original.setAttribute('aria-pressed', 'false');
  const status = el('p', 'note');
  status.setAttribute('role', 'status');
  status.hidden = true;
  bar.append(controls, original);
  host.classList.add('live-preview');
  host.append(stage, bar, status);
  let settings: PreviewSettings | undefined;
  let showingOriginal = false;
  let active = false;
  let version = 0;
  let destroyed = false;
  let styleRenderer: ReturnType<typeof createStyleRenderer> | undefined;
  const styleSource = document.createElement('canvas');
  const styleContext = styleSource.getContext('2d');
  let styleFailed = false;
  let frameCallback = 0;

  function drawStyle(time = video.currentTime): void {
    if (!active || !settings || !hasStyle(settings.style) || styleFailed) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    try {
      if (!styleContext) throw new Error('Canvas is unavailable for Video Style preview.');
      const output = settings.output;
      const transform = settings.transform;
      const rotate = transform?.rotate ?? 0;
      const rotated = rotatedSize(source.width, source.height, rotate);
      const crop = normalizeCrop(
        rotated.width,
        rotated.height,
        transform?.crop ?? 'original',
        transform?.rect,
      );
      const frame = crop ?? { left: 0, top: 0, ...rotated };
      if (styleSource.width !== output.width) styleSource.width = output.width;
      if (styleSource.height !== output.height) styleSource.height = output.height;
      styleContext.setTransform(
        output.width / frame.width,
        0,
        0,
        output.height / frame.height,
        (-frame.left * output.width) / frame.width,
        (-frame.top * output.height) / frame.height,
      );
      styleContext.clearRect(frame.left, frame.top, frame.width, frame.height);
      styleContext.translate(rotated.width / 2, rotated.height / 2);
      styleContext.scale(transform?.flip ? -1 : 1, 1);
      styleContext.rotate((rotate * Math.PI) / 180);
      styleContext.drawImage(
        video,
        -source.width / 2,
        -source.height / 2,
        source.width,
        source.height,
      );
      styleRenderer ??= createStyleRenderer(styleCanvas);
      styleRenderer.draw(styleSource, output.width, output.height, time, settings.style!);
      styleCanvas.hidden = false;
      video.style.opacity = '0';
    } catch {
      styleFailed = true;
      styleCanvas.hidden = true;
      video.style.removeProperty('opacity');
      onStyleUnavailable();
    }
  }

  function scheduleStyle(): void {
    if (
      !active ||
      !settings ||
      !hasStyle(settings.style) ||
      styleFailed ||
      !('requestVideoFrameCallback' in video) ||
      frameCallback
    )
      return;
    frameCallback = video.requestVideoFrameCallback((_now, metadata) => {
      frameCallback = 0;
      drawStyle(metadata.mediaTime);
      if (!video.paused && !destroyed) scheduleStyle();
    });
  }

  styleCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    styleFailed = true;
    styleCanvas.hidden = true;
    video.style.removeProperty('opacity');
    onStyleUnavailable();
  });

  function syncPlayback(): void {
    const paused = video.paused;
    play.replaceChildren(icon(paused ? 'i-play' : 'i-pause'), paused ? 'Play' : 'Pause');
    range.value = String(video.currentTime);
    range.setAttribute('aria-valuetext', formatDuration(video.currentTime, { tenths: true }));
    time.textContent = `${formatDuration(video.currentTime, { tenths: true })} / ${formatDuration(duration, { tenths: true })}`;
  }
  play.addEventListener('click', () => {
    if (!video.paused) video.pause();
    else
      void video.play().catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not play preview.';
        status.hidden = false;
      });
  });
  range.addEventListener('input', () => {
    video.currentTime = Number(range.value);
  });
  original.addEventListener('click', () => {
    showingOriginal = !showingOriginal;
    refresh();
  });

  async function drawOverlay(): Promise<void> {
    const current = ++version;
    overlay.hidden = true;
    if (!settings || !active) return;
    try {
      const layer = await renderOverlayLayer(
        settings.output.width,
        settings.output.height,
        settings.overlays,
        settings.assets,
      );
      if (destroyed || current !== version || !layer) return;
      overlay.width = layer.width;
      overlay.height = layer.height;
      const context = overlay.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable for preview overlays.');
      context.drawImage(layer, 0, 0);
      overlay.hidden = false;
      status.hidden = true;
    } catch (error) {
      if (destroyed || current !== version) return;
      status.textContent = error instanceof Error ? error.message : 'Could not preview overlays.';
      status.hidden = false;
    }
  }

  function layout(): void {
    if (!settings || !active) return;
    const geometry = livePreviewGeometry(source, settings.transform, {
      width: stage.clientWidth,
      height: stage.clientHeight,
    });
    if (!geometry) return;
    frame.style.width = `${geometry.width}px`;
    frame.style.height = `${geometry.height}px`;
    frame.style.left = `${geometry.left}px`;
    frame.style.top = `${geometry.top}px`;
    video.style.width = `${geometry.videoWidth}px`;
    video.style.height = `${geometry.videoHeight}px`;
    video.style.transform = geometry.transform;
    styleCanvas.style.width = '100%';
    styleCanvas.style.height = '100%';
  }

  function refresh(): void {
    if (!settings) return;
    const geometry = livePreviewGeometry(source, settings.transform, source);
    const edited =
      settings.enabled &&
      (!!settings.transform?.rotate ||
        !!settings.transform?.flip ||
        !!geometry?.crop ||
        hasStyle(settings.style) ||
        (!!settings.overlays && hasOverlays(settings.overlays)));
    if (!edited) showingOriginal = false;
    active = edited && !showingOriginal;
    original.hidden = !edited;
    original.setAttribute('aria-pressed', String(showingOriginal));
    // The same controls serve both views, so Show original never moves or swaps them.
    controls.hidden = !edited;
    video.controls = !edited;
    frame.classList.toggle('is-edited', active);
    if ((!active || !hasStyle(settings.style)) && frameCallback) {
      video.cancelVideoFrameCallback(frameCallback);
      frameCallback = 0;
    }
    styleCanvas.hidden = true;
    video.style.removeProperty('opacity');
    if (active) {
      const rotated = rotatedSize(source.width, source.height, settings.transform?.rotate ?? 0);
      const size = geometry?.crop ?? rotated;
      stage.style.aspectRatio = `${size.width} / ${size.height}`;
      layout();
    } else {
      stage.style.removeProperty('aspect-ratio');
      for (const property of ['width', 'height', 'left', 'top'])
        frame.style.removeProperty(property);
      // Editors own display; leave it untouched when switching between live and original.
      for (const property of ['width', 'height', 'transform']) video.style.removeProperty(property);
      for (const property of ['width', 'height']) styleCanvas.style.removeProperty(property);
    }
    status.hidden = true;
    void drawOverlay();
    drawStyle();
    if (active && hasStyle(settings.style)) scheduleStyle();
    syncPlayback();
  }

  const observer = new ResizeObserver(() => {
    layout();
    void drawOverlay();
  });
  observer.observe(stage);
  const playbackEvents = [
    'play',
    'pause',
    'ended',
    'timeupdate',
    'seeked',
    'loadedmetadata',
  ] as const;
  for (const event of playbackEvents) video.addEventListener(event, syncPlayback);
  video.addEventListener('play', scheduleStyle);
  video.addEventListener('seeked', () => drawStyle());
  video.addEventListener('loadeddata', () => drawStyle());
  video.addEventListener('timeupdate', () => {
    if (!('requestVideoFrameCallback' in video)) drawStyle();
  });
  syncPlayback();
  return {
    update(next) {
      // A change to what the preview shows ends Show original, so the change is visible at once.
      if (showingOriginal && settings && looksDifferent(settings, next)) showingOriginal = false;
      settings = next;
      refresh();
    },
    destroy() {
      destroyed = true;
      version++;
      observer.disconnect();
      if (frameCallback) video.cancelVideoFrameCallback(frameCallback);
      styleRenderer?.destroy();
      video.style.removeProperty('opacity');
      video.removeEventListener('play', scheduleStyle);
      for (const event of playbackEvents) video.removeEventListener(event, syncPlayback);
    },
  };
}
