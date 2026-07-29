import { percentile } from './stats'
import { fitParabola } from './parabolaFit'
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
}

/**
 * What findFlightPhase found, or why it found nothing usable.
 *
 * - 'found': a normal airborne run, at or under MAX_FLIGHT_SECONDS.
 * - 'too-long': a candidate airborne run WAS found and fully resolved
 *   (sub-frame takeoff/landing included) — but it lasted longer than any
 *   real human jump. Carries `phase` anyway, deliberately: the run being
 *   suspiciously long does not mean it should be thrown away unexamined.
 *   The two situations that produce this outcome — a saved slow-motion clip
 *   and a tracker that lost the athlete — are not distinguishable from
 *   duration alone, but they ARE distinguishable downstream, once the com
 *   fit and stature estimate exist: slow motion inflates the fitted stature
 *   by k² (see MAX_FLIGHT_SECONDS below) and a lost tracker tends to wreck
 *   rSquared. That downstream evaluation is jumpFromCom's job, not this
 *   module's — findFlightPhase only knows about foot trajectories and
 *   thresholds, not body proportions. See jumpFromCom.ts's `assess`.
 * - 'no-flight': no candidate airborne run exists at all — the track is
 *   empty or degenerate (no stature could be estimated), or the foot never
 *   cleared AIRBORNE_THRESHOLD_FRACTION anywhere in the clip.
 * - 'landing-past-end': an airborne run was found but the clip ends before
 *   the foot comes back down, so there is no landing to resolve. Kept
 *   distinct from 'no-flight': the user action is different (record a
 *   longer clip / keep recording through the landing) from "we never saw
 *   you leave the ground".
 */
export type FlightPhaseOutcome =
  | { kind: 'found'; phase: FlightPhase }
  | { kind: 'too-long'; phase: FlightPhase }
  | { kind: 'no-flight' }
  | { kind: 'landing-past-end' }

/** The foot is on the ground most of the clip, so a high percentile is the floor. */
const FLOOR_PERCENTILE = 0.9
/**
 * How many frames of standing to average when measuring the floor local to
 * one edge of the jump, and how many to skip next to the jump itself.
 *
 * The gap exists because the frames immediately before takeoff are a
 * countermovement dip and the ones right after landing are a settle — both
 * are off the standing level, in opposite directions.
 */
const FLOOR_WINDOW_FRAMES = 20
const FLOOR_WINDOW_GAP = 4
/** Below this many frames a window is too short to average; use the global floor. */
const MIN_FLOOR_WINDOW_FRAMES = 5
/**
 * How far before the first airborne frame a fitted takeoff may land and
 * still be believed. See the takeoff block in findFlightPhase.
 */
const TAKEOFF_LOOKBACK_FRAMES = 2
/** Airborne once the foot clears this fraction of the person's own height. */
const AIRBORNE_THRESHOLD_FRACTION = 0.02
/**
 * Nobody stays in the air this long; a longer run is not an ordinary jump —
 * but it is not thrown away either (see FlightPhaseOutcome's 'too-long').
 *
 * The two real causes of an over-long run are a saved slow-motion clip and a
 * tracker that lost the athlete, and this constant alone cannot tell them
 * apart. Slow motion is the one with a clean physical signature: stretching
 * time by a factor k leaves pixel positions unchanged but divides the
 * fitted (apparent) acceleration by k², so scalePxPerM — which is read
 * straight off that acceleration — is also divided by k², and statureM
 * (staturePx / scalePxPerM) comes out multiplied by k². A k as small as 2
 * already turns a 1.8 m athlete into an apparent 7.2 m one, comfortably
 * outside jumpFromCom's MIN/MAX_STATURE_M band. That is what makes it safe
 * to let a too-long run keep going through the fit instead of rejecting it
 * here: the stature check downstream almost always gives the more specific
 * "slow motion" diagnosis, and this constant remains as the last-resort
 * guard for the runs that check does not catch (see jumpFromCom.ts's
 * `assess`, the `tooLong` field on QualityMetrics).
 */
