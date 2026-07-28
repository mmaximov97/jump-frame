import { describe, it, expect } from 'vitest'
import { buildComTrack } from './comTrack'
import { generateJump } from './testing/syntheticJumper'
import { FOOT_LANDMARKS, LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }

function frame(time: number, overrides: Record<number, Landmark>): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 }))
  for (const [index, value] of Object.entries(overrides)) {
    landmarks[Number(index)] = value
  }
  return { time, landmarks }
}

// Duplicated from comTrack.ts's own (unexported) helper, so the "naive"
// baseline below can hold footY's statistic fixed at the shipped median and
// vary only the thing this test is actually about: percentile vs maximum.
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

describe('buildComTrack', () => {
  it('scales normalized coordinates into pixels', () => {
    const track = buildComTrack([frame(0, {})], VIDEO)
    // Every landmark at y=0.5 puts the com at y=0.5 too.
    expect(track.comY[0]).toBeCloseTo(0.5 * VIDEO.height, 6)
  })

  // Was "takes footY as the lowest of the six foot landmarks", asserting a
  // plain maximum. footY is now the median of the six — a maximum is biased
  // and high-variance under noise at exactly the point the pipeline is most
  // sensitive to it (see computeFootY's docstring in comTrack.ts). Updated to
  // pin the new definition and to demonstrate the property that motivated
  // the change: a single spiked landmark (RIGHT_FOOT_INDEX here, standing in
  // for a misdetection) no longer drags footY all the way down to it.
  it('takes footY as the median of the six foot landmarks, resisting a single spike', () => {
    const track = buildComTrack([frame(0, {
      [LM.LEFT_ANKLE]: { x: 0.5, y: 0.60 },
      [LM.RIGHT_ANKLE]: { x: 0.5, y: 0.61 },
      [LM.LEFT_HEEL]: { x: 0.5, y: 0.79 },
      [LM.RIGHT_HEEL]: { x: 0.5, y: 0.81 },
      [LM.LEFT_FOOT_INDEX]: { x: 0.5, y: 0.76 },
      // The spike: far below the rest of the cluster. A maximum would report
      // the foot here, 9-30 points of normalized height below the truth.
      [LM.RIGHT_FOOT_INDEX]: { x: 0.5, y: 0.90 },
    })], VIDEO)
    // Sorted: [0.60, 0.61, 0.76, 0.79, 0.81, 0.90] -> median = avg(0.76, 0.79).
    expect(track.footY[0]).toBeCloseTo(0.775 * VIDEO.height, 6)
  })

  it('carries the frame times through unchanged', () => {
    const track = buildComTrack([frame(0.25, {}), frame(0.5, {})], VIDEO)
    expect(track.times).toEqual([0.25, 0.5])
  })

  it('recovers a plausible stature from a generated clip', () => {
    const clip = generateJump({
      jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height, statureM: 1.8,
    })
    const track = buildComTrack(clip.frames, VIDEO)
    // The generator puts the nose at 0.936 of stature while the estimator
    // divides by 0.90, so a few percent of overshoot is expected and fine.
    expect(track.staturePx / 400).toBeGreaterThan(1.7)
    expect(track.staturePx / 400).toBeLessThan(2.0)
  })

  it('returns empty arrays for an empty clip rather than throwing', () => {
    const track = buildComTrack([], VIDEO)
    expect(track.times).toEqual([])
    expect(track.comY).toEqual([])
    expect(track.footY).toEqual([])
    expect(track.staturePx).toBe(0)
  })

  // Isolates the percentile-vs-maximum choice specifically. The naive
  // baseline below uses the SAME footY statistic as buildComTrack — the
  // median of the six foot landmarks — and differs only in how spans are
  // aggregated across frames: Math.max instead of the 90th percentile. This
  // matters because footY itself changed (median, not a max) in a later
  // fix: if the naive baseline recomputed footY as a max too, the median
  // improvement alone would already beat it regardless of which span
  // aggregation was used, and this test would stop discriminating what it
  // claims to. Mutation-tested: swapping `percentile(spans, 0.9)` for
  // `Math.max(...spans)` in buildComTrack now makes this test fail (it did
  // not fail under the old max-based footY, where the median improvement
  // hadn't happened yet and the naive baseline was a legitimately weaker
  // comparison) — see the fix report for the mutation-test output.
  it('resists the noise spike a plain maximum-of-spans would latch onto', () => {
    const truthPx = 1.8 * 400 * 0.936 / 0.9 // stature * scale * nose fraction / estimator divisor

    for (const seed of [1, 2, 3, 4, 5]) {
      const clip = generateJump({
        jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
        videoWidth: VIDEO.width, videoHeight: VIDEO.height, statureM: 1.8,
        noiseSigma: 0.01, seed,
      })
      const track = buildComTrack(clip.frames, VIDEO)

      const spans = clip.frames.map((f) => {
        // Same footY statistic as production (median of six) — only the
        // percentile-vs-max aggregation below is allowed to differ.
        const foot = median(FOOT_LANDMARKS.map((i) => f.landmarks[i]!.y * VIDEO.height))
        return foot - f.landmarks[LM.NOSE]!.y * VIDEO.height
      })
      const naivePx = Math.max(...spans) / 0.9

      expect(Math.abs(track.staturePx - truthPx)).toBeLessThan(Math.abs(naivePx - truthPx))
    }
  })
})
