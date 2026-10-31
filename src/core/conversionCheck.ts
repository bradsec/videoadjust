import {
  AudioSampleSource,
  Conversion,
  NullTarget,
  Output,
  type DiscardedTrack,
  type Input,
  type OutputFormat,
  type TrackType,
} from 'mediabunny';
import type { ConversionJob } from './convert';

export class ConversionInvalidError extends Error {
  constructor(public readonly discarded: { track: TrackType; reason: DiscardedTrack['reason'] }[]) {
    const list = discarded.map((d) => `${d.track} track: ${d.reason}`).join(', ');
    super(`This video cannot be converted with these settings (${list || 'no usable tracks'}).`);
    this.name = 'ConversionInvalidError';
  }
}

export function discardedPrimaryTracks(
  keeps: ConversionJob['keeps'],
  primaryVideo: unknown,
  primaryAudio: unknown,
  discarded: readonly { track: unknown; reason: DiscardedTrack['reason'] }[],
): { track: TrackType; reason: DiscardedTrack['reason'] }[] {
  const lost: { track: TrackType; reason: DiscardedTrack['reason'] }[] = [];
  for (const { track, reason } of discarded) {
    if (reason === 'discarded_by_user') continue;
    if (keeps.video && track === primaryVideo) lost.push({ track: 'video', reason });
    if (keeps.audio && track === primaryAudio) lost.push({ track: 'audio', reason });
  }
  return lost;
}

export async function initConversion(
  input: Input,
  job: ConversionJob,
  output: Output,
): Promise<{ conversion: Conversion; audioSource?: AudioSampleSource }> {
  const custom = job.customAudio;
  const { tags, ...trackOptions } = job.options;
  const audioSource = custom ? new AudioSampleSource(custom.encoding) : undefined;
  if (audioSource) output.addAudioTrack(audioSource);
  const conversion = await Conversion.init({
    input,
    output,
    // The custom-audio path sets tags on the output itself.
    ...(custom ? trackOptions : { ...trackOptions, tags }),
    showWarnings: false,
    ...(custom ? { composable: true, tracks: 'primary' } : {}),
  });
  return { conversion, audioSource };
}

export async function assertConversionValid(
  input: Input,
  job: ConversionJob,
  conversion: Conversion,
): Promise<void> {
  const [primaryVideo, primaryAudio] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
  ]);
  const lostPrimary = discardedPrimaryTracks(
    job.keeps,
    primaryVideo,
    primaryAudio,
    conversion.discardedTracks,
  );
  if (!conversion.isValid || lostPrimary.length) {
    throw new ConversionInvalidError(
      lostPrimary.length
        ? lostPrimary
        : conversion.discardedTracks.map((d) => ({ track: d.track.type, reason: d.reason })),
    );
  }
}

/**
 * Runs Mediabunny's track checks for `job` against an output that is never started, so an
 * export that cannot convert fails before a save picker opens or any byte is written. Throws
 * ConversionInvalidError like startConversion. job.prepare is not run.
 */
export async function checkConversion(
  input: Input,
  job: ConversionJob,
  format: OutputFormat,
): Promise<void> {
  const output = new Output({ format, target: new NullTarget() });
  const { conversion } = await initConversion(input, job, output);
  try {
    await assertConversionValid(input, job, conversion);
  } finally {
    await conversion.cancel();
    // A composable conversion leaves its output to the caller.
    if (job.customAudio) await output.cancel();
  }
}
