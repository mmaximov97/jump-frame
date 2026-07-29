import { percentile } from './stats'

/**
 * The frame rates a user-facing selector would offer. A detected rate is
 * snapped to the nearest one: real-world containers carry rates like 59.97
 * or 23.976, and the app's arithmetic (`1 / fps` stepping, `time * fps`
 * frame numbers) is clearer against the nominal rate the video was shot at.
 */
export const STANDARD_FPS = [24, 25, 30, 50, 60, 120, 240] as const

/**
 * One `requestVideoFrameCallback` observation.
 *
 * `presentedFrames` is the key field, and the reason this module exists.
 * rVFC fires at most once per *display* refresh, not once per *video*
 * frame, so whenever two video frames fall inside one refresh interval the
 * callback for the first one never runs — but `presentedFrames` still
 * counts it. Dividing by the `presentedFrames` delta recovers the true
 * per-frame interval instead of a multiple of it.
 */
export interface FrameSample {
  mediaTime: number
  presentedFrames: number
}

export function snapToStandardFps(rawFps: number): number {
  let closest: number = STANDARD_FPS[0]
  let minDiff = Infinity
  for (const std of STANDARD_FPS) {
    const diff = Math.abs(rawFps - std)
    if (diff < minDiff) {
      minDiff = diff
      closest = std
    }
  }
  return closest
}

/** Below this, the median is estimated from too little to trust. */
const MIN_INTERVALS = 3

/**
 * The video's frame rate, snapped to {@link STANDARD_FPS}, or `null` when
 * the samples do not support an estimate.
 *
 * Each consecutive pair of samples gives `Δmediatime / Δpresentedframes` —
 * the media time each *frame* advanced, not each *callback*. Without that
 * division a skipped callback reads as a double-length frame; a run of them
 * drags the median onto 2× the true interval and the app reports 30 fps for
 * a 60 fps video, halving every frame number it displays and making the
 * step buttons jump two frames at a time.
 *
 * The median (rather than the mean) absorbs the remaining stragglers: a
 * container timestamp that jitters, or a pair whose `presentedFrames` did
 * not advance at all. Both show up as a few bad intervals among many good
 * ones, which is exactly what a median is for.
 */
export function estimateFps(samples: FrameSample[]): number | null {
  const intervals: number[] = []

  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]!
    const current = samples[i]!

    const elapsed = current.mediaTime - previous.mediaTime
    const framesAdvanced = current.presentedFrames - previous.presentedFrames

    // A pair that went backwards, stood still, or carries a non-finite
    // field tells us nothing about the frame interval. Drop it rather than
    // let it divide by zero or poison the sort.
    if (!Number.isFinite(elapsed) || !Number.isFinite(framesAdvanced)) continue
    if (elapsed <= 0 || framesAdvanced < 1) continue

    intervals.push(elapsed / framesAdvanced)
  }

  if (intervals.length < MIN_INTERVALS) return null

  intervals.sort((a, b) => a - b)
  const medianInterval = percentile(intervals, 0.5)
  if (medianInterval <= 0) return null

  return snapToStandardFps(1 / medianInterval)
}
