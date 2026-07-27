import { describe, it, expect } from 'vitest'
import { analyseJump } from './jumpFromCom'
import { generateJump } from './testing/syntheticJumper'
import { LANDMARK_COUNT, type PoseFrame } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }
const BASE = {
  jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
  videoWidth: VIDEO.width, videoHeight: VIDEO.height,
}

describe('analyseJump', () => {
  it('returns null when there is no jump in the clip', () => {
    const flat: PoseFrame[] = Array.from({ length: 30 }, (_, i) => ({
      time: i / 60,
      landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 })),
    }))
    expect(analyseJump(flat, VIDEO)).toBeNull()
  })

  it('returns null for an empty clip', () => {
    expect(analyseJump([], VIDEO)).toBeNull()
  })

  it('recovers the generated jump height', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.comHeightCm).toBeGreaterThan(49)
    expect(result.comHeightCm).toBeLessThan(51)
  })

  it('recovers the pixels-per-metre scale without being told the stature', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.scalePxPerM).toBeGreaterThan(396)
    expect(result.scalePxPerM).toBeLessThan(404)
  })

  it('reports a stature inside the plausible human band', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.statureM).toBeGreaterThan(1.3)
    expect(result.statureM).toBeLessThan(2.2)
  })

  it('agrees with the flight-time formula on a symmetric jump', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    const relative = Math.abs(result.comHeightCm - result.flightTimeHeightCm) / result.comHeightCm
    expect(relative).toBeLessThan(0.05)
  })

  it('fits a clean parabola on noiseless input', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.rSquared).toBeGreaterThan(0.999)
    expect(result.flightFrames).toBeGreaterThan(8)
  })

  it('quotes an error bar that grows with the noise', () => {
    const clean = analyseJump(generateJump(BASE).frames, VIDEO)!
    const noisy = analyseJump(generateJump({ ...BASE, noiseSigma: 0.005, seed: 7 }).frames, VIDEO)!
    expect(noisy.errorCm).toBeGreaterThan(clean.errorCm)
  })
})
