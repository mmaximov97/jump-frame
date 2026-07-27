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

describe('buildComTrack', () => {
  it('scales normalized coordinates into pixels', () => {
    const track = buildComTrack([frame(0, {})], VIDEO)
    // Every landmark at y=0.5 puts the com at y=0.5 too.
    expect(track.comY[0]).toBeCloseTo(0.5 * VIDEO.height, 6)
  })

  it('takes footY as the lowest of the six foot landmarks', () => {
    const track = buildComTrack([frame(0, {
      [LM.LEFT_ANKLE]: { x: 0.5, y: 0.70 },
      [LM.LEFT_HEEL]: { x: 0.5, y: 0.80 },
      [LM.LEFT_FOOT_INDEX]: { x: 0.5, y: 0.75 },
    })], VIDEO)
    expect(track.footY[0]).toBeCloseTo(0.80 * VIDEO.height, 6)
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

  it('resists the noise spike a plain maximum would latch onto', () => {
    // footY is itself a max over six landmarks, so noise pushes spans upward.
    // A plain Math.max then chases the largest spike; the 90th percentile does
    // not. Compare the two against the value the generator actually encodes.
    const truthPx = 1.8 * 400 * 0.936 / 0.9 // stature * scale * nose fraction / estimator divisor

    for (const seed of [1, 2, 3, 4, 5]) {
      const clip = generateJump({
        jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
        videoWidth: VIDEO.width, videoHeight: VIDEO.height, statureM: 1.8,
        noiseSigma: 0.01, seed,
      })
      const track = buildComTrack(clip.frames, VIDEO)

      const spans = clip.frames.map((f) => {
        const foot = Math.max(...FOOT_LANDMARKS.map((i) => f.landmarks[i]!.y * VIDEO.height))
        return foot - f.landmarks[LM.NOSE]!.y * VIDEO.height
      })
      const naivePx = Math.max(...spans) / 0.9

      expect(Math.abs(track.staturePx - truthPx)).toBeLessThan(Math.abs(naivePx - truthPx))
    }
  })
})
