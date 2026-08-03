import { centreOfMass } from './bodyModel'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type Vec2 } from './poseTypes'

/**
 * Which landmark pairs are drawn as bones.
 *
 * MediaPipe reports 33 landmarks; this list covers the ones the project names
 * in `LM`, which is every landmark that carries meaning for a jump. The face
 * mesh (eyes, ears, mouth) is deliberately absent: it adds a dozen points
 * around the head that tell a viewer nothing about a jump and turn the head
 * into a blob at small sizes.
 *
 * The nose connects to both shoulders rather than to a neck point, because
 * MediaPipe has no neck landmark and a synthetic midpoint would be the only
 * drawn element not backed by a measurement.
 */
export const BONES: readonly (readonly [number, number])[] = [
  [LM.NOSE, LM.LEFT_SHOULDER],
  [LM.NOSE, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.LEFT_WRIST, LM.LEFT_INDEX],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.RIGHT_WRIST, LM.RIGHT_INDEX],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],
  [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
  [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
]

/** Every landmark some bone touches — the dots drawn on top of the lines. */
export const JOINTS: readonly number[] = (() => {
  const seen = new Set<number>()
  for (const [a, b] of BONES) {
    seen.add(a)
    seen.add(b)
  }
  return [...seen]
})()

export interface SkeletonGeometry {
  /** Bone endpoints, normalized, in the same order as {@link BONES}. */
  bones: { a: Vec2; b: Vec2 }[]
  /** Joint positions, normalized, in the same order as {@link JOINTS}. */
  joints: Vec2[]
  /** Body centre of mass for this frame, normalized. */
  com: Vec2
}

/**
 * Lays one pose out for drawing, or returns null if it is not a full pose.
 *
 * The null is not defensive padding: MediaPipe emits an empty landmark array
 * when it finds no one in the frame, and every index below assumes exactly
 * LANDMARK_COUNT entries.
 */
export function buildSkeleton(landmarks: Landmark[]): SkeletonGeometry | null {
  if (landmarks.length !== LANDMARK_COUNT) return null

  const bones = BONES.map(([from, to]) => ({
    a: { x: landmarks[from]!.x, y: landmarks[from]!.y },
    b: { x: landmarks[to]!.x, y: landmarks[to]!.y },
  }))
  const joints = JOINTS.map((index) => ({ x: landmarks[index]!.x, y: landmarks[index]!.y }))

  return { bones, joints, com: centreOfMass(landmarks) }
}

/**
 * The sampled pose nearest `time`, or null if none is closer than
 * `maxGapSeconds`.
 *
 * The gap is what makes the skeleton appear over the dense pass and nowhere
 * else, without anyone having to state where the dense pass ran. The coarse
 * pass samples every COARSE_STRIDE-th frame, so outside the flight window the
 * nearest pose is always several frames away and this returns null on its own.
 *
 * `frames` must be sorted by time — usePoseDetection sorts before publishing.
 */
export function findFrameAt(
  frames: PoseFrame[],
  time: number,
  maxGapSeconds: number
): PoseFrame | null {
  if (frames.length === 0) return null

  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (frames[mid]!.time < time) low = mid + 1
    else high = mid
  }

  let best = frames[low]!
  const previous = frames[low - 1]
  if (previous && Math.abs(previous.time - time) < Math.abs(best.time - time)) {
    best = previous
  }

  return Math.abs(best.time - time) <= maxGapSeconds ? best : null
}