const MAX_FLIGHT_SECONDS = 1.5
/**
 * How many airborne frames the coarse threshold gathers for the sub-frame
 * edge estimate BEFORE extension — not how many frames the fit actually
 * sees. extendBoundary (see MAX_BOUNDARY_EXTENSION) can reclaim one more
 * frame at each edge first, so the crossing fit itself can run on up to
 * EDGE_FIT_FRAMES + MAX_BOUNDARY_EXTENSION frames. Measured directly: at fps
 * 60, takeoffPhase 0.5, the fit receives 5 frames, not 4. The sweep below
 * still measures this constant's effect on accuracy correctly — it exercises
 * the real pipeline, extension included — but any reasoning that treats
 * EDGE_FIT_FRAMES as "the frame count the fit sees" is off by however many
 * frames extension reclaimed on that particular run.
 *
 * Measured 3, 4, 5, and 6 with the quadratic crossing (see quadraticCrossing)
 * on the PR-B acceptance grid plus this module's own fps x takeoffPhase grid,
 * tracking landing as well as takeoff. Re-measured under the shipped
 * pipeline (footY as the median of six landmarks, not the old maximum —
 * the first version of this comment's numbers were measured before that
 * change and no longer reproduce):
 *   - 5 and 6 still REGRESS an already-passing test (`fps=30,
 *     takeoffPhase=0.8` landing error still measures 1.07x its own bar,
 *     unchanged by the footY fix since this is a noise-free comparison) — a
 *     longer window starts reaching past where the airborne run is still
 *     cleanly ballistic for a short flight, and are disqualified on that
 *     alone.
 *   - 3 and 4 both leave this module's grid comfortably passing, and TIE on
 *     the fps x takeoffPhase sweep's worst case (1.0386 cm at 30fps,
 *     takeoffPhase 0.1 for both — an unrelated extendBoundary artifact, not
 *     sensitive to this constant) and on the acceptance suite's exact 5
 *     noise seeds (both 2.7618 cm worst case). 3 is slightly better on the
 *     leg-tuck case (1.0421 cm vs 4's 1.2067 cm, both still over the 1 cm
 *     bar) and on the fraction of a wider 50-seed noise sweep landing under
 *     1 cm (32 of 50, 64%, vs 4's 28 of 50, 56%). 4 is the better choice on
 *     the noise sweep's mean (1.202 cm vs 3's 1.206 cm — a near-tie) and RMS
 *     (1.672 cm vs 3's 1.754 cm — a clearer win), the two statistics that
 *     weight the tail rather than just counting whether each draw clears an
 *     arbitrary 1cm line.
 * Kept at 4: not dominated by 3 on RMS, the criterion that best reflects
 * "how bad does a typical bad case get" for real footage, even though 3 now
 * wins on more of the individual comparisons than it used to.
 */
const EDGE_FIT_FRAMES = 4
/**
 * Fewer edge samples than this and a quadratic crossing is not attempted —
 * three points are the minimum that determine a parabola at all. Below the
 * minimum, or whenever the quadratic path declines (see quadraticCrossing),
 * crossingTime falls back to the two-point-minimum linear fit.
 */
const MIN_QUADRATIC_FIT_FRAMES = 3
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

/** Sign used by the stable quadratic solve below: +1 for b >= 0, else -1. */
function sign(x: number): number {
  return x < 0 ? -1 : 1
}

/**
 * Real roots of a*t^2 + b*t + c = 0, in unspecified order. Returns null for
 * a === 0 or a negative discriminant.
 *
 * Uses the numerically stable form (Numerical Recipes §5.6) rather than the
 * textbook (-b +/- sqrt(disc)) / 2a. Measured on this function's actual
 * inputs: both roots are O(1) seconds and roughly a flight's duration apart
 * (e.g. ~0.66s and ~1.30s in a typical clip), not one near zero and one far
 * away — fitParabola expands its coefficients back to absolute video time
 * before returning them, not a time centred near zero, so the catastrophic
 * cancellation the stable form exists to avoid does not actually arise here.
 * Measured difference from the textbook form on real inputs: <= 1.1e-16s,
 * i.e. floating-point noise, not evidence of a live precision problem. Kept
 * anyway as a correct-by-construction default: it costs nothing, and removes
 * the need to re-derive whether some future caller's inputs could bring the
 * two roots close enough together for the textbook form to matter.
 */
function quadraticRoots(a: number, b: number, c: number): [number, number] | null {
  if (a === 0) return null
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const sqrtD = Math.sqrt(discriminant)
  const q = -0.5 * (b + sign(b) * sqrtD)
  if (q === 0) {
    // b === 0 and discriminant === -4ac: roots are symmetric about zero.
    const root = Math.sqrt(-c / a)
    return [-root, root]
  }
  return [q / a, c / q]
}

