import { LM, type Landmark, type Vec2 } from './poseTypes'

/**
 * Where a segment end sits: a single landmark index, or the midpoint of two
 * (the trunk and head hang off the shoulder and hip midpoints, which are not
 * landmarks in their own right).
 */
export type Anchor = number | readonly [number, number]

export interface Segment {
  name: string
  proximal: Anchor
  distal: Anchor
  /** Fraction of total body mass. All masses sum to exactly 1. */
  mass: number
  /** Where this segment's own com sits along proximal -> distal, 0..1. */
  comRatio: number
}

/**
 * Dempster's segment mass fractions and com locations.
 *
 * Head+neck uses comRatio 1.0, placing the head's com exactly at the nose.
 * That is coarse — the real one sits higher — but a CONSTANT offset in the com
 * proxy cannot affect the result: jump height is a difference (takeoff minus
 * apex, so the constant cancels) and the px-per-metre scale comes from the
 * second derivative (immune to constants by definition). Only offsets that
 * CHANGE during flight matter, which is exactly why the limbs are modelled
 * segment by segment instead of using the hip midpoint as a proxy.
 */
export const SEGMENTS: readonly Segment[] = [
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
]

export function resolveAnchor(landmarks: Landmark[], anchor: Anchor): Vec2 {
  if (typeof anchor === 'number') {
    const p = landmarks[anchor]!
    return { x: p.x, y: p.y }
  }
  const a = landmarks[anchor[0]]!
  const b = landmarks[anchor[1]]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Segment-weighted centre of mass, in whatever units the landmarks use.
 *
 * In flight the true body com must follow a perfect parabola no matter what
 * the limbs do — that is the law this whole measurement rests on. The hip
 * midpoint does not: tuck the legs and their mass moves up toward the trunk,
 * so the hips must dip below the parabola to compensate.
 */
export function centreOfMass(landmarks: Landmark[]): Vec2 {
  let x = 0
  let y = 0
  for (const segment of SEGMENTS) {
    const p = resolveAnchor(landmarks, segment.proximal)
    const d = resolveAnchor(landmarks, segment.distal)
    x += segment.mass * (p.x + segment.comRatio * (d.x - p.x))
    y += segment.mass * (p.y + segment.comRatio * (d.y - p.y))
  }
  return { x, y }
}
