import { describe, it, expect } from 'vitest'
import { guessFlightWindow } from './comSlope'
import { buildComTrack } from './comTrack'
import { REAL_CLIP_FRAMES, REAL_CLIP_VIDEO } from './testing/realClipFixture'
import type { ComTrack } from './comTrack'

/** A hand-built track: comY only matters here, footY/staturePx are unused by guessFlightWindow. */
function track(comY: number[], fps = 60): ComTrack {
  return {
    times: comY.map((_, i) => i / fps),
    comY,
    footY: comY.map(() => 0),
    staturePx: 500,
    spans: comY.map(() => 450),
  }
}

describe('guessFlightWindow', () => {
  it('finds a clean rise then fall', () => {
    const stand = Array.from({ length: 30 }, () => 1000)
    const rise = [1000, 940, 860, 760, 660]
    const flight = Array.from({ length: 15 }, () => 660)
    const fall = [660, 760, 860, 940, 1000]
    const land = Array.from({ length: 30 }, () => 1000)
    const guess = guessFlightWindow(track([...stand, ...rise, ...flight, ...fall, ...land]))
    expect(guess).not.toBeNull()
    // 60fps: frame index = time * 60. Takeoff lands inside the rise block
    // (index 30-34). Landing is the single steepest positive slope after
    // takeoff, which the smoothing window's central difference places near
    // the middle of the fall block (index 50-54), not its first sample --
    // empirically index 52, confirmed by running guessFlightWindow directly
    // against this fixture.
    expect(Math.round(guess!.takeoffTime * 60)).toBe(31)
    expect(Math.round(guess!.landingTime * 60)).toBe(52)
  })

  it('returns null on a flat clip with only landmark-noise-scale wobble', () => {
    // +/-2px wobble against comY~1000 -- far below any real jump's
    // displacement, but still nonzero. Without an absolute sharpness floor,
    // the search would still return the least-flat point in this noise as
    // a "candidate", which is wrong.
    const flat = Array.from({ length: 60 }, (_, i) => 1000 + (i % 3))
    expect(guessFlightWindow(track(flat))).toBeNull()
  })

  it('returns null when the track is too short to compute a slope', () => {
    expect(guessFlightWindow(track([1000]))).toBeNull()
    expect(guessFlightWindow(track([]))).toBeNull()
  })

  it('picks the sharper of two rises in the same clip', () => {
    const stand = Array.from({ length: 20 }, () => 1000)
    const smallRise = [1000, 980, 960]
    const smallFlight = Array.from({ length: 10 }, () => 960)
    const smallFall = [960, 980, 1000]
    const mid = Array.from({ length: 20 }, () => 1000)
    const bigRise = [1000, 900, 800, 700]
    const bigFlight = Array.from({ length: 10 }, () => 700)
    const bigFall = [700, 800, 900, 1000]
    const end = Array.from({ length: 20 }, () => 1000)
    const guess = guessFlightWindow(
      track([...stand, ...smallRise, ...smallFlight, ...smallFall, ...mid, ...bigRise, ...bigFlight, ...bigFall, ...end])
    )
    expect(guess).not.toBeNull()
    // The big rise block starts at index 56 (20+3+10+3+20). The small rise
    // must NOT win even though it comes first. Landing is the steepest
    // positive slope after takeoff, which -- same reasoning as the previous
    // test -- lands near the middle of the big fall block, not its first
    // sample: empirically index 71, confirmed by running guessFlightWindow
    // directly against this fixture.
    expect(Math.round(guess!.takeoffTime * 60)).toBe(56)
    expect(Math.round(guess!.landingTime * 60)).toBe(71)
  })

  it('finds a short flight window on the real clip that motivated this feature', () => {
    // No known ground truth for this clip (same caveat as
    // realClipFixture.test.ts). The < 1.5s bound below is a STRUCTURAL
    // sanity check, not a plausibility claim -- a flight that long would,
    // via this app's own h = g*t^2/8 formula, imply a ~115cm jump, which is
    // not plausible for this clip. It is also not a claim that this window
    // even IS the real jump: section 10 of
    // docs/2026-08-05-com-slope-marker-guess-design.md documents a known
    // limitation where, on this exact clip, the whole-body COM slope locks
    // onto a sharp ball-release arm motion near the end of the clip rather
    // than the jump itself (arm slope -5.25 outranks the jump's own -3.10).
    // What this assertion actually guards against is regression to the OLD
    // floor-threshold approach's failure mode: it found a ~2+ second window
    // on this exact data (run-up included, see the running-approach-jump
    // design doc) -- the bug that motivated this feature in the first
    // place. A short window here, even the wrong short window, is still
    // strictly better than that.
    const guess = guessFlightWindow(buildComTrack(REAL_CLIP_FRAMES, REAL_CLIP_VIDEO))
    expect(guess).not.toBeNull()
    expect(guess!.landingTime - guess!.takeoffTime).toBeLessThan(1.5)
  })
})
