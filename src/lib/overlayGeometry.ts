import { centreOfMass } from './bodyModel'
import { buildComTrack } from './comTrack'
import { EDGE_TRIM_FRAMES, type JumpAnalysis } from './jumpFromCom'
import { fitParabola } from './parabolaFit'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type Vec2, type VideoSize } from './poseTypes'

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

/** How many points the drawn parabola is sampled into. */
const CURVE_SAMPLES = 48

export interface FlightGeometry {
  /** Sampled com positions from takeoff to landing, normalized. */
  trail: Vec2[]
  /** Points along the fitted parabola, normalized, in time order. */
  curve: Vec2[]
  /** Normalized y of the com at the sub-frame takeoff instant. */
  takeoffY: number
  /** Normalized y of the fitted apex. */
  apexY: number
  /** Pixels per metre from the fit — the caller needs it to label a distance. */
  scalePxPerM: number
}

/** Value of the piecewise-linear function (times → values) at `t`. */
function interpolate(times: number[], values: number[], t: number): number {
  const last = times.length - 1
  if (last < 0) return 0
  if (t <= times[0]!) return values[0] ?? 0
  if (t >= times[last]!) return values[last] ?? 0

  for (let i = 1; i <= last; i++) {
    const t1 = times[i]!
    if (t1 < t) continue
    const t0 = times[i - 1]!
    const v0 = values[i - 1]
    const v1 = values[i]
    if (v0 === undefined || v1 === undefined) return v1 ?? v0 ?? 0
    const span = t1 - t0
    return span === 0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / span
  }
  return values[last] ?? 0
}

/**
 * Everything about the flight that gets drawn: the com's measured path, the
 * parabola fitted through it, and the two levels the height is measured
 * between.
 *
 * The flight boundaries are NOT recomputed — they come from `analysis`, which
 * the caller already has. Feeding the fit the same sample indices the analysis
 * used makes the drawn curve the same curve the number came from, rather than
 * a second opinion that happens to agree today.
 *
 * The frames are filtered by the same rule `buildComTrack` applies, because
 * `analysis.takeoffSampleIndex` indexes the TRACK, not `frames`. Skipping that
 * filter slides the trail out from under the parabola by however many frames
 * MediaPipe failed to find a pose in — silently, and only on the clips where
 * it happened.
 */
export function buildFlightGeometry(
  frames: PoseFrame[],
  video: VideoSize,
  analysis: JumpAnalysis
): FlightGeometry | null {
  if (!(video.height > 0)) return null

  const usable = frames.filter((frame) => frame.landmarks.length === LANDMARK_COUNT)
  if (usable.length === 0) return null

  const track = buildComTrack(frames, video)

  const from = analysis.takeoffSampleIndex + EDGE_TRIM_FRAMES
  const to = analysis.landingSampleIndex - EDGE_TRIM_FRAMES
  if (to - from < 3) return null

  const fit = fitParabola(track.times.slice(from, to), track.comY.slice(from, to))
  if (!fit) return null

  // comTrack carries only the vertical component; the horizontal one is
  // needed to lay the trail across the frame, and is cheap to recover.
  const comX = usable.map((frame) => centreOfMass(frame.landmarks).x)

  const trail: Vec2[] = []
  for (let i = analysis.takeoffSampleIndex; i <= analysis.landingSampleIndex; i++) {
    const y = track.comY[i]
    const x = comX[i]
    if (y === undefined || x === undefined) continue
    trail.push({ x, y: y / video.height })
  }

  const span = analysis.landingTime - analysis.takeoffTime
  const curve: Vec2[] = []
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = analysis.takeoffTime + (span * i) / (CURVE_SAMPLES - 1)
    const yPx = fit.c0 + fit.c1 * t + fit.c2 * t * t
    curve.push({ x: interpolate(track.times, comX, t), y: yPx / video.height })
  }

  const t0 = analysis.takeoffTime
  const takeoffYPx = fit.c0 + fit.c1 * t0 + fit.c2 * t0 * t0

  return {
    trail,
    curve,
    takeoffY: takeoffYPx / video.height,
    apexY: fit.yApex / video.height,
    scalePxPerM: fit.scalePxPerM,
  }
}
