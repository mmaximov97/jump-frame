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

export interface QualityMetrics {
  rSquared: number
  flightFrames: number
  statureM: number
  comHeightCm: number
  flightTimeHeightCm: number
}

export type Verdict =
  | { kind: 'ok'; heightCm: number }
  | { kind: 'warn'; heightCm: number; message: string }
  | { kind: 'unusable'; message: string }

const MIN_FLIGHT_FRAMES = 8
const MIN_USABLE_R_SQUARED = 0.95
const MIN_CLEAN_R_SQUARED = 0.99
const MIN_STATURE_M = 1.3
const MAX_STATURE_M = 2.2
const MAX_METHOD_DISAGREEMENT = 0.2

/**
 * Decides what the user is shown: a number, a number with a caveat, or a
 * refusal. Checks run in order and the first one to fire wins.
 *
 * The cost of being wrong is asymmetric, and that asymmetry sets every
 * threshold here. Too strict and warnings fire on ordinary jumps until people
 * stop reading them. Too lax and someone publishes a height they never
 * reached — which is worse, because the app's credibility lasts exactly until
 * the first debunked result.
 */
export function assess(m: QualityMetrics): Verdict {
  if (!Number.isFinite(m.comHeightCm) || m.comHeightCm <= 0) {
    return { kind: 'unusable', message: 'Не удалось измерить прыжок по этому видео.' }
  }
  if (m.flightFrames < MIN_FLIGHT_FRAMES) {
    return { kind: 'unusable', message: 'Слишком короткий полёт для анализа.' }
  }
  if (m.rSquared < MIN_USABLE_R_SQUARED) {
    return { kind: 'unusable', message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.' }
  }
  // A scale error is always a factor of k squared, so at least fourfold. The
  // band is wide on purpose: it should never fire on a short teenager, only
  // on a timebase that is flatly wrong.
  if (m.statureM < MIN_STATURE_M || m.statureM > MAX_STATURE_M) {
    return { kind: 'unusable', message: 'Похоже, видео в замедленной съёмке — результат недостоверен.' }
  }
  if (m.rSquared < MIN_CLEAN_R_SQUARED) {
    return { kind: 'warn', heightCm: m.comHeightCm, message: 'Трекинг местами срывался — цифра приблизительная.' }
  }
  if (Math.abs(m.comHeightCm - m.flightTimeHeightCm) / m.comHeightCm > MAX_METHOD_DISAGREEMENT) {
    return { kind: 'warn', heightCm: m.comHeightCm, message: 'Поза на отрыве и приземлении заметно различаются.' }
  }
  return { kind: 'ok', heightCm: m.comHeightCm }
}

export function measureJump(
  frames: PoseFrame[], video: VideoSize
): { analysis: JumpAnalysis | null; verdict: Verdict } {
  const analysis = analyseJump(frames, video)
  if (!analysis) {
    return { analysis: null, verdict: { kind: 'unusable', message: 'Не нашли прыжок в этом видео.' } }
  }
  return { analysis, verdict: assess(analysis) }
}
