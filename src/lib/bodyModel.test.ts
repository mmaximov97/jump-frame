import { describe, it, expect } from 'vitest'
import { SEGMENTS, centreOfMass } from './bodyModel'
import { LM, LANDMARK_COUNT, type Landmark } from './poseTypes'

/** All landmarks at the origin, then override the listed indices. */
function pose(overrides: Record<number, Landmark> = {}): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }))
  for (const [index, value] of Object.entries(overrides)) {
    landmarks[Number(index)] = value
  }
  return landmarks
}

describe('SEGMENTS', () => {
  it('accounts for exactly the whole body mass', () => {
    const total = SEGMENTS.reduce((sum, s) => sum + s.mass, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('keeps every com ratio inside the segment', () => {
    for (const s of SEGMENTS) {
      expect(s.comRatio).toBeGreaterThanOrEqual(0)
      expect(s.comRatio).toBeLessThanOrEqual(1)
    }
  })
})

describe('centreOfMass', () => {
  it('collapses to the common point when the whole body is at one place', () => {
    const com = centreOfMass(pose({ ...Object.fromEntries(
      Array.from({ length: LANDMARK_COUNT }, (_, i) => [i, { x: 0.5, y: 0.5 }])
    ) }))
    expect(com.x).toBeCloseTo(0.5, 10)
    expect(com.y).toBeCloseTo(0.5, 10)
  })

  // Head+neck is the only segment touching the nose, its comRatio is 1.0, and
  // its mass is 0.081 — so moving the nose alone moves the body com by 8.1%.
  it('moves by the head mass fraction when only the nose moves', () => {
    const com = centreOfMass(pose({ [LM.NOSE]: { x: 0, y: 1 } }))
    expect(com.y).toBeCloseTo(0.081, 10)
  })

  // Left shank: 25 -> 27, ratio 0.433, mass 0.0465  => 0.433 * 0.0465
  // Left foot:  27 -> 31, ratio 0.500, mass 0.0145  => 1.000 * 0.0145
  it('applies the com ratio along a segment', () => {
    const com = centreOfMass(pose({
      [LM.LEFT_ANKLE]: { x: 0, y: 1 },
      [LM.LEFT_FOOT_INDEX]: { x: 0, y: 1 },
    }))
    expect(com.y).toBeCloseTo(0.433 * 0.0465 + 0.0145, 10)
  })

  // Both shoulders at y=1 drive three segments:
  //   trunk       mid(11,12)->mid(23,24), ratio 0.5,   mass 0.497 => 0.5   * 0.497
  //   upper arms  11->13 and 12->14,      ratio 0.436, mass 0.028 => 0.564 * 0.028 each
  //   head        mid(11,12)->nose,       ratio 1.0                => sits at the nose, y=0
  it('resolves midpoint anchors', () => {
    const com = centreOfMass(pose({
      [LM.LEFT_SHOULDER]: { x: 0, y: 1 },
      [LM.RIGHT_SHOULDER]: { x: 0, y: 1 },
    }))
    expect(com.y).toBeCloseTo(0.5 * 0.497 + 2 * (1 - 0.436) * 0.028, 10)
  })
})
