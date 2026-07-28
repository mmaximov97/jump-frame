import { describe, it, expect } from 'vitest'
import { findFlightPhase } from './flightPhase'
import { buildComTrack } from './comTrack'
import { generateJump } from './testing/syntheticJumper'
import type { ComTrack } from './comTrack'
import type { FlightPhase, FlightPhaseOutcome } from './flightPhase'

/** A hand-built track: flat floor, then a lift, then back down. */
function track(footY: number[], fps = 60): ComTrack {
  return {
    times: footY.map((_, i) => i / fps),
    comY: footY.map(() => 0),
    footY,
    staturePx: 500,
  }
}

/**
 * Unwraps the phase out of a 'found' or 'too-long' outcome, failing loudly
 * (not silently returning undefined) for the outcomes that carry none —
 * the same non-null-assertion spirit as this codebase's usual `!`, just
 * spelled out because there is no single "the happy path" property left to
 * assert on directly.
 */
function phaseOf(outcome: FlightPhaseOutcome): FlightPhase {
  if (outcome.kind !== 'found' && outcome.kind !== 'too-long') {
    throw new Error(`expected a resolved phase, got outcome kind '${outcome.kind}'`)
  }
  return outcome.phase
}

describe('findFlightPhase', () => {
  it('returns no-flight when the feet never leave the floor', () => {
    expect(findFlightPhase(track([100, 100, 100, 100, 100]))).toEqual({ kind: 'no-flight' })
  })

  it('finds the boundaries of the airborne run', () => {
    // threshold = 0.02 * 500 = 10px, so 100 -> 80 counts as airborne
    const outcome = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))
    expect(outcome.kind).toBe('found')
    const phase = phaseOf(outcome)
    expect(phase.takeoffFrame).toBe(2)
    expect(phase.landingFrame).toBe(5)
  })

  it('picks the longest run when the feet lift more than once', () => {
    const phase = phaseOf(findFlightPhase(track([100, 60, 100, 100, 60, 60, 60, 100])))
    expect(phase.takeoffFrame).toBe(4)
    expect(phase.landingFrame).toBe(7)
  })

  // Was "rejects an airborne run longer than 1.5 seconds" (asserted null).
  // findFlightPhase no longer rejects a long run outright — it still fully
  // resolves the sub-frame boundary and tags the outcome 'too-long' instead,
  // so jumpFromCom's stature check downstream gets a chance to tell a saved
  // slow-motion clip from a genuinely lost tracker (see jumpFromCom.ts's
  // assess, and acceptance.test.ts's k-sweep for the end-to-end behaviour
  // this enables). This test now pins the tagging, not a rejection.
  it('tags an airborne run longer than 1.5 seconds too-long instead of discarding it', () => {
    // The standing frames have to outnumber the airborne ones, otherwise the
    // 90th-percentile floor lands on the airborne value and nothing registers
    // as a lift at all — the test would pass for the wrong reason.
    const stand = Array.from({ length: 40 }, () => 100)
    const air = Array.from({ length: 100 }, () => 60) // 100 frames at 60 fps = 1.67 s
    const outcome = findFlightPhase(track([...stand, ...air, ...stand]))
    expect(outcome.kind).toBe('too-long')
    // Still a fully resolved phase, not a bare rejection: this is the part
    // that lets the pipeline keep going and evaluate stature/tracking.
    const phase = phaseOf(outcome)
    expect(phase.landingFrame).toBeGreaterThan(phase.takeoffFrame)
  })

  it('accepts an airborne run just under the limit', () => {
    const stand = Array.from({ length: 40 }, () => 100)
    const air = Array.from({ length: 80 }, () => 60) // 1.33 s
    expect(findFlightPhase(track([...stand, ...air, ...stand])).kind).toBe('found')
  })

  it('places takeoff between the last contact frame and the first airborne one', () => {
    const phase = phaseOf(findFlightPhase(track([100, 100, 80, 60, 80, 100, 100])))
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
        const phase = phaseOf(findFlightPhase(buildComTrack(clip.frames, { width: 720, height: 1280 })))
        expect(Math.abs(phase.takeoffTime - clip.truth.takeoffTime)).toBeLessThan(1 / (3 * fps))
        expect(Math.abs(phase.landingTime - clip.truth.landingTime)).toBeLessThan(1 / (3 * fps))
      }
    }
  })

  it('survives a flight phase that starts on the very first frame', () => {
    const phase = phaseOf(findFlightPhase(track([60, 60, 60, 100, 100])))
    expect(phase.takeoffFrame).toBe(0)
    expect(phase.takeoffTime).toBe(0)
  })

  it('extension reaches but never crosses the array boundary on either edge', () => {
    // Takeoff edge: frame 0 sits exactly on the line fitted through frames
    // 1-4 (a perfectly linear synthetic descent), so it is a legitimate
    // reclassification target. The coarse run starts at frame 1; extension
    // should walk it down to frame 0 and stop there — never attempting a
    // frame -1. A frontier off by one in the restrictive direction (e.g. 0
    // instead of -1) would refuse the reclassification and leave
    // takeoffFrame at 1 instead of 0.
    const leadingPhase = phaseOf(findFlightPhase(
      track([92, 79, 66, 53, 40, 100, 100])
    ))
    expect(leadingPhase.takeoffFrame).toBe(0)
    expect(leadingPhase.takeoffTime).toBe(0)

    // Landing edge: frame 5 is the array's last frame and sits exactly on
    // the line fitted through frames 1-4, so it looks reclaimable too — but
    // there is no frame after it to serve as the reported landingFrame. The
    // frontier must refuse to consume it. A frontier off by one in the
    // permissive direction (times.length instead of times.length - 1) would
    // let it through, pushing landingFrame to an out-of-bounds 6 and
    // landingTime to NaN.
    const trailingPhase = phaseOf(findFlightPhase(
      track([100, 40, 53, 66, 79, 92])
    ))
    expect(trailingPhase.landingFrame).toBeLessThan(6)
    expect(Number.isFinite(trailingPhase.landingTime)).toBe(true)
  })
})
