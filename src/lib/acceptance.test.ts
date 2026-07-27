import { describe, it, expect } from 'vitest'
import { analyseJump, measureJump } from './jumpFromCom'
import { buildComTrack } from './comTrack'
import { findFlightPhase } from './flightPhase'
import { fitParabola } from './parabolaFit'
import { generateJump } from './testing/syntheticJumper'
import { LM } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }
const BASE = {
  jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
  videoWidth: VIDEO.width, videoHeight: VIDEO.height,
}

describe('acceptance: the pipeline recovers a known jump', () => {
  it('lands within 1 cm at 60 fps', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
  })

  // 30 fps is where sub-frame takeoff earns its keep: sampling the parabola at
  // the first airborne frame instead would cost about 5 cm here.
  it('lands within 1 cm at 30 fps, wherever takeoff falls inside the frame', () => {
    for (const takeoffPhase of [0.1, 0.35, 0.5, 0.75, 0.95]) {
      const result = analyseJump(
        generateJump({ ...BASE, fps: 30, takeoffPhase }).frames, VIDEO
      )!
      expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
    }
  })

  it('gives the same answer for the same clip every time', () => {
    const clip = generateJump(BASE)
    const a = analyseJump(clip.frames, VIDEO)!
    const b = analyseJump(clip.frames, VIDEO)!
    expect(a.comHeightCm).toBe(b.comHeightCm)
  })

  it('holds across a range of jump heights', () => {
    for (const jumpHeightM of [0.2, 0.35, 0.5, 0.7, 0.9]) {
      const result = analyseJump(generateJump({ ...BASE, jumpHeightM }).frames, VIDEO)!
      expect(Math.abs(result.comHeightCm - jumpHeightM * 100)).toBeLessThan(1)
    }
  })
})

describe('acceptance: why the segment model was necessary', () => {
  it('stays accurate when the athlete tucks their legs', () => {
    const result = analyseJump(generateJump({ ...BASE, tuckM: 0.25 }).frames, VIDEO)!
    expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
    expect(result.rSquared).toBeGreaterThan(0.999)
  })

  // The hip midpoint owes nothing to the Dempster table, so this comparison
  // is meaningful even though the generator and centreOfMass share that table.
  it('would be wrong on the same jump if the hip midpoint stood in for the com', () => {
    const clip = generateJump({ ...BASE, tuckM: 0.35 })
    const track = buildComTrack(clip.frames, VIDEO)
    const phase = findFlightPhase(track)!
    const from = phase.takeoffFrame + 1
    const to = phase.landingFrame - 1

    const comResult = analyseJump(clip.frames, VIDEO)!
    const hipY = clip.frames.map(
      (f) => ((f.landmarks[LM.LEFT_HIP]!.y + f.landmarks[LM.RIGHT_HIP]!.y) / 2) * VIDEO.height
    )
    const hipFit = fitParabola(track.times.slice(from, to), hipY.slice(from, to))!
    const t = phase.takeoffTime
    const hipHeightCm =
      ((hipFit.c0 + hipFit.c1 * t + hipFit.c2 * t * t - hipFit.yApex) / hipFit.scalePxPerM) * 100

    // The robust claims first: the hip trajectory is measurably less ballistic
    // than the com trajectory, and the scale it implies is wrong.
    expect(hipFit.rSquared).toBeLessThan(comResult.rSquared)
    expect(Math.abs(hipFit.scalePxPerM - 400)).toBeGreaterThan(10)
    // Then the consequence the user would actually see.
    expect(Math.abs(hipHeightCm - 50)).toBeGreaterThan(2)
  })
})

describe('acceptance: noise and failure modes', () => {
  it('averages landmark noise down to within 1 cm', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = analyseJump(
        generateJump({ ...BASE, noiseSigma: 0.005, seed }).frames, VIDEO
      )!
      expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
    }
  })

  it('catches baked-in slow motion through an impossible stature', () => {
    const result = measureJump(generateJump({ ...BASE, timeScale: 2 }).frames, VIDEO)
    expect(result.analysis).not.toBeNull()
    expect(result.verdict.kind).toBe('unusable')
    expect(result.analysis!.statureM).toBeGreaterThan(2.2)
  })

  it('inflates both methods by the same factor under slow motion, so they still agree', () => {
    // This is the cross-check's blind spot, pinned down as a test so nobody
    // later mistakes agreement between the two methods for correctness.
    const result = analyseJump(generateJump({ ...BASE, timeScale: 2 }).frames, VIDEO)!
    const relative = Math.abs(result.comHeightCm - result.flightTimeHeightCm) / result.comHeightCm
    expect(relative).toBeLessThan(0.1)
    expect(result.comHeightCm).toBeGreaterThan(150)
  })
})
