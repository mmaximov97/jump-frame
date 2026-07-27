import { describe, it, expect } from 'vitest'
import { assess, measureJump, analyseJump, type QualityMetrics } from './jumpFromCom'
import { generateJump } from './testing/syntheticJumper'

const VIDEO = { width: 720, height: 1280 }

const GOOD: QualityMetrics = {
  rSquared: 0.999,
  flightFrames: 30,
  statureM: 1.8,
  comHeightCm: 50,
  flightTimeHeightCm: 52,
}

describe('assess', () => {
  it('passes a clean measurement', () => {
    expect(assess(GOOD)).toEqual({ kind: 'ok', heightCm: 50 })
  })

  it('rejects a degenerate height before dividing by it', () => {
    expect(assess({ ...GOOD, comHeightCm: 0 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, comHeightCm: -3 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, comHeightCm: NaN }).kind).toBe('unusable')
  })

  it('rejects a flight too short to fit a curve through', () => {
    expect(assess({ ...GOOD, flightFrames: 7 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, flightFrames: 8 }).kind).toBe('ok')
  })

  it('rejects a trajectory that is not ballistic', () => {
    expect(assess({ ...GOOD, rSquared: 0.94 }).kind).toBe('unusable')
  })

  it('rejects an implausible stature and blames slow motion', () => {
    const tall = assess({ ...GOOD, statureM: 7.2 })
    expect(tall.kind).toBe('unusable')
    expect(tall.kind === 'unusable' && tall.message.length).toBeGreaterThan(0)
    expect(assess({ ...GOOD, statureM: 1.2 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, statureM: 1.3 }).kind).toBe('ok')
    expect(assess({ ...GOOD, statureM: 2.2 }).kind).toBe('ok')
  })

  it('warns when the fit is merely acceptable', () => {
    const verdict = assess({ ...GOOD, rSquared: 0.97 })
    expect(verdict.kind).toBe('warn')
    expect(verdict.kind === 'warn' && verdict.heightCm).toBe(50)
  })

  it('warns when the two methods disagree by more than a fifth', () => {
    expect(assess({ ...GOOD, flightTimeHeightCm: 61 }).kind).toBe('warn')
    expect(assess({ ...GOOD, flightTimeHeightCm: 59 }).kind).toBe('ok')
  })

  it('lets the earlier check win when several fire at once', () => {
    // A bad stature AND a bad fit: the stature message must be the one shown.
    const verdict = assess({ ...GOOD, statureM: 7.2, rSquared: 0.96 })
    expect(verdict.kind).toBe('unusable')
  })
})

describe('measureJump', () => {
  it('reports ok on a clean generated jump', () => {
    const result = measureJump(generateJump({
      jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height,
    }).frames, VIDEO)
    expect(result.analysis).not.toBeNull()
    expect(result.verdict.kind).toBe('ok')
  })

  it('reports unusable with no analysis when there is no jump', () => {
    const result = measureJump([], VIDEO)
    expect(result.analysis).toBeNull()
    expect(result.verdict.kind).toBe('unusable')
  })
})

// Task 6 established a genuine failure regime in analyseJump: when the jump
// is tiny, the frame rate low and the noise high, the fitted parabola's
// vertex extrapolates outside the sampled window and the reported height
// comes out 20-90x too large (57-266cm reported for a 3cm true jump). No
// guard was added inside analyseJump itself, on the reasoning that assess()
// would catch every such case — flightFrames < 8 kills short-flight cases,
// rSquared < 0.95 kills bad fits under heavy noise, and the stature band
// kills absurd scales.
//
// A sweep of 60,000 synthetic clips (jumpHeightM 0.01-0.5m, fps 24-120,
// noiseSigma 0-0.01, tuckM 0-0.3, 10 seeds, 5 takeoff phases) found 1,087
// cases where analyseJump reported a height more than 3x the generated
// truth. Every single one was caught by assess() as 'unusable' — none came
// back 'ok' or 'warn'. The closest call in that sweep is pinned below; the
// second test re-runs a smaller slice of the same grid so a future change
// that lets a pathological case slip through fails loudly.
describe('assess catches the parabola-extrapolation failure mode (Task 6)', () => {
  it('does not pass the closest near-miss found by the sweep', () => {
    // jumpHeightM 0.08, fps 24, noiseSigma 0.01, tuckM 0.1, seed 10,
    // takeoffPhase 0.7: analyseJump's rSquared comes out 0.949480..., just
    // 0.00052 below the 0.95 cutoff — the closest any pathological case in
    // the sweep came to slipping past a guard. Reported height 25.14cm
    // against an 8cm truth (3.14x). Caught anyway: statureM comes out 2.83,
    // outside the 1.3-2.2 band, so even a hair's shift in rSquared would
    // still be caught downstream.
    const clip = generateJump({
      jumpHeightM: 0.08, scalePxPerM: 400, fps: 24,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height,
      noiseSigma: 0.01, tuckM: 0.1, seed: 10, takeoffPhase: 0.7,
    })
    const result = analyseJump(clip.frames, VIDEO)
    expect(result).not.toBeNull()
    const analysis = result!
    expect(analysis.comHeightCm).toBeGreaterThan(3 * 8)
    expect(assess(analysis).kind).toBe('unusable')
  })

  it('never reports ok or warn when analyseJump overshoots the truth by more than 3x', () => {
    const jumpHeightsM = [0.01, 0.02, 0.03, 0.05, 0.08]
    const fpsValues = [24, 25, 30]
    const noiseSigmas = [0.003, 0.005, 0.007, 0.01]
    const tuckMs = [0, 0.1, 0.3]
    const seeds = [1, 2, 3, 4, 5]
    const takeoffPhases = [0.1, 0.5, 0.9]

    let pathologicalCount = 0
    const survivors: Array<{ params: Record<string, number>; ratio: number }> = []

    for (const jumpHeightM of jumpHeightsM) {
      for (const fps of fpsValues) {
        for (const noiseSigma of noiseSigmas) {
          for (const tuckM of tuckMs) {
            for (const seed of seeds) {
              for (const takeoffPhase of takeoffPhases) {
                const clip = generateJump({
                  jumpHeightM, scalePxPerM: 400, fps,
                  videoWidth: VIDEO.width, videoHeight: VIDEO.height,
                  noiseSigma, tuckM, seed, takeoffPhase,
                })
                const result = analyseJump(clip.frames, VIDEO)
                if (!result) continue
                const truthCm = jumpHeightM * 100
                if (!Number.isFinite(result.comHeightCm) || result.comHeightCm <= 0) continue
                const ratio = result.comHeightCm / truthCm
                if (ratio > 3) {
                  pathologicalCount++
                  const verdict = assess(result)
                  if (verdict.kind === 'ok' || verdict.kind === 'warn') {
                    survivors.push({ params: { jumpHeightM, fps, noiseSigma, tuckM, seed, takeoffPhase }, ratio })
                  }
                }
              }
            }
          }
        }
      }
    }

    // Sanity check on the test itself: this grid must actually provoke the
    // failure mode, or the assertion below would pass vacuously.
    expect(pathologicalCount).toBeGreaterThan(0)
    expect(survivors).toEqual([])
  })
})
