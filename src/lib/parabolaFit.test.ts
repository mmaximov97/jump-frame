import { describe, it, expect } from 'vitest'
import { fitParabola } from './parabolaFit'
import { GRAVITY } from './physics'

/** Samples of y = c0 + c1 t + c2 t^2 at n evenly spaced points. */
function samples(c0: number, c1: number, c2: number, n: number, dt: number, t0 = 0) {
  const times = Array.from({ length: n }, (_, i) => t0 + i * dt)
  return { times, values: times.map((t) => c0 + c1 * t + c2 * t * t) }
}

describe('fitParabola', () => {
  it('recovers exact coefficients from clean samples', () => {
    const { times, values } = samples(100, -300, 1962, 30, 1 / 60)
    const fit = fitParabola(times, values)!
    expect(fit.c0).toBeCloseTo(100, 4)
    expect(fit.c1).toBeCloseTo(-300, 4)
    expect(fit.c2).toBeCloseTo(1962, 4)
    expect(fit.rSquared).toBeCloseTo(1, 10)
    expect(fit.rmsResidualPx).toBeCloseTo(0, 6)
  })

  it('stays accurate when the clip timestamps are far from zero', () => {
    const { times, values } = samples(100, -300, 1962, 30, 1 / 60, 42)
    const fit = fitParabola(times, values)!
    expect(fit.c2).toBeCloseTo(1962, 3)
  })

  it('derives the pixels-per-metre scale from the fitted gravity', () => {
    const scale = 400
    // a_px = g * scale, and c2 = a_px / 2
    const { times, values } = samples(0, -1000, (GRAVITY * scale) / 2, 30, 1 / 60)
    const fit = fitParabola(times, values)!
    expect(fit.scalePxPerM).toBeCloseTo(scale, 6)
    expect(fit.aPx).toBeCloseTo(GRAVITY * scale, 6)
  })

  it('locates the apex as the minimum of a screen-space parabola', () => {
    // y down: the apex of the jump is the smallest y.
    const { times, values } = samples(1000, -400, 1962, 40, 1 / 60)
    const fit = fitParabola(times, values)!
    expect(fit.tApex).toBeCloseTo(400 / (2 * 1962), 6)
    expect(fit.yApex).toBeCloseTo(1000 - (400 * 400) / (4 * 1962), 4)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(fit.yApex - 1e-6)
  })

  it('drops the R squared when the samples are not parabolic', () => {
    const times = Array.from({ length: 20 }, (_, i) => i / 60)
    const values = times.map((t, i) => 1000 + 1962 * t * t + (i % 2 === 0 ? 40 : -40))
    const fit = fitParabola(times, values)!
    expect(fit.rSquared).toBeLessThan(0.99)
    expect(fit.rmsResidualPx).toBeGreaterThan(10)
  })

  it('refuses a fit that curves the wrong way', () => {
    const { times, values } = samples(0, 100, -500, 20, 1 / 60)
    expect(fitParabola(times, values)).toBeNull()
  })

  it('refuses fewer than three points', () => {
    expect(fitParabola([0, 1], [0, 1])).toBeNull()
  })

  it('refuses samples that share a single timestamp', () => {
    expect(fitParabola([1, 1, 1, 1], [0, 1, 2, 3])).toBeNull()
  })
})
