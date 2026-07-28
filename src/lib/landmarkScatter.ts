import { FOOT_LANDMARKS, LANDMARK_COUNT, type PoseFrame } from './poseTypes'

export interface LandmarkScatter {
  /** Standard deviation over all landmarks, in normalized units. */
  overall: number
  /** The same, restricted to the six foot landmarks. */
  feet: number
  /** How many frames the estimate was measured over. */
  frames: number
}

/** Shortest run of frames worth estimating a standard deviation from. */
const MIN_STILL_FRAMES = 20

/** How many candidate windows to try when hunting for the stillest stretch. */
const WINDOW_FRAMES = 30

function meanOf(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * How much a landmark position wobbles frame to frame while the athlete stands
 * still — MediaPipe's own measurement noise, with none of the subject's motion
 * mixed in.
 *
 * This is instrumentation, not part of measuring a jump. Several thresholds in
 * the analysis core were calibrated against an invented sigma of 0.005; this
 * function supplies the real one so those choices can be revisited against a
 * number rather than a guess.
 *
 * The stillest window is chosen by the smallest spread of the mid-hip point,
 * which moves with the body but not with a waving arm.
 */
export function estimateScatter(frames: PoseFrame[]): LandmarkScatter | null {
  const usable = frames.filter((f) => f.landmarks.length === LANDMARK_COUNT)
  if (usable.length < MIN_STILL_FRAMES) return null

  const window = Math.min(WINDOW_FRAMES, usable.length)
  let bestStart = 0
  let bestSpread = Infinity
  for (let start = 0; start + window <= usable.length; start++) {
    const slice = usable.slice(start, start + window)
    const hipY = slice.map((f) => (f.landmarks[23]!.y + f.landmarks[24]!.y) / 2)
    const spread = Math.max(...hipY) - Math.min(...hipY)
    if (spread < bestSpread) {
      bestSpread = spread
      bestStart = start
    }
  }

  const still = usable.slice(bestStart, bestStart + window)
  const footSet = new Set<number>(FOOT_LANDMARKS)
  const all: number[] = []
  const feet: number[] = []

  for (let index = 0; index < LANDMARK_COUNT; index++) {
    for (const axis of ['x', 'y'] as const) {
      const series = still.map((f) => f.landmarks[index]![axis])
      const sd = stdDev(series)
      all.push(sd)
      if (footSet.has(index)) feet.push(sd)
    }
  }

  return { overall: meanOf(all), feet: meanOf(feet), frames: still.length }
}
