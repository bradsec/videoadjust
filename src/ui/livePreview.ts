import { drawPreparedFrame, preparedFrameMatrix } from '../core/frameExport';
import { hasOverlays, renderOverlayLayer, type OverlayAssets } from '../core/overlays';
import {
  createStyleRenderer,
  hasStyleEffects,
  normalizeStyle,
  STYLE_PRESETS,
  type StyleSettings,
} from '../core/style';
import type { Settings } from '../core/types';
import { normalizeCrop, rotatedSize } from '../core/videoGeometry';
import { el, icon } from './dom';
import { formatDuration } from './format';

type Size = { width: number; height: number };

export function previewRenderSize(output: Size, display: Size, dpr: number): Size {
  const scale = Math.min(
    1,
    (display.width * dpr) / output.width,
    (display.height * dpr) / output.height,
  );
  return {
    width: Math.max(1, Math.min(output.width, Math.floor(output.width * scale))),
    height: Math.max(1, Math.min(output.height, Math.floor(output.height * scale))),
  };
}

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
    JSON.stringify([a.transform, a.overlays, a.output, a.style, a.fps, a.colors]) !==
      JSON.stringify([b.transform, b.overlays, b.output, b.style, b.fps, b.colors])
  );
}

interface PreviewSettings {
  transform: Settings['transform'];
  overlays: Settings['overlays'];
  style: StyleSettings | undefined;
  output: Size;
  /** Output and source frame rates; a lower output rate holds frames to show the stepping. */
  fps?: number | null;
  sourceFps?: number | null;
  colors?: 256 | 128 | 64;
  assets?: OverlayAssets;
  enabled: boolean;
}

/** Whether the export would visibly differ from the source in resolution or frame rate. */
export function previewFidelity(
  settings: Pick<PreviewSettings, 'output' | 'fps' | 'sourceFps'>,
  frame: Size,
): { scaled: boolean; reduced: boolean } {
  return {
    scaled: settings.output.width * settings.output.height < frame.width * frame.height,
    reduced: !!settings.fps && !!settings.sourceFps && settings.fps < settings.sourceFps - 0.01,
  };
}

