import { centreOfMass } from './bodyModel'
import { FOOT_LANDMARKS, LM, type PoseFrame, type VideoSize } from './poseTypes'

export interface ComTrack {
  /** Frame presentation times, seconds. */
  times: number[]
  /** Body centre of mass, vertical pixels, y down. */
  comY: number[]
  /** Lowest point of either foot, vertical pixels, y down. */
  footY: number[]
  /** Standing height in pixels, used to normalize thresholds by the person. */
  staturePx: number
}

/** Where the nose sits as a fraction of stature. Approximate on purpose. */
const NOSE_HEIGHT_FRACTION = 0.9

/**
 * Which percentile of (foot - nose) counts as "standing upright". The person
 * is tallest fully extended; a plain maximum would latch onto a noise spike.
 */
const STANDING_PERCENTILE = 0.9

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[index]!
}

export function buildComTrack(frames: PoseFrame[], video: VideoSize): ComTrack {
  const times: number[] = []
  const comY: number[] = []
  const footY: number[] = []
  const spans: number[] = []

  for (const frame of frames) {
    times.push(frame.time)
    comY.push(centreOfMass(frame.landmarks).y * video.height)

    let lowest = -Infinity
    for (const index of FOOT_LANDMARKS) {
      const y = frame.landmarks[index]!.y * video.height
      if (y > lowest) lowest = y
    }
    footY.push(lowest)

    spans.push(lowest - frame.landmarks[LM.NOSE]!.y * video.height)
  }

  spans.sort((a, b) => a - b)
  const staturePx = frames.length === 0
    ? 0
    : percentile(spans, STANDING_PERCENTILE) / NOSE_HEIGHT_FRACTION

  return { times, comY, footY, staturePx }
}
