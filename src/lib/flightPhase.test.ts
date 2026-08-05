import { describe, it, expect } from 'vitest'
import { findFlightPhase, ROLLING_WINDOW_SECONDS } from './flightPhase'
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
    // A constant 450 makes percentile(spans, 0.9) / 0.9 work out to exactly
    // 500 -- the same staturePx these tests already hard-code -- so every
    // existing assertion keeps its original meaning unchanged.
    spans: footY.map(() => 450),
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

  it('never reclassifies a contact frame as airborne at the takeoff edge', () => {
    // This used to assert the opposite: extension walked the takeoff
    // boundary down onto frame 0 because frame 0 sat on the line fitted
    // through frames 1-4. On real footage that same reclassification pulled
    // in a frame the video shows still in contact — a foot rolling onto the
    // toes is moving, and so looks like it belongs on the flight line,
    // without being airborne. Extension no longer runs on this edge; the
    // takeoff boundary is whatever the local floor says it is.
    const phase = phaseOf(findFlightPhase(track([92, 79, 66, 53, 40, 100, 100])))
    // floorY is 100, threshold 10, so frame 0 (92, only 8 clear) is contact
    // and frame 1 (79) is the first airborne frame.
    expect(phase.takeoffFrame).toBe(1)
    expect(phase.takeoffTime).toBeGreaterThanOrEqual(0)
    expect(phase.takeoffTime).toBeLessThanOrEqual(1 / 60)
  })

  it('landing extension reaches but never crosses the array boundary', () => {
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

describe('findFlightPhase — rolling fallback when the athlete drifts from the camera', () => {
  const FPS = 30

  /**
   * A clip where the athlete moves steadily away from the camera (footY and
   * the nose-to-foot span both shrink) for 6s, then does a short, real jump
   * at the new distance, then lands and stays there -- footY never returns
   * to the original level. Against a single whole-clip floor (dominated by
   * the brief initial stretch near the camera), this whole drifting stretch
   * reads as one continuous "airborne" run that never comes back down
   * before the clip ends -- exactly what happened on the real clip that
   * motivated this fallback (see the running-approach-jump design doc).
   */
  function driftingClip(): ComTrack {
    const times: number[] = []
    const footY: number[] = []
    const spans: number[] = []
    const push = (t: number, foot: number, span: number) => {
      times.push(t)
      footY.push(foot)
      spans.push(span)
    }

    // 1s standing near the camera.
    for (let i = 0; i < FPS * 1; i++) push(i / FPS, 900, 800)

    // Drifting away, for comfortably longer than ROLLING_WINDOW_SECONDS --
    // wide enough that the window actually rolls across real variation
    // instead of seeing the whole drift as one span.
    const driftSeconds = ROLLING_WINDOW_SECONDS * 1.5
    const driftFrames = Math.round(FPS * driftSeconds)
    for (let i = 0; i < driftFrames; i++) {
      const t = FPS * 1 + i
      const progress = i / driftFrames
      push(t / FPS, 900 - progress * 500, 800 - progress * 450) // 900->400, 800->350
    }

    // A short, real jump at the new (arrived) distance.
    const jumpStartFrame = FPS * 1 + driftFrames
    for (let i = 0; i < Math.round(FPS * 0.3); i++) {
      push((jumpStartFrame + i) / FPS, 280, 350)
    }

    // Standing at the new distance -- never recovers the original footY.
    const afterFrame = jumpStartFrame + Math.round(FPS * 0.3)
    for (let i = 0; i < FPS * 2; i++) push((afterFrame + i) / FPS, 400, 350)

    return { times, comY: footY.map(() => 0), footY, staturePx: 800 / 0.9, spans }
  }

  it('recovers a short flight instead of landing-past-end', () => {
    const outcome = findFlightPhase(driftingClip())
    expect(outcome.kind === 'found' || outcome.kind === 'too-long').toBe(true)
  })

  it('places takeoff near the real jump, not wherever the drift itself started or ended', () => {
    const outcome = findFlightPhase(driftingClip())
    if (outcome.kind !== 'found' && outcome.kind !== 'too-long') {
      throw new Error(`expected a resolved phase, got '${outcome.kind}'`)
    }
    const jumpStartS = 1 + ROLLING_WINDOW_SECONDS * 1.5
    expect(outcome.phase.takeoffTime).toBeGreaterThan(jumpStartS - 0.5)
    expect(outcome.phase.takeoffTime).toBeLessThan(jumpStartS + 0.5)
  })

  it('reads the stature at the jump, not the near-camera stretch at the start', () => {
    const outcome = findFlightPhase(driftingClip())
    if (outcome.kind !== 'found' && outcome.kind !== 'too-long') {
      throw new Error(`expected a resolved phase, got '${outcome.kind}'`)
    }
    // The near-camera stature (800/0.9 ~= 889px) is what the OLD whole-clip
    // staturePx reports. The stature at the jump, where the athlete is
    // smaller in frame, must be noticeably less than that.
    expect(outcome.phase.staturePxAtJump).toBeLessThan(700)
  })

  it('does not engage the rolling fallback on an ordinary, non-drifting jump', () => {
    // Same shape as this file's existing "finds the boundaries" fixture --
    // pins that the fallback path is inert when the global pass already
    // succeeds, by checking the answer is unchanged from before this task.
    const outcome = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))
    if (outcome.kind !== 'found') throw new Error(`expected 'found', got '${outcome.kind}'`)
    expect(outcome.phase.takeoffFrame).toBe(2)
    expect(outcome.phase.landingFrame).toBe(5)
  })
})

