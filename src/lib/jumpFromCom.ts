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
  /**
   * One-sigma estimate of height error from the com PARABOLA FIT'S RESIDUAL
   * SCATTER ALONE — `2 * rmsResidualPx / sqrt(n) / scalePxPerM`, in
   * centimetres. It measures how tightly the sampled com points sit on the
   * fitted curve. It contains NOTHING from the uncertainty of the takeoff
   * instant itself, which is the pipeline's dominant error source:
   * flightPhase's sub-frame crossing estimate is worth about 3.1 mm of
   * reported jump height per millisecond of timing error (see
   * comTrack.ts's computeFootY docstring), and that error does not show up
   * as fit residual scatter — a perfectly clean, high-rSquared fit can still
   * sit on the wrong parabola if takeoffTime is off.
   *
   * Measured (50 seeds, synthetic landmark noise sigma=0.005): correlation
   * between takeoff-timing error and height error is -0.9949 — the timing
   * error essentially IS the height error, not an independent contributor;
   * mean true height error 1.20 cm against a mean quoted errorCm of 0.18 cm,
   * a 7x understatement; one-sigma coverage (fraction of draws whose true
   * error falls inside one quoted sigma) measures 12%, far under the ~68% a
   * real one-sigma bound implies; worst observed case: true error 4.821 cm
   * against a quoted errorCm of 0.188 cm. The understatement factor holds
   * up, and grows, away from that sigma: 6x at sigma=0.002, 8.4x at
   * sigma=0.01. On the noise-free clean-tracking leg-tuck fixture, errorCm
   * reads exactly 0.0000 while the true error is 1.404 cm — the fit can be
   * numerically perfect while still being wrong, because the error that
   * dominates here was never in the residuals to begin with.
   *
   * DO NOT render this value to a user as a confidence interval, error bar,
   * or "accurate to ±X cm" claim on its own. It systematically and severely
   * understates the true uncertainty by omitting its dominant term.
   * Combining it with a proper takeoff-instant uncertainty term is PR-C
   * work; until that exists, treat errorCm as a lower bound on the true
   * error, not an estimate of it.
   */
  errorCm: number
  rSquared: number
  /** Frames that actually fed the parabola fit. */
  flightFrames: number
  /**
   * Sub-frame takeoff and landing instants, in seconds of playback time.
   *
   * These are the times to show a user or map onto a video frame number.
   * The `*SampleIndex` fields below are emphatically not: the pipeline
   * samples a fraction of the clip's frames, so index 135 of 197 samples is
   * nowhere near video frame 135.
   */
  takeoffTime: number
  landingTime: number
  /** Indices into the sampled frame array — internal, for debugging. */
  takeoffSampleIndex: number
  landingSampleIndex: number
}

/**
 * Frames dropped from each end of the airborne run before fitting. The edge
 * frames sit closest to contact and are the likeliest to carry motion blur or
 * a lingering trace of the foot still loaded.
 */
const EDGE_TRIM_FRAMES = 1

/**
 * The full result of running the pipeline on one clip: either a usable
 * analysis (possibly flagged `tooLong`, see FlightPhaseOutcome) or a
 * specific reason it could not be produced at all. `analyseJump` and
 * `measureJump` are both thin wrappers over this — kept private so the
 * six-cause collapse Important 3 flagged cannot silently come back: any new
 * failure path added here must pick a real VerdictReason, not `null`.
 */
type AnalysisRun =
  | { failed: false; analysis: JumpAnalysis; tooLong: boolean }
  | { failed: true; reason: VerdictReason; message: string }

