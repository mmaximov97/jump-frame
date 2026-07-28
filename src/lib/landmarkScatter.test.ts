import { describe, it, expect } from 'vitest'
import { estimateScatter } from './landmarkScatter'
import { LANDMARK_COUNT, LM, type PoseFrame } from './poseTypes'

/** A still pose with independent gaussian noise of a known sigma. */
function stillClip(frameCount: number, sigma: number, seed = 1): PoseFrame[] {
  let state = seed >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const gauss = () => {
    const u = Math.max(rand(), Number.EPSILON)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  return Array.from({ length: frameCount }, (_, i) => ({
    time: i / 60,
    landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({
      x: 0.5 + gauss() * sigma,
      y: 0.5 + gauss() * sigma,
    })),
  }))
}

describe('estimateScatter', () => {
  it('recovers the sigma it was given', () => {
    const result = estimateScatter(stillClip(120, 0.004))!
    expect(result.overall).toBeGreaterThan(0.0032)
    expect(result.overall).toBeLessThan(0.0048)
  })

  it('scales with the sigma', () => {
    const small = estimateScatter(stillClip(120, 0.002))!
    const large = estimateScatter(stillClip(120, 0.008))!
    expect(large.overall / small.overall).toBeGreaterThan(3)
    expect(large.overall / small.overall).toBeLessThan(5)
  })

  it('reports the feet separately', () => {
    const frames = stillClip(120, 0.002)
    // Make the feet three times noisier than everything else.
    let flip = 1
    for (const frame of frames) {
      flip = -flip
      for (const index of [LM.LEFT_HEEL, LM.RIGHT_HEEL, LM.LEFT_FOOT_INDEX,
                           LM.RIGHT_FOOT_INDEX, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) {
        frame.landmarks[index] = { x: 0.5, y: 0.5 + flip * 0.006 }
      }
    }
    const result = estimateScatter(frames)!
    expect(result.feet).toBeGreaterThan(result.overall)
  })

  it('reports how many frames it measured over', () => {
    const result = estimateScatter(stillClip(90, 0.003))!
    expect(result.frames).toBeGreaterThan(20)
    expect(result.frames).toBeLessThanOrEqual(90)
  })

  it('returns null when there is no still stretch to measure', () => {
    expect(estimateScatter([])).toBeNull()
    expect(estimateScatter(stillClip(5, 0.003))).toBeNull()
  })
})
