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

  // Minor (final whole-branch review): none of the other tests in this file
  // pin the Dempster table's literal mass/comRatio VALUES — they pin
  // properties the table must have (sums to 1, ratios in range) and specific
  // consequences of specific values (e.g. "moving the nose alone moves the
  // com by 8.1%", which only re-derives the head's own mass). Verified by
  // mutation: changing forearm mass 0.016 -> 0.031 and thigh mass
  // 0.100 -> 0.085 in bodyModel.ts — preserving the sum at exactly 1.000, so
  // the "accounts for exactly the whole body mass" test above still passes —
  // leaves all 91 tests that existed before this fix passing (measured; see
  // the fix report). The generator that acceptance.test.ts's sweeps use
  // places every airborne pose BY COM using this same table (see
  // syntheticJumper.ts), so it is blind to a mutation here too: it would
  // simply place poses according to the mutated table and their com would
  // still land exactly on the fitted parabola by construction. This test is
  // what actually notices — it transcribes the values independently
  // (copied from the same published Dempster source used to write
  // bodyModel.ts, not derived from SEGMENTS itself) and fails on any change
  // to any cell, not just ones that break the sum or the range.
  it('pins the Dempster table to its literal reviewed values, not just its invariants', () => {
    expect(SEGMENTS).toEqual([
      { name: 'head+neck', proximal: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], distal: LM.NOSE, mass: 0.081, comRatio: 1.0 },
      { name: 'trunk', proximal: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], distal: [LM.LEFT_HIP, LM.RIGHT_HIP], mass: 0.497, comRatio: 0.5 },
      { name: 'upper arm L', proximal: LM.LEFT_SHOULDER, distal: LM.LEFT_ELBOW, mass: 0.028, comRatio: 0.436 },
      { name: 'upper arm R', proximal: LM.RIGHT_SHOULDER, distal: LM.RIGHT_ELBOW, mass: 0.028, comRatio: 0.436 },
      { name: 'forearm L', proximal: LM.LEFT_ELBOW, distal: LM.LEFT_WRIST, mass: 0.016, comRatio: 0.430 },
      { name: 'forearm R', proximal: LM.RIGHT_ELBOW, distal: LM.RIGHT_WRIST, mass: 0.016, comRatio: 0.430 },
      { name: 'hand L', proximal: LM.LEFT_WRIST, distal: LM.LEFT_INDEX, mass: 0.006, comRatio: 0.506 },
      { name: 'hand R', proximal: LM.RIGHT_WRIST, distal: LM.RIGHT_INDEX, mass: 0.006, comRatio: 0.506 },
      { name: 'thigh L', proximal: LM.LEFT_HIP, distal: LM.LEFT_KNEE, mass: 0.100, comRatio: 0.433 },
      { name: 'thigh R', proximal: LM.RIGHT_HIP, distal: LM.RIGHT_KNEE, mass: 0.100, comRatio: 0.433 },
      { name: 'shank L', proximal: LM.LEFT_KNEE, distal: LM.LEFT_ANKLE, mass: 0.0465, comRatio: 0.433 },
      { name: 'shank R', proximal: LM.RIGHT_KNEE, distal: LM.RIGHT_ANKLE, mass: 0.0465, comRatio: 0.433 },
      { name: 'foot L', proximal: LM.LEFT_ANKLE, distal: LM.LEFT_FOOT_INDEX, mass: 0.0145, comRatio: 0.5 },
      { name: 'foot R', proximal: LM.RIGHT_ANKLE, distal: LM.RIGHT_FOOT_INDEX, mass: 0.0145, comRatio: 0.5 },
    ])
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
