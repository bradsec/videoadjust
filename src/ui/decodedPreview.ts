import { CanvasSink, type Input } from 'mediabunny';

/**
 * Draws Mediabunny-decoded frames on `canvas`, following the <video> clock. Playback reads frames
 * in order: getCanvas() per frame restarts decoding at the previous key frame (306 ms a frame for
 * the reported 4K AV1 file, against 11 ms in order). Frames already late are skipped.
 */
export function createDecodedPreview(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  stage: HTMLElement,
  source: { width: number; height: number },
  onFrame: () => void,
  onStart: () => void,
) {
  let sink: CanvasSink | undefined;
  let active = false;
  let ready = false;
  let version = 0;
  let destroyed = false;
  let onReady = () => {};
  const context = canvas.getContext('2d');

  function paint(frame: HTMLCanvasElement | OffscreenCanvas): void {
    if (!context) return;
    context.drawImage(frame, 0, 0);
    ready = true;
    canvas.hidden = false;
    video.style.opacity = '0';
    onFrame();
    onReady();
  }

  async function draw(): Promise<void> {
    if (!active || !sink || destroyed) return;
    const current = ++version;
    const live = () => current === version && !destroyed;
    try {
      if (video.paused) {
        const frame = await sink.getCanvas(video.currentTime);
        if (frame && live()) paint(frame.canvas);
        return;
      }
      // Breaking out of the loop closes the iterator and its decoder.
      for await (const frame of sink.canvases(video.currentTime)) {
        if (!live() || video.paused) break;
        if (frame.timestamp + frame.duration <= video.currentTime) continue;
        while (frame.timestamp > video.currentTime && live() && !video.paused)
          await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!live() || video.paused) break;
        paint(frame.canvas);
      }
    } catch (error) {
      if (live()) console.warn('Could not render the decoded preview picture.', error);
    }
  }

  const redraw = () => void draw();
  const events = ['play', 'pause', 'seeked'] as const;
  for (const event of events) video.addEventListener(event, redraw);
  return {
    get active() {
      return active;
    },
    get ready() {
      return ready;
    },
    async start(input: Input, callback: () => void): Promise<void> {
      if (active) return;
      active = true;
      onReady = callback;
      onStart();
      const track = await input.getPrimaryVideoTrack();
      if (!track || destroyed) return;
      const width = Math.max(
        1,
        Math.min(source.width, 1280, Math.ceil(stage.clientWidth * (devicePixelRatio || 1))),
      );
      sink = new CanvasSink(track, { width, poolSize: 1 });
      canvas.width = width;
      canvas.height = Math.max(1, Math.round((width * source.height) / source.width));
      void draw();
    },
    destroy(): void {
      destroyed = true;
      active = false;
      version++;
      for (const event of events) video.removeEventListener(event, redraw);
    },
  };
}