/**
 * Quadratic crossing estimate: a foot in free flight is ballistic under the
 * same g as the body's com, so near takeoff/landing its trajectory is a
 * parabola, not a line. A chord across the sampled edge frames is measurably
 * SHALLOWER than the initial tangent (the true curve is concave), so
 * extrapolating that chord crosses the floor too early — this is the ~2.6 cm
 * bias PR-B's acceptance suite measured before this fix. Fitting the
 * curvature directly (reusing fitParabola from the com fit itself) removes
 * that bias instead of merely shrinking it.
 *
 * Returns null — meaning "fall back to the linear estimate" — when: the fit
 * is not ballistic (fitParabola rejects c2 <= 0, e.g. exactly-linear or noisy
 * data); the crossing has no real root; or neither root lands inside
 * `bounds`. That last case matters as much as the first two: an
 * extrapolation that misses the narrow window it is supposed to explain is
 * not more trustworthy for having come from a fancier model.
 *
 * `preferEarlier` selects which of two in-bounds roots to use in the
 * (unobserved so far — see below) case where both land inside `bounds`: the
 * one closer to `lo` for takeoff, closer to `hi` for landing. `bounds` alone
 * already does most of the work of picking "the correct side", since only
 * one root can plausibly land inside a window narrower than a single frame —
 * checked directly across 13,440 edge fits in this module's own test grids,
 * zero of which had both roots in bounds. `preferEarlier` exists for
 * correctness on inputs this suite has not sampled, not to fix an observed
 * bug.
 */
function quadraticCrossing(
  times: number[], footY: number[], indices: number[], floorY: number, bounds: [number, number],
  preferEarlier: boolean
): number | null {
  const fit = fitParabola(indices.map((i) => times[i]!), indices.map((i) => footY[i]!))
  if (!fit) return null
  const roots = quadraticRoots(fit.c2, fit.c1, fit.c0 - floorY)
  if (!roots) return null
  const [lo, hi] = bounds
  const inBounds = roots.filter((t) => Number.isFinite(t) && t >= lo && t <= hi)
  if (inBounds.length === 0) return null
  const anchor = preferEarlier ? lo : hi
  return inBounds.reduce((closest, t) => (Math.abs(t - anchor) < Math.abs(closest - anchor) ? t : closest))
}

/**
 * The linear crossing, returned only if it lands inside `bounds` — null
 * otherwise, rather than clamped onto the boundary.
 *
 * Clamping is what let a foot still on the ground be reported as airborne:
 * an extrapolation that misses its window by three frames is not evidence
 * about that window, and pinning it to the edge dresses a rejected estimate
 * up as a measurement. The caller falls back to the frame midpoint instead.
 */
function linearCrossingInBounds(
  times: number[], footY: number[], indices: number[], floorY: number,
  bounds: [number, number]
): number | null {
  const line = fitLine(indices.map((i) => times[i]!), indices.map((i) => footY[i]!))
  if (!line || line.b === 0) return null
  const t = (floorY - line.a) / line.b
  if (!Number.isFinite(t) || t < bounds[0] || t > bounds[1]) return null
  return t
}

