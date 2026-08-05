import { rollingPercentile } from './stats'
import { NOSE_HEIGHT_FRACTION, STANDING_PERCENTILE, type ComTrack } from './comTrack'
import { ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS } from './flightPhase'

/**
 * A rough takeoff/landing guess to seed the manual markers with -- not a
 * measurement. Whoever calls this is expected to let the person correct it;
 * see docs/2026-08-05-com-slope-marker-guess-design.md section 3.3.
 */
export interface SlopeGuess {
  takeoffTime: number
  landingTime: number
}

/**
 * Half-width, in seconds, of the central-difference window used to smooth
 * the frame-to-frame comY slope. Frame-to-frame alone is too noisy --
 * landmark jitter between two adjacent frames can exceed a real jump's own
 * per-frame displacement. Starting value, not a measured optimum.
 */
const SLOPE_WINDOW_SECONDS = 0.1
/** Below this many samples in the smoothing window, the slope at that index is unusable. */
const MIN_SLOPE_WINDOW_POINTS = 3
/**
 * Below this many stature-fractions per second, even the single sharpest
 * slope in the clip is ordinary noise, not a jump -- without this floor,
 * a perfectly flat clip with only landmark jitter still returns SOME
 * candidate, because the search only ever compares slopes to each other,
 * never to an absolute "is this actually sharp" bar. Starting value, not a
 * measured optimum: a real countermovement jump's push-off displaces the
 * com several tenths of a stature over a few tenths of a second, an order
 * of magnitude above ordinary landmark jitter.
 */
const MIN_TAKEOFF_SLOPE = 0.3
/**
 * How large the landing's positive slope must be, relative to the
 * magnitude of the takeoff's negative slope, to count as the matching
 * landing rather than noise. Physically a landing impact is roughly as
 * abrupt as the push-off that started the flight, so this is relative to
 * the takeoff's own slope, not an independent absolute threshold. Starting
 * value, not a measured optimum.
 */
const LANDING_SLOPE_FRACTION = 0.5

/**
 * Scans the whole clip for the steepest normalized rise in centre of mass
 * (takeoff) and the next comparably steep fall after it (landing).
 * Normalized by a rolling stature estimate (the same rollingPercentile
 * machinery findFlightPhase's own rolling fallback uses) rather than a
 * fixed reference, so a clip where the athlete's distance to the camera
 * changes does not bias the comparison toward whichever part of the clip
 * happens to be closest to the camera.
 *
 * Deliberately does not know about MAX_FLIGHT_SECONDS, floor levels, or
 * plausibility checks -- those all belong to findFlightPhase/assess, which
 * this function's result never touches. See
 * docs/2026-08-05-com-slope-marker-guess-design.md section 3.3.
 */
export function guessFlightWindow(track: ComTrack): SlopeGuess | null {
  const { times, comY, spans } = track
  if (times.length < 2 || times.length !== comY.length || times.length !== spans.length) return null

  const staturePx = rollingPercentile(times, spans, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, STANDING_PERCENTILE)
    .map((span) => (span === null ? null : span / NOSE_HEIGHT_FRACTION))

  // Smoothed, normalized slope at each index: central difference over
  // SLOPE_WINDOW_SECONDS, in stature-fractions per second. comY grows
  // downward, so a negative slope is a real-world rise (jumping) and a
  // positive slope is a real-world fall (landing).
  const slope: (number | null)[] = times.map((t, i) => {
    let lo = i
    while (lo > 0 && t - times[lo - 1]! < SLOPE_WINDOW_SECONDS / 2) lo--
    let hi = i
    while (hi < times.length - 1 && times[hi + 1]! - t < SLOPE_WINDOW_SECONDS / 2) hi++
    if (hi - lo < MIN_SLOPE_WINDOW_POINTS - 1) return null
    const dt = times[hi]! - times[lo]!
    if (!(dt > 0)) return null
    const s = staturePx[i]
    if (s === null || !(s > 0)) return null
    return (comY[hi]! - comY[lo]!) / dt / s
  })

  let takeoffIndex = -1
  let takeoffSlope = 0
  for (let i = 0; i < slope.length; i++) {
    const v = slope[i]
    if (v !== null && v < takeoffSlope) {
      takeoffSlope = v
      takeoffIndex = i
    }
  }
  if (takeoffIndex === -1 || -takeoffSlope < MIN_TAKEOFF_SLOPE) return null

  const landingThreshold = -takeoffSlope * LANDING_SLOPE_FRACTION
  let landingIndex = -1
  for (let i = takeoffIndex + 1; i < slope.length; i++) {
    const v = slope[i]
    if (v !== null && v > landingThreshold) {
      landingIndex = i
      break
    }
  }
  if (landingIndex === -1) return null

  return { takeoffTime: times[takeoffIndex]!, landingTime: times[landingIndex]! }
}