function runAnalysis(frames: PoseFrame[], video: VideoSize): AnalysisRun {
  const track = buildComTrack(frames, video)
  const flight = findFlightPhase(track)

  if (flight.kind === 'no-flight') {
    return { failed: true, reason: 'no-flight', message: 'Не нашли прыжок в этом видео.' }
  }
  if (flight.kind === 'landing-past-end') {
    return { failed: true, reason: 'short-flight', message: 'Слишком короткий полёт для анализа.' }
  }

  const { phase } = flight
  const from = phase.takeoffFrame + EDGE_TRIM_FRAMES
  const to = phase.landingFrame - EDGE_TRIM_FRAMES
  if (to - from < 3) {
    return { failed: true, reason: 'short-flight', message: 'Слишком короткий полёт для анализа.' }
  }

  const fit = fitParabola(track.times.slice(from, to), track.comY.slice(from, to))
  if (!fit) {
    return { failed: true, reason: 'degenerate-fit', message: 'Не удалось измерить прыжок по этому видео.' }
  }

  const { takeoffTime, landingTime } = phase
  // Read the takeoff height off the FITTED curve, not the measured sample:
  // one sample carries a whole frame's noise, the curve averages it over the
  // twenty-odd frames of flight.
  const yTakeoff = fit.c0 + fit.c1 * takeoffTime + fit.c2 * takeoffTime * takeoffTime
  const riseM = (yTakeoff - fit.yApex) / fit.scalePxPerM

  const flightTimeSeconds = landingTime - takeoffTime
  const flightTimeHeightM = (GRAVITY * flightTimeSeconds * flightTimeSeconds) / 8

  const analysis: JumpAnalysis = {
    comHeightCm: riseM * 100,
    flightTimeHeightCm: flightTimeHeightM * 100,
    flightTimeSeconds,
    statureM: track.staturePx / fit.scalePxPerM,
    scalePxPerM: fit.scalePxPerM,
    errorCm: ((2 * fit.rmsResidualPx) / Math.sqrt(fit.n) / fit.scalePxPerM) * 100,
    rSquared: fit.rSquared,
    flightFrames: fit.n,
    takeoffTime,
    landingTime,
    takeoffSampleIndex: phase.takeoffFrame,
    landingSampleIndex: phase.landingFrame,
  }

  return { failed: false, analysis, tooLong: flight.kind === 'too-long' }
}

export function analyseJump(frames: PoseFrame[], video: VideoSize): JumpAnalysis | null {
  const run = runAnalysis(frames, video)
  return run.failed ? null : run.analysis
}

export interface QualityMetrics {
  rSquared: number
  flightFrames: number
  statureM: number
  comHeightCm: number
  flightTimeHeightCm: number
  /**
   * Whether findFlightPhase's airborne run exceeded MAX_FLIGHT_SECONDS even
   * after its sub-frame boundary was fully resolved (see
   * FlightPhaseOutcome's 'too-long' in flightPhase.ts). Often caught earlier
   * and more specifically by the stature-band check below — slow motion
   * inflates statureM by k² — but a genuinely lost tracker is not guaranteed
   * to also fail rSquared or land outside the stature band, and in the
   * common case degrades rSquared only into the warn-tier 0.95-0.99 band,
   * not below it. See `assess`'s docstring for why this is checked
   * immediately after stature and, deliberately, before either warn-tier
   * check: a flight longer than any human achieves must never be reported
   * 'ok' — or merely caveated — whatever the other metrics say.
   */
  tooLong: boolean
}

/**
 * Machine-readable reason a `warn` or `unusable` Verdict fired, for callers
 * that want to choose a UI action rather than string-match `message` —
 * `message` stays free-form Russian prose for a human to read (this file is
 * the only non-test file under src/lib containing Cyrillic; there is no
 * i18n layer yet), `reason` is the closed, stable part a future PR-C UI or
 * i18n layer can actually switch on.
 *
 * - 'no-flight': no candidate airborne run was found at all — the track was
 *   empty or degenerate, or the foot never cleared the airborne threshold
 *   anywhere in the clip. User action: re-record so the jump itself is
 *   visible to the camera.
 * - 'short-flight': a candidate flight was found but there is not enough of
 *   it to measure — the clip ends before landing, edge-trimming leaves
 *   fewer than 3 frames to fit, or the final flightFrames count is under
 *   MIN_FLIGHT_FRAMES. User action: record a longer clip with both takeoff
 *   and landing in frame.
 * - 'tracking-lost': the fit's rSquared is too low to trust — pose tracking
 *   dropped out somewhere in flight — or, as the last-resort duration
 *   guard, an airborne run over MAX_FLIGHT_SECONDS survived every other
 *   check undetected. User action: retry with the athlete fully in frame
 *   and well lit, filmed from the side.
 * - 'slow-motion': the fitted scale implies an implausible stature. The
 *   dominant real cause is a clip saved in slow motion (apparent
 *   acceleration is g/k², see flightPhase's MAX_FLIGHT_SECONDS docstring),
 *   not a genuinely very tall or very short athlete. User action: confirm
 *   the video's real frame rate, or disable slow-motion capture.
 * - 'degenerate-fit': the com trajectory did not fit a rising-then-falling
 *   parabola at all (fitParabola rejected it), or the fit produced a
 *   non-positive or non-finite height. User action: same as
 *   'tracking-lost' — retrace with a cleaner view of the athlete.
 * - 'pose-asymmetry': the com-fit height and the flight-time-formula height
 *   disagree by more than MAX_METHOD_DISAGREEMENT, most often because the
 *   takeoff and landing poses genuinely differ (e.g. landing in a deep
 *   squat). User action: none required — the com height shown is still the
 *   pipeline's best estimate, just flagged as less certain than usual.
 */
