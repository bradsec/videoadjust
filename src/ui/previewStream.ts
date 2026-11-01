/** Seconds of already-played copy kept behind the playhead when the SourceBuffer is full. */
const KEEP_BEHIND_SEC = 10;

/**
 * Feeds preview copy pieces to a SourceBuffer in order. appendBuffer throws while an append
 * or remove is still running, so each piece waits for the previous updateend. When the
 * buffer is full, played content older than KEEP_BEHIND_SEC is removed and the piece retried
 * once; a second failure stops the queue and reports through onError.
 */
export function createAppendQueue(
  buffer: SourceBuffer,
  video: HTMLVideoElement,
  onError: (error: unknown) => void,
) {
  const pending: Uint8Array<ArrayBuffer>[] = [];
  const waiting: (() => void)[] = [];
  let retried = false;
  let trimmed = false;
  let stopped = false;

  const settle = () => {
    if (stopped || (!pending.length && !buffer.updating))
      for (const resolve of waiting.splice(0)) resolve();
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    pending.length = 0;
    onError(error);
    settle();
  };
  const pump = () => {
    if (buffer.updating && !stopped) return;
    const next = pending[0];
    if (stopped || !next) return settle();
    try {
      buffer.appendBuffer(next);
      pending.shift();
      retried = false;
    } catch (error) {
      const start = buffer.buffered.length ? buffer.buffered.start(0) : 0;
      const end = video.currentTime - KEEP_BEHIND_SEC;
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError' &&
        !retried &&
        end > start
      ) {
        retried = true;
        trimmed = true;
        buffer.remove(start, end);
      } else fail(error);
    }
  };
  const onAppendError = () => fail(new Error('The browser could not play the preview copy.'));
  buffer.addEventListener('updateend', pump);
  buffer.addEventListener('error', onAppendError);

  return {
    push(data: Uint8Array<ArrayBuffer>) {
      if (stopped) return;
      pending.push(data);
      pump();
    },
    /** Resolves once every pushed piece is appended, or the queue has stopped. */
    finish() {
      return new Promise<void>((resolve) => {
        waiting.push(resolve);
        pump();
      });
    },
    /** True when part of the copy is missing from the buffer: removed after playing, or never appended. */
    get incomplete() {
      return trimmed || stopped;
    },
    destroy() {
      buffer.removeEventListener('updateend', pump);
      buffer.removeEventListener('error', onAppendError);
      stopped = true;
      pending.length = 0;
      settle();
    },
  };
}
