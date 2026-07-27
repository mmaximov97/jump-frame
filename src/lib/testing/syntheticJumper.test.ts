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
    // floors and footY are normalized (0..1) coordinates, so the margin below
    // must be in the same units. The actual rise here is ~0.156 of frame
    // height, so 0.01 (1% of frame height) is a generous but real threshold.
    expect(footY(midAir.landmarks)).toBeLessThan(floors[0]! - 0.01)
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
    const tucked = generateJump({ ...BASE, tuckM: 0.25 })
    const at = (clip: ReturnType<typeof generateJump>, t: number) =>
      centreOfMass(clip.frames.find((f) => f.time >= t)!.landmarks).y
    const t = (plain.truth.takeoffTime + plain.truth.landingTime) / 2
    expect(at(tucked, t)).toBeCloseTo(at(plain, t), 9)
  })

  it('pulls the hip midpoint OFF that parabola when the legs tuck', () => {
    const plain = generateJump(BASE)
    const tucked = generateJump({ ...BASE, tuckM: 0.25 })
    const hipAt = (clip: ReturnType<typeof generateJump>, t: number) => {
      const f = clip.frames.find((x) => x.time >= t)!
      return (f.landmarks[23]!.y + f.landmarks[24]!.y) / 2
    }
    const t = (plain.truth.takeoffTime + plain.truth.landingTime) / 2
    expect(Math.abs(hipAt(tucked, t) - hipAt(plain, t))).toBeGreaterThan(0.01)
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
})