export type VerdictReason =
  | 'no-flight'
  | 'short-flight'
  | 'tracking-lost'
  | 'slow-motion'
  | 'degenerate-fit'
  | 'pose-asymmetry'

export type Verdict =
  | { kind: 'ok'; heightCm: number }
  | { kind: 'warn'; heightCm: number; message: string; reason: VerdictReason }
  | { kind: 'unusable'; message: string; reason: VerdictReason }

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
 *
 * The `tooLong` check runs immediately after stature, before either warn-tier
 * check — deliberately: stature gives the more specific and far more common
 * 'slow-motion' diagnosis for the case that actually motivated the duration
 * cap (see flightPhase.ts), so it must get first refusal. But it cannot run
 * any later than that: a lost tracker (the OTHER cause of an over-long run)
 * typically degrades rSquared into the 0.95-0.99 band, not below 0.95 — the
 * band the warn-tier rSquared check owns, not the unusable-tier one above —
 * so placing `tooLong` after the warn-tier checks would let that check (or
 * the method-disagreement one) intercept the common case and hand back a
 * caveated number instead of a refusal, defeating the guard for the
 * situation it exists to catch. When the input itself is untrustworthy, a
 * caveated number is worse than no number, so `tooLong` outranks both warns.
 */
export function assess(m: QualityMetrics): Verdict {
  if (!Number.isFinite(m.comHeightCm) || m.comHeightCm <= 0) {
    return { kind: 'unusable', reason: 'degenerate-fit', message: 'Не удалось измерить прыжок по этому видео.' }
  }
  if (m.flightFrames < MIN_FLIGHT_FRAMES) {
    return { kind: 'unusable', reason: 'short-flight', message: 'Слишком короткий полёт для анализа.' }
  }
  if (m.rSquared < MIN_USABLE_R_SQUARED) {
    return {
      kind: 'unusable', reason: 'tracking-lost',
      message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.',
    }
  }
  // A scale error is always a factor of k squared, so at least fourfold. The
  // band is wide on purpose: it should never fire on a short teenager, only
  // on a timebase that is flatly wrong.
  //
  // This is `unusable`, not `warn`, and that is deliberate, not an oversight:
  // when the scale is wrong, BOTH comHeightCm and flightTimeHeightCm are
  // wrong by that same k² factor — there is no reading of this measurement
  // that is approximately right. "180 cm, but be careful" implies the number
  // is in the right neighbourhood; here it never is, so a caveat would
  // undersell how wrong it is. Showing nothing is the honest option.
  if (m.statureM < MIN_STATURE_M || m.statureM > MAX_STATURE_M) {
    return { kind: 'unusable', reason: 'slow-motion', message: 'Похоже, видео в замедленной съёмке — результат недостоверен.' }
  }
  // Must run here, before either warn-tier check below: a lost tracker
  // typically degrades rSquared into the 0.95-0.99 band, not below 0.95, so
  // a later position would let the warn-tier rSquared check (or the
  // method-disagreement one) intercept the common case this guard exists
  // for and hand back a caveated number instead of a refusal.
  if (m.tooLong) {
    return {
      kind: 'unusable', reason: 'tracking-lost',
      message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.',
    }
  }
  if (m.rSquared < MIN_CLEAN_R_SQUARED) {
    return {
      kind: 'warn', reason: 'tracking-lost', heightCm: m.comHeightCm,
      message: 'Трекинг местами срывался — цифра приблизительная.',
    }
  }
  if (Math.abs(m.comHeightCm - m.flightTimeHeightCm) / m.comHeightCm > MAX_METHOD_DISAGREEMENT) {
    return {
      kind: 'warn', reason: 'pose-asymmetry', heightCm: m.comHeightCm,
      message: 'Поза на отрыве и приземлении заметно различаются.',
    }
  }
  return { kind: 'ok', heightCm: m.comHeightCm }
}

export function measureJump(
  frames: PoseFrame[], video: VideoSize
): { analysis: JumpAnalysis | null; verdict: Verdict } {
  const run = runAnalysis(frames, video)
  if (run.failed) {
    return { analysis: null, verdict: { kind: 'unusable', reason: run.reason, message: run.message } }
  }
  const { analysis, tooLong } = run
  return {
    analysis,
    verdict: assess({
      rSquared: analysis.rSquared,
      flightFrames: analysis.flightFrames,
      statureM: analysis.statureM,
      comHeightCm: analysis.comHeightCm,
      flightTimeHeightCm: analysis.flightTimeHeightCm,
      tooLong,
    }),
  }
}
