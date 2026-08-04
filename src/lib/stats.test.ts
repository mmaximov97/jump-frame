import { describe, it, expect } from 'vitest'
import { rollingMedian, rollingPercentile } from './stats'

describe('rollingMedian', () => {
  it('returns the median of values within the window around each point', () => {
    const times = [0, 1, 2, 3, 4]
    const values = [10, 10, 10, 10, 10]
    expect(rollingMedian(times, values, 2, 1)).toEqual([10, 10, 10, 10, 10])
  })

  it('is robust to a short excursion smaller than half the window', () => {
    const times = [0, 1, 2, 3, 4, 5, 6]
    const values = [100, 100, 100, 40, 100, 100, 100]
    // Every index's window (+/-3s) reaches all 7 points; 6 of 7 are 100, so
    // the median stays 100 everywhere, including at the excursion itself.
    const result = rollingMedian(times, values, 6, 1)
    expect(result.every((v) => v === 100)).toBe(true)
  })

  it('tracks a slow drift instead of blending the whole range into one number', () => {
    const times = Array.from({ length: 21 }, (_, i) => i) // 0..20 seconds
    const values = times.map((t) => 100 - (t / 20) * 50) // 100 -> 50, linear
    const result = rollingMedian(times, values, 2, 1) // 2s window
    // Near t=0 the window only sees values close to 100; near t=20, close to
    // 50. A single global median (75) would be wrong at both ends.
    expect(result[0]!).toBeGreaterThan(95)
    expect(result[20]!).toBeLessThan(55)
  })

  it('returns null where fewer than minPoints fall in the window', () => {
    const times = [0, 10, 20] // far apart -- no window overlap
    const values = [1, 2, 3]
    expect(rollingMedian(times, values, 2, 2)).toEqual([null, null, null])
  })

  it('uses points from both before and after each index, not causal-only', () => {
    const times = [0, 1, 2]
    const values = [10, 20, 30]
    // Window +/-2s reaches all three points from any index. A causal-only
    // (backward-looking) window at index 0 would see just [10] and report
    // 10; this reaches forward too, seeing all of [10, 20, 30] (median 20).
    const result = rollingMedian(times, values, 4, 1)
    expect(result[0]).toBe(20)
  })

  it('handles uneven spacing -- dense clusters do not see each other', () => {
    const times = [0, 0.1, 0.2, 5, 5.1, 5.2]
    const values = [1, 2, 3, 100, 101, 102]
    const result = rollingMedian(times, values, 1, 1)
    expect(result[0]).toBeLessThan(10)
    expect(result[3]).toBeGreaterThan(90)
  })
})

describe('rollingPercentile', () => {
  it('matches rollingMedian at p=0.5', () => {
    const times = [0, 1, 2, 3, 4]
    const values = [5, 3, 8, 1, 9]
    expect(rollingPercentile(times, values, 10, 1, 0.5)).toEqual(rollingMedian(times, values, 10, 1))
  })

  it('picks a value near the top of the window at a high percentile', () => {
    const times = [0, 1, 2, 3, 4]
    const values = [1, 2, 3, 4, 100]
    // Window (+/-5s) covers all 5 points from index 0. Sorted: [1,2,3,4,100],
    // n=5, p=0.9 -> index round(0.9*4)=4 -> 100.
    expect(rollingPercentile(times, values, 10, 1, 0.9)[0]).toBe(100)
  })

  it('returns null where fewer than minPoints fall in the window', () => {
    const times = [0, 10]
    const values = [1, 2]
    expect(rollingPercentile(times, values, 1, 2, 0.9)).toEqual([null, null])
  })
})
