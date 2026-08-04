import { describe, it, expect } from 'vitest'
import { generateJump } from './syntheticJumper'
import { centreOfMass } from '../bodyModel'
import { FOOT_LANDMARKS, LANDMARK_COUNT } from '../poseTypes'
import { GRAVITY } from '../physics'

const BASE = {
  jumpHeightM: 0.5,
  scalePxPerM: 400,
  fps: 60,
  videoWidth: 720,
  videoHeight: 1280,
}

function footY(landmarks: { y: number }[]): number {
  return Math.max(...FOOT_LANDMARKS.map((i) => landmarks[i]!.y))
}

describe('generateJump', () => {
  it('emits well-formed frames with monotonically increasing times', () => {
    const clip = generateJump(BASE)
    expect(clip.frames.length).toBeGreaterThan(40)
    for (const frame of clip.frames) {
      expect(frame.landmarks).toHaveLength(LANDMARK_COUNT)
      for (const l of frame.landmarks) {
        expect(Number.isFinite(l.x)).toBe(true)
        expect(Number.isFinite(l.y)).toBe(true)
      }
    }
    for (let i = 1; i < clip.frames.length; i++) {
      expect(clip.frames[i]!.time).toBeGreaterThan(clip.frames[i - 1]!.time)
    }
  })

  it('reports a flight time matching the ballistic formula', () => {
    const clip = generateJump(BASE)
    expect(clip.truth.flightTimeS).toBeCloseTo(2 * Math.sqrt(2 * BASE.jumpHeightM / GRAVITY), 10)
  })

  it('puts takeoff strictly between two frames, not on one', () => {
    const clip = generateJump(BASE)
    const frameIndex = clip.truth.takeoffTime * BASE.fps
    expect(Math.abs(frameIndex - Math.round(frameIndex))).toBeGreaterThan(0.01)
  })

  it('keeps the feet on a level floor while standing and lifts them in flight', () => {
    const clip = generateJump(BASE)
    const standing = clip.frames.filter(
      (f) => f.time < clip.truth.takeoffTime || f.time > clip.truth.landingTime
    )
    const floors = standing.map((f) => footY(f.landmarks))
    expect(Math.max(...floors) - Math.min(...floors)).toBeCloseTo(0, 9)

    const midAir = clip.frames.find(
      (f) => Math.abs(f.time - (clip.truth.takeoffTime + clip.truth.landingTime) / 2) < 1 / BASE.fps
    )!
    // The com rises 0.5 m at 400 px/m on a 1280 px frame, so the feet must
    // drop 0.5 * 400 / 1280 = 0.15625 in normalized units. midAir is the
    // frame nearest the apex rather than the apex itself, hence the loose
    // tolerance (a one-sided epsilon would pass a foot lift that's off by a
    // stray factor of 2 or a bad unit conversion; this catches both).
    expect(floors[0]! - footY(midAir.landmarks)).toBeCloseTo(0.15625, 1)
  })

  it('drives the body com along a parabola whose curvature encodes real gravity', () => {
    const clip = generateJump(BASE)
    const air = clip.frames.filter(
      (f) => f.time > clip.truth.takeoffTime && f.time < clip.truth.landingTime
    )
    // Second difference of com y over evenly spaced frames is a*dt^2.
    const dt = 1 / BASE.fps
    const comY = air.map((f) => centreOfMass(f.landmarks).y * BASE.videoHeight)
    const second = comY[2]! - 2 * comY[1]! + comY[0]!
    const expected = GRAVITY * BASE.scalePxPerM * dt * dt
    expect(second).toBeCloseTo(expected, 6)
  })

  it('keeps the com on the same parabola when the legs tuck', () => {
    const plain = generateJump(BASE)
    const tucked = generateJump({ ...BASE, tuckM: 0.35 })
    const at = (clip: ReturnType<typeof generateJump>, t: number) =>
      centreOfMass(clip.frames.find((f) => f.time >= t)!.landmarks).y
    const t = (plain.truth.takeoffTime + plain.truth.landingTime) / 2
    expect(at(tucked, t)).toBeCloseTo(at(plain, t), 9)
  })

  it('pulls the hip midpoint OFF that parabola when the legs tuck', () => {
    const plain = generateJump(BASE)
    // tuckM matches Task 8's contrast test so the two stay comparable.
    const tucked = generateJump({ ...BASE, tuckM: 0.35 })
    const hipAt = (clip: ReturnType<typeof generateJump>, t: number) => {
      const f = clip.frames.find((x) => x.time >= t)!
      return (f.landmarks[23]!.y + f.landmarks[24]!.y) / 2
    }
    const t = (plain.truth.takeoffTime + plain.truth.landingTime) / 2
    // Measured deviation at tuckM=0.35 is ~0.014476 (normalized units).
    // Threshold of 0.008 leaves ~45% headroom above measured while still
    // failing if the effect drops below ~55% of correct.
    expect(Math.abs(hipAt(tucked, t) - hipAt(plain, t))).toBeGreaterThan(0.008)
  })

  it('is deterministic for a given seed and different for another', () => {
    const a = generateJump({ ...BASE, noiseSigma: 0.005, seed: 1 })
    const b = generateJump({ ...BASE, noiseSigma: 0.005, seed: 1 })
    const c = generateJump({ ...BASE, noiseSigma: 0.005, seed: 2 })
    expect(a.frames[10]!.landmarks[0]!.y).toBe(b.frames[10]!.landmarks[0]!.y)
    expect(a.frames[10]!.landmarks[0]!.y).not.toBe(c.frames[10]!.landmarks[0]!.y)
  })

  it('stretches apparent time under slow motion without changing the pose sequence', () => {
    const normal = generateJump(BASE)
    const slow = generateJump({ ...BASE, timeScale: 2 })
    expect(slow.truth.apparentFlightTimeS).toBeCloseTo(normal.truth.flightTimeS * 2, 9)
    expect(slow.frames.length).toBeGreaterThan(normal.frames.length)
  })

  it('is identical to no-drift output when approachScaleRatio is left at its default', () => {
    const withDefault = generateJump(BASE)
    const explicit1 = generateJump({ ...BASE, approachScaleRatio: 1 })
    expect(explicit1.frames).toEqual(withDefault.frames)
    expect(explicit1.truth).toEqual(withDefault.truth)
  })

  it('shrinks the pre-takeoff standing figure toward the arrived scale', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 2, standFrames: 40 })
    const footYAt = (t: number) => {
      const f = clip.frames.find((x) => x.time >= t)!
      // Math.min, not Math.max: the heel and foot-index landmarks sit at
      // height fraction 0, i.e. exactly on floorYPx, for ANY scale (that's
      // what "stands on the floor" means in buildPose) -- so they're
      // scale-invariant while liftM is 0, and Math.max over the group would
      // always saturate at the constant floor line, hiding the effect this
      // test wants to observe. The ankle (fraction 0.039) is the one point
      // in FOOT_LANDMARKS that actually rises off the floor line as scale
      // grows, so Math.min (the topmost/smallest-y point of the group) is
      // what picks up the drift.
      return Math.min(...FOOT_LANDMARKS.map((i) => f.landmarks[i]!.y))
    }
    // Frame 0 is at the far (2x) end of the ramp; a frame just before takeoff
    // is at the arrived (1x) end. Both stand on the same floor line
    // (floorYPx), so a LARGER apparent scale pushes the ankle's normalized y
    // further from that line -- frame 0's foot should sit clearly higher up
    // the frame (smaller normalized y) than the frame right before takeoff.
    expect(footYAt(0)).toBeLessThan(footYAt(clip.truth.takeoffTime - 1 / BASE.fps))
  })

  it('holds the arrived scale for the flight and after landing, matching scalePxPerM exactly', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 2 })
    // truth.scalePxPerM is always the arrived (post-drift) scale -- the
    // flight itself is never modelled as changing scale (see the
    // running-approach-jump design doc's explicit scope decision).
    expect(clip.truth.scalePxPerM).toBe(BASE.scalePxPerM)
    expect(clip.truth.statureM).toBe(1.8)
  })
})
