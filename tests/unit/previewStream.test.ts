import { describe, expect, it, vi } from 'vitest';
import { createAppendQueue } from '../../src/ui/previewStream';

class FakeBuffer extends EventTarget {
  updating = false;
  buffered = { length: 1, start: () => 0, end: () => 25 } as unknown as TimeRanges;
  appended: number[] = [];
  quotaErrors = 0;
  remove = vi.fn(() => this.busy());
  appendBuffer(data: Uint8Array) {
    if (this.updating) throw new DOMException('busy', 'InvalidStateError');
    if (this.quotaErrors > 0) {
      this.quotaErrors--;
      throw new DOMException('full', 'QuotaExceededError');
    }
    this.appended.push(data[0]!);
    this.busy();
  }
  private busy() {
    this.updating = true;
    queueMicrotask(() => {
      this.updating = false;
      this.dispatchEvent(new Event('updateend'));
    });
  }
}

function setup(quotaErrors = 0) {
  const video = { currentTime: 20 } as HTMLVideoElement;
  const buffer = new FakeBuffer();
  buffer.quotaErrors = quotaErrors;
  const onError = vi.fn();
  const queue = createAppendQueue(buffer as unknown as SourceBuffer, video, onError);
  return { buffer, queue, onError };
}

describe('preview append queue', () => {
  it('appends pieces in order, one per updateend', async () => {
    const { buffer, queue, onError } = setup();
    queue.push(Uint8Array.of(1));
    queue.push(Uint8Array.of(2));
    queue.push(Uint8Array.of(3));
    expect(buffer.appended).toEqual([1]);
    await queue.finish();
    expect(buffer.appended).toEqual([1, 2, 3]);
    expect(queue.incomplete).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('removes content more than 10 s behind the playhead and retries once when full', async () => {
    const { buffer, queue, onError } = setup(1);
    queue.push(Uint8Array.of(1));
    await queue.finish();
    expect(buffer.remove).toHaveBeenCalledWith(0, 10);
    expect(buffer.appended).toEqual([1]);
    expect(queue.incomplete).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops and reports when the retry is also refused', async () => {
    const { buffer, queue, onError } = setup(2);
    queue.push(Uint8Array.of(1));
    queue.push(Uint8Array.of(2));
    await queue.finish();
    expect(buffer.remove).toHaveBeenCalledTimes(1);
    expect(buffer.appended).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'QuotaExceededError' }));
    expect(queue.incomplete).toBe(true);
  });

  it('reports a SourceBuffer error', async () => {
    const { buffer, queue, onError } = setup();
    buffer.dispatchEvent(new Event('error'));
    await queue.finish();
    expect(onError).toHaveBeenCalledOnce();
  });
});
