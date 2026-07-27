import type { ComTrack } from './comTrack'

export interface FlightPhase {
  /**
   * The sub-frame-corrected takeoff boundary frame. This is usually, but not
   * always, the first frame the coarse AIRBORNE_THRESHOLD_FRACTION test
   * calls airborne — reclassification (see extendBoundary) can pull it one
   * frame earlier (MAX_BOUNDARY_EXTENSION) when the threshold itself lagged
   * the true takeoff. The one guarantee callers can rely on is
   * `takeoffTime ∈ [times[takeoffFrame - 1], times[takeoffFrame]]` (or
   * `takeoffTime === times[0]` when `takeoffFrame === 0`) — not that
   * `floorY - footY[takeoffFrame] > threshold`.
   */
  takeoffFrame: number
  /**
   * The sub-frame-corrected landing boundary frame. Symmetric to
   * `takeoffFrame`: usually the first frame back below the coarse threshold
   * after the airborne run, but reclassification can push it one frame
   * later. Guarantee: `landingTime ∈ [times[landingFrame - 1],
   * times[landingFrame]]`.
   */
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
 * reclassification. This is a backstop on how far the walk may reach, not
 * the thing that makes reclassification safe — closerToLineThanFloor's
 * clearance guard is what actually stops it from ever pulling in a genuine
 * contact frame (this cap alone does not: measured swallow and RMS numbers
 * were identical between caps of 1, 2, 3 and 5 before that guard existed).
 * With the guard in place, measured across 1200-clip sweeps at
 * σ ∈ {0.001, 0.002, 0.004}: a cap of 1 tied a cap of 2 exactly wherever the
 * second iteration never fired (σ ≤ 0.001), and strictly beat it wherever it
 * did (σ = 0.002, 0.004 — lower RMS and fewer swallowed contact frames both
 * times, because the second reclamation is fit from a shorter, noisier
 * lever arm than the first). No case measured favoured 2 over 1, so the cap
 * is 1: reclaim at most one frame per edge.
 */
const MAX_BOUNDARY_EXTENSION = 1

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
 *
 * The line-vs-floor comparison alone is not sufficient: solved for `y`, it
 * accepts any clearance above zero once the fitted line's own clearance
 * shrinks near the crossing (approaching takeoff/landing, "half the fitted
 * gap" tends to zero), and it does not require `y` to be above the floor at
 * all when the line's prediction sits below the floor. floorY is only the
 * 90th percentile of footY, so roughly a tenth of genuinely standing frames
 * sit below it by construction — exactly the frames this predicate must
 * never reclaim. The clearance guard below is a hard, non-negotiable floor
 * on real displacement, independent of the line fit, before the
 * closer-to-line-than-floor comparison is even considered.
 */
function closerToLineThanFloor(
  y: number, floorY: number, line: { a: number; b: number }, t: number, threshold: number
): boolean {
  if (!(floorY - y > 0.25 * threshold)) return false
  const predicted = line.a + line.b * t
  return Math.abs(y - predicted) < Math.abs(y - floorY)
}

/**
 * Extends a run of airborne indices one frame at a time — backwards
 * (direction -1, the takeoff edge) or forwards (direction +1, the landing
 * edge) — while the next candidate frame is closer to the fitted flight line
 * than to the floor (see closerToLineThanFloor's clearance guard). `frontier`
 * bounds how far the candidate may reach: for the takeoff edge it's -1
 * (frame 0 is the lowest legal index); for the landing edge it's
 * `times.length - 1` (a landing needs a contact frame after the reclaimed
 * run, so the candidate itself must stay short of the last index).
 */
function extendBoundary(
  times: number[], footY: number[], floorY: number, threshold: number,
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
    if (!closerToLineThanFloor(footY[candidate]!, floorY, line, times[candidate]!, threshold)) break
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
  const leadingExtended = extendBoundary(times, footY, floorY, threshold, leading, -1, -1)
  const trailingExtended = extendBoundary(times, footY, floorY, threshold, trailing, 1, times.length - 1)

  const finalTakeoffFrame = leadingExtended[0]!
  const finalLandingFrame = trailingExtended[trailingExtended.length - 1]! + 1

  // Extension only ever pulls the takeoff boundary earlier and/or the
  // landing boundary later, so it can only grow the reported duration
  // relative to the coarse pre-extension run. MAX_FLIGHT_SECONDS must
  // therefore be re-checked against what is actually reported: a coarse run
  // measured just under the cap can be extended past it.
  const finalDuration = times[finalLandingFrame]! - times[finalTakeoffFrame]!
  if (finalDuration > MAX_FLIGHT_SECONDS) return null

  // finalTakeoffFrame can reach 0 two different ways: the coarse run
  // genuinely started on the clip's first frame (nothing to extrapolate
  // from), or extension walked a reclaimed boundary all the way down to 0.
  // Either way there is no frame -1 to fit a contact anchor from, so the
  // sub-frame estimate is discarded in favour of times[0] — a wrongly
  // reclaimed frame 0 therefore costs a full frame of precision, not a
  // fraction of one.
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
