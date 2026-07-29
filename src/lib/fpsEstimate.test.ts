import { describe, expect, it } from 'vitest'
import { estimateFps, snapToStandardFps, type FrameSample } from './fpsEstimate'

/**
 * Builds samples from a list of "frames advanced per callback". A `1` is a
 * callback that saw its own frame; anything higher is a callback that fired
 * once for several video frames, which is what rVFC does when the video's
 * rate is at or above the display's refresh rate.
 */
function samplesFrom(frameInterval: number, advances: number[]): FrameSample[] {
  const samples: FrameSample[] = [{ mediaTime: 0, presentedFrames: 0 }]
  let frames = 0
  for (const advance of advances) {
    frames += advance
    samples.push({ mediaTime: frames * frameInterval, presentedFrames: frames })
  }
  return samples
}

/** The estimator this module replaced: the median of the raw time deltas. */
function naiveMedianFps(samples: FrameSample[]): number {
  const deltas: number[] = []
  for (let i = 1; i < samples.length; i++) {
    deltas.push(samples[i]!.mediaTime - samples[i - 1]!.mediaTime)
  }
  deltas.sort((a, b) => a - b)
  return snapToStandardFps(1 / deltas[Math.floor(deltas.length / 2)]!)
}

describe('snapToStandardFps', () => {
  it('snaps broadcast rates to their nominal neighbours', () => {
    expect(snapToStandardFps(59.97)).toBe(60)
    expect(snapToStandardFps(29.97)).toBe(30)
    expect(snapToStandardFps(23.976)).toBe(24)
    expect(snapToStandardFps(119.88)).toBe(120)
    expect(snapToStandardFps(239.76)).toBe(240)
  })

  it('keeps rates that are already standard', () => {
    expect(snapToStandardFps(25)).toBe(25)
    expect(snapToStandardFps(50)).toBe(50)
  })
})

describe('estimateFps', () => {
  it('reads a clean 59.966 fps clip as 60', () => {
    // The rate ffprobe reports for the clip this bug was found on.
    const samples = samplesFrom(1 / 59.966, [1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(estimateFps(samples)).toBe(60)
  })

  it('reads a genuine 30 fps clip as 30, not 60', () => {
    const samples = samplesFrom(1 / 29.97, [1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(estimateFps(samples)).toBe(30)
  })

  it('reads 60 fps as 60 when most callbacks covered two frames', () => {
    // The regression this module exists for. Four of the seven callbacks
    // fired once for two frames, so the raw deltas are mostly 2/60 s and
    // their median sits on the doubled interval.
    const samples = samplesFrom(1 / 60, [2, 2, 2, 2, 1, 1, 1])

    // Guard: without this fixture actually tripping the old estimator, the
    // assertion below would pass for the wrong reason.
    expect(naiveMedianFps(samples)).toBe(30)

    expect(estimateFps(samples)).toBe(60)
  })

  it('reads 240 fps on a 60 Hz display, where every callback covers four frames', () => {
    const samples = samplesFrom(1 / 240, [4, 4, 4, 4, 4, 4])
    expect(naiveMedianFps(samples)).toBe(60)
    expect(estimateFps(samples)).toBe(240)
  })

  it('ignores a repeated callback that advanced no frames', () => {
    const frameInterval = 1 / 60
    const samples: FrameSample[] = [
      { mediaTime: 0, presentedFrames: 0 },
      { mediaTime: frameInterval, presentedFrames: 1 },
      { mediaTime: frameInterval, presentedFrames: 1 },
      { mediaTime: 2 * frameInterval, presentedFrames: 2 },
      { mediaTime: 3 * frameInterval, presentedFrames: 3 },
      { mediaTime: 4 * frameInterval, presentedFrames: 4 },
    ]
    expect(estimateFps(samples)).toBe(60)
  })

  it('survives one interval that presentedFrames failed to account for', () => {
    // Eight honest intervals plus one that reads 2/60 s because its
    // presentedFrames only moved by 1. Averaging the nine gives 10/9 of a
    // frame interval — 54 fps, which snaps to 50. The median does not move.
    const frameInterval = 1 / 60
    const samples = samplesFrom(frameInterval, [1, 1, 1, 1, 1, 1, 1, 1])
    samples.push({
      mediaTime: samples[samples.length - 1]!.mediaTime + 2 * frameInterval,
      presentedFrames: samples[samples.length - 1]!.presentedFrames + 1,
    })

    const intervals = [...Array(8).fill(frameInterval), 2 * frameInterval]
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    expect(snapToStandardFps(1 / mean)).toBe(50)

    expect(estimateFps(samples)).toBe(60)
  })

  it('returns null when there are fewer than three usable intervals', () => {
    const samples = samplesFrom(1 / 60, [1, 1])
    expect(estimateFps(samples)).toBeNull()
  })

  it('returns null for an empty or single-sample run', () => {
    expect(estimateFps([])).toBeNull()
    expect(estimateFps([{ mediaTime: 0, presentedFrames: 0 }])).toBeNull()
  })

  it('returns null when presentedFrames never advances', () => {
    const samples: FrameSample[] = [0, 1, 2, 3, 4].map((k) => ({
      mediaTime: k / 60,
      presentedFrames: 7,
    }))
    expect(estimateFps(samples)).toBeNull()
  })

  it('discards non-finite samples rather than propagating NaN', () => {
    const frameInterval = 1 / 60
    const samples = samplesFrom(frameInterval, [1, 1, 1, 1, 1, 1])
    samples[2] = { mediaTime: NaN, presentedFrames: 2 }
    expect(estimateFps(samples)).toBe(60)
  })
})
