import type { ComTrack } from './comTrack'

export interface FlightPhase {
  /** First airborne frame. */
  takeoffFrame: number
  /** First frame back in contact after the airborne run. */
  landingFrame: number
  /** Sub-frame takeoff instant, seconds. */
  takeoffTime: number
  /** Sub-frame landing instant, seconds. */
  landingTime: number
  floorY: number
}

/** The foot is on the ground most of the clip, so a high percentile is the floor. */
const FLOOR_PERCENTILE = 0.9
/** Airborne once the foot clears this fraction of the person's own height. */
const AIRBORNE_THRESHOLD_FRACTION = 0.02
/** Nobody stays in the air this long; a longer run is not a jump. */
const MAX_FLIGHT_SECONDS = 1.5
/** How many airborne frames feed the sub-frame edge estimate. */
const EDGE_FIT_FRAMES = 4
/**
 * How many extra frames beyond the coarse threshold boundary get tested for
 * reclassification. AIRBORNE_THRESHOLD_FRACTION is sized against a typical
 * takeoff speed, so it costs roughly a frame's worth of real displacement
 * before a genuinely-airborne frame clears it — the boundary the threshold
 * finds can lag the true airborne/contact split by about a frame. Two frames
 * of headroom corrects that without reaching so far that a real contact
 * frame could ever be mistaken for flight.
 */
const MAX_BOUNDARY_EXTENSION = 2

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[index]!
}

/** Least-squares slope and intercept of y over t. Returns null if t never varies. */
function fitLine(t: number[], y: number[]): { a: number; b: number } | null {
  const n = t.length
  if (n < 2) return null
  const meanT = t.reduce((s, v) => s + v, 0) / n
  const meanY = y.reduce((s, v) => s + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (t[i]! - meanT) * (y[i]! - meanY)
    den += (t[i]! - meanT) ** 2
  }
  if (den === 0) return null
  const b = num / den
  return { a: meanY - b * meanT, b }
}

/**
 * Is this frame's foot height more consistent with sitting on the fitted
 * flight line than with sitting on the floor? Used to reclaim a boundary
 * frame that the coarse threshold missed — its displacement from the floor
 * was real but too small to clear AIRBORNE_THRESHOLD_FRACTION.
 */
function closerToLineThanFloor(
  y: number, floorY: number, line: { a: number; b: number }, t: number
): boolean {
  const predicted = line.a + line.b * t
  return Math.abs(y - predicted) < Math.abs(y - floorY)
}

/**
 * Extends a run of airborne indices one frame at a time — backwards
 * (direction -1, the takeoff edge) or forwards (direction +1, the landing
 * edge) — while the next candidate frame is closer to the fitted flight line
 * than to the floor. `frontier` bounds how far the candidate may reach: for
 * the takeoff edge it's -1 (frame 0 is the lowest legal index); for the
 * landing edge it's `times.length` (a landing needs a contact frame after
 * the reclaimed run, so the candidate itself must stay short of the last
 * index).
 */
function extendBoundary(
  times: number[], footY: number[], floorY: number,
  indices: number[], direction: -1 | 1, frontier: number
): number[] {
  let extended = indices
  for (let k = 0; k < MAX_BOUNDARY_EXTENSION; k++) {
    const candidate = direction === -1
      ? extended[0]! - 1
      : extended[extended.length - 1]! + 1
    if (direction === -1 ? candidate <= frontier : candidate >= frontier) break
    const line = fitLine(extended.map((i) => times[i]!), extended.map((i) => footY[i]!))
    if (!line) break
    if (!closerToLineThanFloor(footY[candidate]!, floorY, line, times[candidate]!)) break
    extended = direction === -1 ? [candidate, ...extended] : [...extended, candidate]
  }
  return extended
}

/**
 * When did the foot cross the floor?
 *
 * Fitted over airborne frames ONLY. The tempting two-point interpolation
 * through the last contact frame does not work: the foot is on the floor at
 * that frame by definition, so the line crosses the floor exactly there
 * whatever the speed — trading a half-frame-late bias for a half-frame-early
 * one. Extrapolating the airborne trajectory backwards has no such anchor.
 */
function crossingTime(
  times: number[], footY: number[], indices: number[], floorY: number, fallback: number,
  bounds: [number, number]
): number {
  const line = fitLine(indices.map((i) => times[i]!), indices.map((i) => footY[i]!))
  if (!line || line.b === 0) return fallback
  const t = (floorY - line.a) / line.b
  if (!Number.isFinite(t)) return fallback
  // Takeoff cannot precede the last contact frame, nor follow the first
  // airborne one. Clamping keeps a bad extrapolation physically possible.
  return Math.min(bounds[1], Math.max(bounds[0], t))
}

export function findFlightPhase(track: ComTrack): FlightPhase | null {
  const { times, footY, staturePx } = track
  if (footY.length === 0 || staturePx <= 0) return null

  const floorY = percentile(footY, FLOOR_PERCENTILE)
  const threshold = AIRBORNE_THRESHOLD_FRACTION * staturePx

  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let i = 0; i <= footY.length; i++) {
    const airborne = i < footY.length && floorY - footY[i]! > threshold
    if (airborne && start === -1) start = i
    if (!airborne && start !== -1) {
      if (i - start > bestLength) {
        bestLength = i - start
        bestStart = start
      }
      start = -1
    }
  }
  if (bestStart === -1) return null

  const takeoffFrame = bestStart
  const landingFrame = bestStart + bestLength
  if (landingFrame >= times.length) return null

  const duration = times[landingFrame]! - times[takeoffFrame]!
  if (duration > MAX_FLIGHT_SECONDS) return null

  const leading = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, bestLength) },
    (_, k) => takeoffFrame + k
  )
  const trailing = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, bestLength) },
    (_, k) => landingFrame - 1 - k
  ).reverse()

  // The coarse threshold can lag the true takeoff/landing split by about a
  // frame (see MAX_BOUNDARY_EXTENSION); reclaim any adjacent frame that is
  // actually part of the flight before fitting and clamping.
  const leadingExtended = extendBoundary(times, footY, floorY, leading, -1, -1)
  const trailingExtended = extendBoundary(times, footY, floorY, trailing, 1, times.length - 1)

  const finalTakeoffFrame = leadingExtended[0]!
  const finalLandingFrame = trailingExtended[trailingExtended.length - 1]! + 1

  const takeoffTime = finalTakeoffFrame === 0
    ? times[0]!
    : crossingTime(times, footY, leadingExtended, floorY, times[finalTakeoffFrame]!,
        [times[finalTakeoffFrame - 1]!, times[finalTakeoffFrame]!])

  const landingTime = crossingTime(times, footY, trailingExtended, floorY, times[finalLandingFrame]!,
    [times[finalLandingFrame - 1]!, times[finalLandingFrame]!])

  return {
    takeoffFrame: finalTakeoffFrame, landingFrame: finalLandingFrame,
    takeoffTime, landingTime, floorY,
  }
}
