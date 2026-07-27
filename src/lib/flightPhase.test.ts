import { describe, it, expect } from 'vitest'
import { findFlightPhase } from './flightPhase'
import { buildComTrack } from './comTrack'
import { generateJump } from './testing/syntheticJumper'
import type { ComTrack } from './comTrack'

/** A hand-built track: flat floor, then a lift, then back down. */
function track(footY: number[], fps = 60): ComTrack {
  return {
    times: footY.map((_, i) => i / fps),
    comY: footY.map(() => 0),
    footY,
    staturePx: 500,
  }
}

describe('findFlightPhase', () => {
  it('returns null when the feet never leave the floor', () => {
    expect(findFlightPhase(track([100, 100, 100, 100, 100]))).toBeNull()
  })

  it('finds the boundaries of the airborne run', () => {
    // threshold = 0.02 * 500 = 10px, so 100 -> 80 counts as airborne
    const phase = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))!
    expect(phase.takeoffFrame).toBe(2)
    expect(phase.landingFrame).toBe(5)
  })

  it('picks the longest run when the feet lift more than once', () => {
    const phase = findFlightPhase(track([100, 60, 100, 100, 60, 60, 60, 100]))!
    expect(phase.takeoffFrame).toBe(4)
    expect(phase.landingFrame).toBe(7)
  })

  it('rejects an airborne run longer than 1.5 seconds', () => {
    // The standing frames have to outnumber the airborne ones, otherwise the
    // 90th-percentile floor lands on the airborne value and nothing registers
    // as a lift at all — the test would pass for the wrong reason.
    const stand = Array.from({ length: 40 }, () => 100)
    const air = Array.from({ length: 100 }, () => 60) // 100 frames at 60 fps = 1.67 s
    expect(findFlightPhase(track([...stand, ...air, ...stand]))).toBeNull()
  })

  it('accepts an airborne run just under the limit', () => {
    const stand = Array.from({ length: 40 }, () => 100)
    const air = Array.from({ length: 80 }, () => 60) // 1.33 s
    expect(findFlightPhase(track([...stand, ...air, ...stand]))).not.toBeNull()
  })

  it('places takeoff between the last contact frame and the first airborne one', () => {
    const phase = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))!
    expect(phase.takeoffTime).toBeGreaterThanOrEqual(1 / 60)
    expect(phase.takeoffTime).toBeLessThanOrEqual(2 / 60)
    expect(phase.landingTime).toBeGreaterThanOrEqual(4 / 60)
    expect(phase.landingTime).toBeLessThanOrEqual(5 / 60)
  })

  it('recovers the generated takeoff instant to better than a third of a frame', () => {
    for (const fps of [30, 60]) {
      for (const takeoffPhase of [0.2, 0.5, 0.8]) {
        const clip = generateJump({
          jumpHeightM: 0.5, scalePxPerM: 400, fps,
          videoWidth: 720, videoHeight: 1280, takeoffPhase,
        })
        const phase = findFlightPhase(buildComTrack(clip.frames, { width: 720, height: 1280 }))!
        expect(Math.abs(phase.takeoffTime - clip.truth.takeoffTime)).toBeLessThan(1 / (3 * fps))
      }
    }
  })

  it('survives a flight phase that starts on the very first frame', () => {
    const phase = findFlightPhase(track([60, 60, 60, 100, 100]))!
    expect(phase.takeoffFrame).toBe(0)
    expect(phase.takeoffTime).toBe(0)
  })
})
