import { describe, it, expect } from 'vitest'
import { COARSE_STRIDE, FINE_WINDOW_SECONDS, planCoarsePass, planFinePass } from './framePlan'

describe('planCoarsePass', () => {
  it('samples every COARSE_STRIDE-th frame across the clip', () => {
    const times = planCoarsePass(1, 60)
    expect(times[0]).toBeCloseTo(0, 10)
    expect(times[1]).toBeCloseTo(COARSE_STRIDE / 60, 10)
    expect(times.length).toBe(Math.ceil(60 / COARSE_STRIDE))
  })

  it('never proposes a time at or past the duration', () => {
    for (const t of planCoarsePass(2.05, 30)) {
      expect(t).toBeLessThan(2.05)
      expect(t).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns strictly increasing times', () => {
    const times = planCoarsePass(3, 60)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!)
    }
  })

  it('returns nothing for a degenerate clip', () => {
    expect(planCoarsePass(0, 60)).toEqual([])
    expect(planCoarsePass(1, 0)).toEqual([])
  })
})

describe('planFinePass', () => {
  // A coarse pass at 60 fps with stride 6 samples every 0.1 s.
  const coarse = Array.from({ length: 30 }, (_, i) => i * 0.1)

  it('leaves no gap in the window, and never repeats a coarse instant', () => {
    // airborne at coarse indices 10..14, i.e. 1.0 s .. 1.4 s
    const fine = planFinePass(coarse, [10, 11, 12, 13, 14], 3, 60)
    const frame = 1 / 60
    const from = 1.0 - FINE_WINDOW_SECONDS
    const to = 1.4 + FINE_WINDOW_SECONDS

    // The point of two passes is that together they read every frame in the
    // window. Neither pass is contiguous on its own — the dense pass skips the
    // instants the coarse pass already covered — so the property has to be
    // stated over the union.
    const covered = new Set(
      [...coarse, ...fine]
        .filter((t) => t >= from - 1e-9 && t < to - 1e-9)
        .map((t) => Math.round(t / frame))
    )
    for (let n = Math.ceil(from / frame); n * frame < to; n++) {
      expect(covered.has(n)).toBe(true)
    }

    for (const t of fine) {
      expect(coarse.some((c) => Math.round(c / frame) === Math.round(t / frame))).toBe(false)
    }
  })

  it('clamps the window to the clip', () => {
    const fine = planFinePass(coarse, [0, 1], 3, 60)
    expect(Math.min(...fine)).toBeGreaterThanOrEqual(0)
    for (const t of fine) expect(t).toBeLessThan(3)
  })

  it('omits times the coarse pass already visited', () => {
    const fine = planFinePass(coarse, [10, 11], 3, 60)
    for (const t of fine) {
      expect(coarse.some((c) => Math.abs(c - t) < 1e-9)).toBe(false)
    }
  })

  it('returns nothing when no frame was airborne', () => {
    expect(planFinePass(coarse, [], 3, 60)).toEqual([])
  })
})
