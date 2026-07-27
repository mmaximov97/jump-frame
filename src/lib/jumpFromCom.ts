import { GRAVITY } from './physics'
import { buildComTrack } from './comTrack'
import { findFlightPhase } from './flightPhase'
import { fitParabola } from './parabolaFit'
import type { PoseFrame, VideoSize } from './poseTypes'

export interface JumpAnalysis {
  /** Rise of the centre of mass from takeoff to apex, centimetres. */
  comHeightCm: number
  /** What the flight-time formula would say about the same jump. */
  flightTimeHeightCm: number
  flightTimeSeconds: number
  /** The athlete's height in metres, solved from the fitted scale. */
  statureM: number
  scalePxPerM: number
  /** Deliberately conservative one-sigma estimate, centimetres. */
  errorCm: number
  rSquared: number
  /** Frames that actually fed the parabola fit. */
  flightFrames: number
  takeoffFrame: number
  landingFrame: number
}

/**
 * Frames dropped from each end of the airborne run before fitting. The edge
 * frames sit closest to contact and are the likeliest to carry motion blur or
 * a lingering trace of the foot still loaded.
 */
const EDGE_TRIM_FRAMES = 1

export function analyseJump(frames: PoseFrame[], video: VideoSize): JumpAnalysis | null {
  const track = buildComTrack(frames, video)
  const phase = findFlightPhase(track)
  if (!phase) return null

  const from = phase.takeoffFrame + EDGE_TRIM_FRAMES
  const to = phase.landingFrame - EDGE_TRIM_FRAMES
  if (to - from < 3) return null

  const fit = fitParabola(track.times.slice(from, to), track.comY.slice(from, to))
  if (!fit) return null

  const { takeoffTime, landingTime } = phase
  // Read the takeoff height off the FITTED curve, not the measured sample:
  // one sample carries a whole frame's noise, the curve averages it over the
  // twenty-odd frames of flight.
  const yTakeoff = fit.c0 + fit.c1 * takeoffTime + fit.c2 * takeoffTime * takeoffTime
  const riseM = (yTakeoff - fit.yApex) / fit.scalePxPerM

  const flightTimeSeconds = landingTime - takeoffTime
  const flightTimeHeightM = (GRAVITY * flightTimeSeconds * flightTimeSeconds) / 8

  return {
    comHeightCm: riseM * 100,
    flightTimeHeightCm: flightTimeHeightM * 100,
    flightTimeSeconds,
    statureM: track.staturePx / fit.scalePxPerM,
    scalePxPerM: fit.scalePxPerM,
    errorCm: ((2 * fit.rmsResidualPx) / Math.sqrt(fit.n) / fit.scalePxPerM) * 100,
    rSquared: fit.rSquared,
    flightFrames: fit.n,
    takeoffFrame: phase.takeoffFrame,
    landingFrame: phase.landingFrame,
  }
}