/** The linear crossing estimate — the original method, kept as the fallback. */
function linearCrossing(
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

/**
 * When did the foot cross the floor?
 *
 * Fitted over airborne frames ONLY. The tempting two-point interpolation
 * through the last contact frame does not work: the foot is on the floor at
 * that frame by definition, so the line crosses the floor exactly there
 * whatever the speed — trading a half-frame-late bias for a half-frame-early
 * one. Extrapolating the airborne trajectory backwards has no such anchor.
 *
 * Prefers a quadratic fit (see quadraticCrossing) over the linear one
 * wherever there are enough points and the quadratic result is trustworthy;
 * falls back to the linear fit otherwise, which is itself already a
 * documented fallback (returns `fallback` when even that degenerates). The
 * fallback is not a rarely-used escape hatch: measured on a broad synthetic
 * sweep (5 jump heights x 4 fps x 5 takeoff phases x 10 seeds, both edges),
 * the quadratic path is declined on about a third of edge fits noise-free
 * (34%) and about two-thirds under sigma=0.01 landmark noise (65%) — the
 * linear fallback is doing much of the work, not covering a corner case.
 */
function crossingTime(
  times: number[], footY: number[], indices: number[], floorY: number, fallback: number,
  bounds: [number, number], preferEarlier: boolean
): number {
  if (indices.length >= MIN_QUADRATIC_FIT_FRAMES) {
    const quadratic = quadraticCrossing(times, footY, indices, floorY, bounds, preferEarlier)
    if (quadratic !== null) return quadratic
  }
  return linearCrossing(times, footY, indices, floorY, fallback, bounds)
}

/**
 * The standing foot level over `[from, to)`, or `fallback` when that window
 * is too short to average.
 *
 * A single floor for the whole clip is wrong whenever the athlete does not
 * finish standing exactly where they started, which is most jumps. Measured
 * on a real clip: the pre-takeoff standing level was 874.3 px, the
 * post-landing level 891.4 px, and the 90th-percentile floor over the whole
 * clip 887.8 px — nearly the post-landing value, because the athlete spends
 * longer standing after the jump than before it. Against that global floor
 * the takeoff threshold (0.02 of stature, 14.2 px there) had only 2 px of
 * its 14.2 left once the 12 px offset was subtracted, and fired about two
 * frames early. Each edge gets the floor from its own side instead.
 */
function localFloor(footY: number[], from: number, to: number, fallback: number): number {
  const lo = Math.max(0, from)
  const hi = Math.min(footY.length, to)
  if (hi - lo < MIN_FLOOR_WINDOW_FRAMES) return fallback
  return percentile(footY.slice(lo, hi).sort((a, b) => a - b), 0.5)
}

export function findFlightPhase(track: ComTrack): FlightPhaseOutcome {
  const { times, footY, staturePx } = track
  // times.length !== footY.length should never happen — buildComTrack pushes
  // to both arrays together, one frame at a time — but this function is
  // exported and ComTrack does not encode the invariant in its type, so a
  // hand-built track (tests do this) that breaks it is treated as having no
  // usable data rather than indexing past the shorter array below.
  if (footY.length === 0 || footY.length !== times.length || staturePx <= 0) {
    return { kind: 'no-flight' }
  }

  const floorY = percentile([...footY].sort((a, b) => a - b), FLOOR_PERCENTILE)
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
  if (bestStart === -1) return { kind: 'no-flight' }

  const coarseTakeoff = bestStart
  const coarseLanding = bestStart + bestLength
  if (coarseLanding >= times.length) return { kind: 'landing-past-end' }

  // Re-derive each boundary against the standing level on its own side. The
  // global floor above is kept for WHICH run is the jump — a question the
  // whole clip answers better than either end of it.
  const takeoffFloorY = localFloor(
    footY, coarseTakeoff - FLOOR_WINDOW_GAP - FLOOR_WINDOW_FRAMES, coarseTakeoff - FLOOR_WINDOW_GAP,
    floorY
  )
  const landingFloorY = localFloor(
    footY, coarseLanding + FLOOR_WINDOW_GAP, coarseLanding + FLOOR_WINDOW_GAP + FLOOR_WINDOW_FRAMES,
    floorY
  )

  // A stricter floor moves the boundary inwards, a looser one outwards, so
  // each edge walks in whichever direction its own floor requires.
  let takeoffFrame = coarseTakeoff
  while (takeoffFrame < coarseLanding && !(takeoffFloorY - footY[takeoffFrame]! > threshold)) {
    takeoffFrame++
  }
  while (takeoffFrame > 1 && takeoffFloorY - footY[takeoffFrame - 1]! > threshold) takeoffFrame--
  if (takeoffFrame >= coarseLanding) return { kind: 'no-flight' }

  let landingFrame = coarseLanding
  while (landingFrame > takeoffFrame + 1 && !(landingFloorY - footY[landingFrame - 1]! > threshold)) {
    landingFrame--
  }
  while (landingFrame < times.length && landingFloorY - footY[landingFrame]! > threshold) {
    landingFrame++
  }
  if (landingFrame >= times.length) return { kind: 'landing-past-end' }

  const leading = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, landingFrame - takeoffFrame) },
    (_, k) => takeoffFrame + k
  )
  const trailing = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, landingFrame - takeoffFrame) },
    (_, k) => landingFrame - 1 - k
  ).reverse()

  // The coarse threshold can lag the true landing split by about a frame
  // (see MAX_BOUNDARY_EXTENSION); reclaim any adjacent frame that is
  // actually part of the flight before fitting and clamping. This always
  // runs, even for a run already far past MAX_FLIGHT_SECONDS: the too-long
  // case still needs a fully-resolved phase to hand downstream (see
  // FlightPhaseOutcome), and extension's own cost is bounded by
  // EDGE_FIT_FRAMES + MAX_BOUNDARY_EXTENSION regardless of how long the
  // airborne run is.
  const trailingExtended = extendBoundary(
    times, footY, landingFloorY, threshold, trailing, 1, times.length - 1
  )

  const finalTakeoffFrame = takeoffFrame
  const finalLandingFrame = trailingExtended[trailingExtended.length - 1]! + 1

  const finalDuration = times[finalLandingFrame]! - times[finalTakeoffFrame]!

  // Takeoff: a ballistic fit when the foot's trajectory actually supports
  // one, and the midpoint of the containing frame interval when it does not.
  // What it never does any more is CLAMP a rejected extrapolation onto the
  // interval boundary.
  //
  // The extrapolation assumes the foot is ballistic the moment it leaves the
  // ground. Off a real takeoff it is not: the ankle is still plantarflexing,
  // so the foot barely moves for a frame and then accelerates. Measured on a
  // real clip (footY at the first three airborne frames: 850.7, 851.1,
  // 836.7) the quadratic was rejected at every window size from 3 to 5 —
  // c2 came out non-positive, i.e. not a ballistic arc at all — and the
  // linear fallback extrapolated 1.5 to 3 frames before the last contact
  // frame. Clamping turned each of those into the interval's lower bound and
  // reported it as a sub-frame measurement, which is how a foot still on the
  // ground came to be timed as airborne. Falling back to the midpoint
  // instead put takeoff at frame 144.45, against 144.5 read off the video
  // frame by frame; the clamped extrapolation gave 143.95 at best.
  //
  // No extendBoundary on this edge. On the same clip it reclaimed the frame
  // the video shows still in contact — its clearance guard passed (11.3 px
  // of 14.2) and the frame did sit near the fitted line, because a foot
  // rolling onto the toes is moving, just not airborne.
  //
  // The landing keeps both its extension and its extrapolation, and that
  // asymmetry is physical rather than a compromise: nothing actuates the
  // foot on the way down, so it really is ballistic into contact. Measured
  // on the same clip, landing came out 179.79 against ~180 from the video.
  // The window the fit is allowed to land in reaches TAKEOFF_LOOKBACK_FRAMES
  // back, not one. The airborne threshold is a displacement, so the foot
  // needs time to clear it: at 0.02 of stature and a 0.5 m jump's takeoff
  // speed that is about 0.7 of a frame at 60 fps, and wherever takeoff falls
  // inside its own frame the true instant can sit more than a frame before
  // the first frame that clears. A one-frame window rejected those and fell
  // back to the midpoint, costing 5 cm on fixtures whose foot is genuinely
  // ballistic. Widening the window is not the same as reclassifying frames
  // as airborne (what extendBoundary did, and what pulled a still-planted
  // foot into the flight on real footage) — it only decides which fitted
  // answers are admissible.
  // Two tiers of trust. A quadratic that fitParabola accepted has actually
  // demonstrated a ballistic arc, so it may reach the full lookback back. A
  // linear chord has demonstrated nothing beyond a direction of travel, so it
  // may only reach one frame — enough to keep it useful where the quadratic
  // is rejected by noise, not enough to let it place takeoff before a foot
  // that is still pushing off. On the real clip its answers (1.5 to 3 frames
  // early) fall outside the one-frame window and are discarded.
  const takeoffFit = finalTakeoffFrame === 0
    ? null
    : quadraticCrossing(times, footY, leading, takeoffFloorY,
        [times[Math.max(0, finalTakeoffFrame - TAKEOFF_LOOKBACK_FRAMES)]!,
         times[finalTakeoffFrame]!], true)
      ?? linearCrossingInBounds(times, footY, leading, takeoffFloorY,
        [times[finalTakeoffFrame - 1]!, times[finalTakeoffFrame]!])

  const takeoffTime = finalTakeoffFrame === 0
    ? times[0]!
    : takeoffFit ?? (times[finalTakeoffFrame - 1]! + times[finalTakeoffFrame]!) / 2

  const landingTime = crossingTime(times, footY, trailingExtended, landingFloorY,
    times[finalLandingFrame]!,
    [times[finalLandingFrame - 1]!, times[finalLandingFrame]!], false)

  const phase: FlightPhase = {
    takeoffFrame: finalTakeoffFrame, landingFrame: finalLandingFrame,
    takeoffTime, landingTime,
  }

  return finalDuration > MAX_FLIGHT_SECONDS ? { kind: 'too-long', phase } : { kind: 'found', phase }
}