export function mountLivePreview(
  video: HTMLVideoElement,
  host: HTMLElement,
  source: Size,
  duration: number,
  onStyleUnavailable: () => void,
): { update(settings: PreviewSettings): void; togglePlayback(): boolean; destroy(): void } {
  const stage = el('div', 'live-preview-stage');
  const frame = el('div', 'live-preview-frame');
  const styleCanvas = el('canvas', 'live-preview-style');
  styleCanvas.setAttribute('aria-hidden', 'true');
  styleCanvas.hidden = true;
  const paletteCanvas = el('canvas', 'live-preview-palette');
  paletteCanvas.setAttribute('aria-hidden', 'true');
  paletteCanvas.hidden = true;
  const overlay = el('canvas', 'live-preview-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  const styleLabel = el('span', 'live-preview-label');
  styleLabel.setAttribute('aria-hidden', 'true');
  styleLabel.hidden = true;
  frame.append(video, styleCanvas, overlay, paletteCanvas, styleLabel);
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
  const paletteSource = document.createElement('canvas');
  const paletteSourceContext = paletteSource.getContext('2d', { willReadFrequently: true });
  const paletteContext = paletteCanvas.getContext('2d');
  let overlayLayer: OffscreenCanvas | null = null;
  let paletteWorker: Worker | undefined;
  let palettePending = false;
  let paletteVersion = 0;
  let paletteFailed = false;
  let styleFailed = false;
  let frameCallback = 0;
  let animationFrame = 0;
  let animationTime = -1;
  let renderSize: Size = { width: 1, height: 1 };
  // Style effects, GIF colours, or an output smaller or slower than the source render through a canvas.
  let processed = false;
  let reduced = false;
  let lastFrame = -1;

  function queuePalette(rgba: Uint8ClampedArray, width: number, height: number): void {
    if (!paletteWorker) {
      paletteWorker = new Worker(new URL('../core/gifPreviewWorker.ts', import.meta.url), {
        type: 'module',
      });
      paletteWorker.onmessage = (
        event: MessageEvent<{
          rgba: Uint8ClampedArray;
          width: number;
          height: number;
          version: number;
        }>,
      ) => {
        palettePending = false;
        if (destroyed || event.data.version !== paletteVersion) {
          if (!destroyed) drawStyle();
          return;
        }
        const image = paletteContext!.createImageData(event.data.width, event.data.height);
        image.data.set(event.data.rgba);
        paletteContext!.putImageData(image, 0, 0);
        paletteCanvas.hidden = false;
        styleCanvas.hidden = true;
        video.style.opacity = '0';
      };
      paletteWorker.onerror = () => {
        palettePending = false;
        paletteFailed = true;
        stopStyle();
        paletteCanvas.hidden = true;
        video.style.removeProperty('opacity');
        status.textContent = 'GIF colour preview is unavailable.';
        status.hidden = false;
      };
    }
    palettePending = true;
    paletteWorker.postMessage(
      { rgba, width, height, colors: settings!.colors, version: paletteVersion },
      [rgba.buffer],
    );
  }

  function drawStyle(time = video.currentTime): void {
    if (
      !active ||
      !settings ||
      !processed ||
      (styleFailed && (!settings.colors || hasStyleEffects(settings.style))) ||
      (paletteFailed && !!settings.colors)
    )
      return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (settings.colors && palettePending) return;
    if (reduced && settings.fps) {
      const index = Math.floor(time * settings.fps + 1e-6);
      if (index === lastFrame) return;
      lastFrame = index;
    }
    try {
      const output = renderSize;
      const styled = !settings.colors || hasStyleEffects(settings.style);
      if (styled) {
        styleRenderer ??= createStyleRenderer(styleCanvas, { preserveDrawingBuffer: false });
        // Upload video directly to WebGL and transform on the GPU. On iPhone/iPad Safari,
        // drawing to a 2D canvas then texImage2D(canvas) cost 14-56 ms per frame versus
        // about 2 ms direct, making styled playback stutter (0.22.13).
        styleRenderer.draw(
          video,
          output.width,
          output.height,
          time,
          normalizeStyle(settings.style),
          settings.output,
          { source, matrix: preparedFrameMatrix(source, output, settings.transform) },
        );
      } else {
        if (!styleContext) throw new Error('Canvas is unavailable for Video Style preview.');
        if (styleSource.width !== output.width) styleSource.width = output.width;
        if (styleSource.height !== output.height) styleSource.height = output.height;
        drawPreparedFrame(styleContext, video, source, output, settings.transform);
      }
      if (settings.colors) {
        if (!paletteContext || !paletteSourceContext)
          throw new Error('Canvas is unavailable for GIF preview.');
        if (paletteSource.width !== output.width) paletteSource.width = output.width;
        if (paletteSource.height !== output.height) paletteSource.height = output.height;
        if (paletteCanvas.width !== output.width) paletteCanvas.width = output.width;
        if (paletteCanvas.height !== output.height) paletteCanvas.height = output.height;
        paletteSourceContext.drawImage(styled ? styleCanvas : styleSource, 0, 0);
        if (overlayLayer)
          paletteSourceContext.drawImage(overlayLayer, 0, 0, output.width, output.height);
        const pixels = paletteSourceContext.getImageData(0, 0, output.width, output.height);
        queuePalette(pixels.data, output.width, output.height);
      } else {
        paletteCanvas.hidden = true;
        styleCanvas.hidden = false;
        video.style.opacity = '0';
      }
    } catch {
      styleFailed = true;
      stopStyle();
      styleCanvas.hidden = true;
      paletteCanvas.hidden = true;
      video.style.removeProperty('opacity');
      onStyleUnavailable();
    }
  }

  function scheduleStyle(): void {
    if (
      !active ||
      !settings ||
      !processed ||
      (styleFailed && (!settings.colors || hasStyleEffects(settings.style))) ||
      (paletteFailed && !!settings.colors) ||
      video.paused
    )
      return;
    if (typeof video.requestVideoFrameCallback !== 'function') {
      if (animationFrame) return;
      const tick = () => {
        animationFrame = 0;
        if (video.paused || destroyed || !active || !processed) return;
        if (video.currentTime !== animationTime) {
          animationTime = video.currentTime;
          drawStyle();
        }
        if (!styleFailed && !paletteFailed) animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
      return;
    }
    if (frameCallback) return;
    frameCallback = video.requestVideoFrameCallback((_now, metadata) => {
      frameCallback = 0;
      drawStyle(metadata.mediaTime);
      if (!video.paused && !destroyed) scheduleStyle();
    });
  }

  function stopStyle(): void {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (frameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = 0;
  }

  styleCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    styleFailed = true;
    stopStyle();
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
    overlayLayer = null;
    if (!settings || !active) return;
    try {
      const layer = await renderOverlayLayer(
        settings.output.width,
        settings.output.height,
        settings.overlays,
        settings.assets,
      );
      if (destroyed || current !== version || !layer) return;
      overlayLayer = layer;
      paletteVersion++;
      lastFrame = -1;
      overlay.width = layer.width;
      overlay.height = layer.height;
      const context = overlay.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable for preview overlays.');
      context.drawImage(layer, 0, 0);
      overlay.hidden = !!settings.colors;
      if (settings.colors) drawStyle();
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
    const nextSize = previewRenderSize(settings.output, geometry, window.devicePixelRatio || 1);
    if (nextSize.width !== renderSize.width || nextSize.height !== renderSize.height) {
      renderSize = nextSize;
      paletteVersion++;
      lastFrame = -1;
    }
    video.style.width = `${geometry.videoWidth}px`;
    video.style.height = `${geometry.videoHeight}px`;
    video.style.transform = geometry.transform;
    styleCanvas.style.width = paletteCanvas.style.width = '100%';
    styleCanvas.style.height = paletteCanvas.style.height = '100%';
  }

  function refresh(): void {
    if (!settings) return;
    paletteVersion++;
    const geometry = livePreviewGeometry(source, settings.transform, source);
    const shown =
      geometry?.crop ?? rotatedSize(source.width, source.height, settings.transform?.rotate ?? 0);
    const fidelity = previewFidelity(settings, shown);
    reduced = fidelity.reduced;
    lastFrame = -1;
    processed =
      hasStyleEffects(settings.style) ||
      !!settings.colors ||
      (!styleFailed && (fidelity.scaled || fidelity.reduced));
    const edited =
      settings.enabled &&
      (!!settings.transform?.rotate ||
        !!settings.transform?.flip ||
        !!geometry?.crop ||
        processed ||
        (!!settings.overlays && hasOverlays(settings.overlays)));
    if (!edited) showingOriginal = false;
    active = edited && !showingOriginal;
    original.hidden = !edited;
    original.setAttribute('aria-pressed', String(showingOriginal));
    const style = settings.style;
    styleLabel.hidden = !settings.enabled || !hasStyleEffects(style);
    if (!styleLabel.hidden)
      styleLabel.textContent = showingOriginal
        ? 'Original'
        : style?.id === 'none'
          ? 'Colour correction'
          : STYLE_PRESETS.find((preset) => preset.id === style?.id)!.label;
    // The same controls serve both views, so Show original never moves or swaps them.
    controls.hidden = !edited;
    video.controls = !edited;
    frame.classList.toggle('is-edited', active);
    if (!active || !processed) stopStyle();
    styleCanvas.hidden = true;
    paletteCanvas.hidden = true;
    video.style.removeProperty('opacity');
    if (active) {
      stage.style.aspectRatio = `${shown.width} / ${shown.height}`;
      layout();
    } else {
      stage.style.removeProperty('aspect-ratio');
      for (const property of ['width', 'height', 'left', 'top'])
        frame.style.removeProperty(property);
      // Editors own display; leave it untouched when switching between live and original.
      for (const property of ['width', 'height', 'transform']) video.style.removeProperty(property);
      for (const property of ['width', 'height']) styleCanvas.style.removeProperty(property);
      for (const property of ['width', 'height']) paletteCanvas.style.removeProperty(property);
    }
    status.hidden = !(paletteFailed && settings.colors);
    void drawOverlay();
    drawStyle();
    if (active && processed) scheduleStyle();
    syncPlayback();
  }

  const observer = new ResizeObserver(() => {
    // Measure from the document top so scrolling cannot skew the cap, and skip hidden stages
    // (editors hide it) that report zero. Two pixels absorb fractional rounding at the edge.
    const box = stage.getBoundingClientRect();
    if (box.width > 0)
      stage.style.setProperty(
        '--theater-offset',
        `${box.top + window.scrollY + bar.getBoundingClientRect().height + 2}px`,
      );
    layout();
    void drawOverlay();
    drawStyle();
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
  video.addEventListener('pause', stopStyle);
  video.addEventListener('ended', stopStyle);
  video.addEventListener('seeked', () => {
    paletteVersion++;
    lastFrame = -1;
    drawStyle();
  });
  video.addEventListener('loadeddata', () => drawStyle());
  video.addEventListener('timeupdate', () => {
    if (typeof video.requestVideoFrameCallback !== 'function' && video.paused) drawStyle();
  });
  syncPlayback();
  return {
    togglePlayback() {
      if (!active) return false;
      play.click();
      return true;
    },
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
      stopStyle();
      styleRenderer?.destroy();
      paletteWorker?.terminate();
      video.style.removeProperty('opacity');
      video.removeEventListener('play', scheduleStyle);
      video.removeEventListener('pause', stopStyle);
      video.removeEventListener('ended', stopStyle);
      for (const event of playbackEvents) video.removeEventListener(event, syncPlayback);
    },
  };
}