describe('findFlightPhase — boundary-extension walk is capped', () => {
  /**
   * Engineered so the GLOBAL 90th-percentile floor and the LOCAL median
   * floor used for takeoff-edge refinement disagree about an 11-frame
   * block right before the coarse takeoff boundary -- mirrors the gait
   * oscillation a real running approach produces (see the
   * running-approach-jump design doc's real-clip investigation): the foot
   * leaves the ground a little on every stride, well before the actual
   * jump.
   *
   * - A/L (130 @ 82 each): the bulk of the clip, sets the global floorY to
   *   82.
   * - B (24 @ 100), indices 130-153: a clean "standing" stretch placed so
   *   it backfills most of the takeoff edge's local floor window.
   * - D (11 @ 76), indices 154-164: the "gait" block. 82-76=6 does not
   *   clear the global threshold (10), so longestRun never absorbs it --
   *   but 100-76=24 clears the LOCAL takeoff floor's threshold, so each of
   *   these 11 frames looks elevated once judged against the local
   *   standing level instead of the global one.
   * - F (10 @ 20), indices 165-174: the real flight -- 82-20=62 clears the
   *   global threshold easily, so this is the only run longestRun finds:
   *   coarseTakeoff = 165, coarseLanding = 175.
   *
   * Percentile math is nearest-rank, not interpolated (see stats.ts), so
   * both cluster sizes here are chosen to keep the 90th-percentile global
   * floor and the median local floor landing on the intended clusters with
   * real margin, not by a hair -- shrinking A/L, growing B, or growing D
   * changes which cluster either percentile lands on and silently breaks
   * the fixture.
   */
  function gaitOscillationTrack(): ComTrack {
    const A = Array.from({ length: 130 }, () => 82)
    const B = Array.from({ length: 24 }, () => 100) // indices 130-153
    const D = Array.from({ length: 11 }, () => 76) // indices 154-164 (reclaimable)
    const F = Array.from({ length: 10 }, () => 20) // indices 165-174 (flight)
    const L = Array.from({ length: 130 }, () => 82)
    return track([...A, ...B, ...D, ...F, ...L])
  }

  it('reclaims at most one frame of gait oscillation into the flight, not the whole run-up', () => {
    const phase = phaseOf(findFlightPhase(gaitOscillationTrack()))
    // coarseTakeoff is 165 (the start of block F). The capped walk may
    // reclaim at most 1 frame into block D (164) -- not all 11 frames of
    // it (154), which is what the pre-fix unbounded loop did on this same
    // fixture.
    expect(phase.takeoffFrame).toBe(164)
  })
})
