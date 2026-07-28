import { centreOfMass } from './bodyModel'
import { FOOT_LANDMARKS, LANDMARK_COUNT, LM, type PoseFrame, type VideoSize } from './poseTypes'
import { percentile } from './stats'

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/**
 * Where does the foot sit vertically, this frame?
 *
 * A maximum over all six landmarks (both ankles, heels, toes) is the worst
 * available choice under noise: the max of several noisy samples is both
 * biased (it systematically overshoots the true contact level, since it
 * always picks whichever landmark's noise pushed it furthest down) and
 * higher-variance than any individual sample — and this is also the single
 * most sensitivity-critical point in the pipeline, since flightPhase's
 * sub-frame crossing estimate is worth about 3.1mm of reported jump height
 * per millisecond of timing error.
 *
 * The median of all six is used instead of a mean over a hand-picked subset
 * for two reasons. First, measured: swept against a mean of the four
 * ground-contact landmarks (heels + toes) and a mean of the two toes alone,
 * on 100 seeds of synthetic landmark noise (sigma 0.005) — median and the
 * ground-contact mean came out statistically tied (mean error 1.19 vs
 * 1.16cm, worst case 4.89 vs 4.95cm), both far ahead of the toes-only mean
 * and of this file's old plain maximum. Second, structural: the two ankles
 * sit measurably higher than the floor (about 0.039 of stature above it, tens
 * of pixels — nowhere close to the landmark noise scale), so under ordinary
 * noise the median of all six reduces to the median of the four
 * ground-contact landmarks on its own, with no need to hand-pick which
 * landmarks count as "ground contact". A median is also more robust than a
 * mean to the kind of noise real pose estimation actually produces —
 * occasional large single-landmark misses from occlusion or motion blur,
 * not just small independent Gaussian jitter — which the synthetic generator
 * cannot exercise but which real footage (PR-C) will.
 */
function computeFootY(frame: PoseFrame, video: VideoSize): number {
  return median(FOOT_LANDMARKS.map((index) => frame.landmarks[index]!.y * video.height))
}

export interface ComTrack {
  /**
   * Frame presentation times, seconds. Always the same length as `comY` and
   * `footY` — buildComTrack pushes to all three in lockstep, one malformed
   * frame at a time (see buildComTrack), skipping a frame from all three
   * arrays at once rather than leaving them to drift out of correspondence.
   * Callers outside this file that build a ComTrack by hand (tests do) must
   * preserve that invariant themselves; findFlightPhase checks it rather
   * than assuming it, since it is exported and this is not encoded in the
   * type.
   */
  times: number[]
  /** Body centre of mass, vertical pixels, y down. */
  comY: number[]
  /**
   * Vertical position of the foot, in pixels, y down: the median of both
   * ankles, heels and toes (see computeFootY). Not the lowest of the six —
   * that is the point of using a median instead of a maximum. Measured
   * (synthetic landmark noise, Monte Carlo–confirmed independently of the
   * generator): the median sits systematically about 1.6-1.7 standard
   * deviations above the lowest of the six, at both sigma 0.005 and 0.01 —
   * larger than a plain 4-sample order-statistic gap (~1.03 sigma) because
   * the two ankles occasionally rank into the comparison too. That gap is
   * the resistance to a single-landmark spike this statistic exists for,
   * not a bug to close.
   */
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

export function buildComTrack(frames: PoseFrame[], video: VideoSize): ComTrack {
  const times: number[] = []
  const comY: number[] = []
  const footY: number[] = []
  const spans: number[] = []

  for (const frame of frames) {
    // MediaPipe emits an empty landmarks array when it detects no pose at
    // all, and any other length is equally unusable — every index below
    // (LM.NOSE, FOOT_LANDMARKS, bodyModel's SEGMENTS) assumes exactly
    // LANDMARK_COUNT entries. Skip the frame rather than index into
    // `undefined`: a single dropped-pose frame mid-clip should degrade the
    // track by one sample, not crash the whole measurement. If every frame
    // is malformed, times/comY/footY all come out empty and
    // findFlightPhase's own guard reports 'no-flight' — a verdict, not a
    // throw.
    if (frame.landmarks.length !== LANDMARK_COUNT) continue

    times.push(frame.time)
    comY.push(centreOfMass(frame.landmarks).y * video.height)

    const foot = computeFootY(frame, video)
    footY.push(foot)

    spans.push(foot - frame.landmarks[LM.NOSE]!.y * video.height)
  }

  spans.sort((a, b) => a - b)
  // spans.length, not frames.length: a clip full of malformed (skipped)
  // frames must fall back to 0 just as an empty clip does, and percentile's
  // own empty-array guard already returns 0 — this condition just makes
  // that intent explicit for a reader, rather than relying on frames.length
  // happening to be 0 too (true before landmark-length skipping existed,
  // not necessarily true now that frames.length and spans.length can differ).
  const staturePx = spans.length === 0
    ? 0
    : percentile(spans, STANDING_PERCENTILE) / NOSE_HEIGHT_FRACTION

  return { times, comY, footY, staturePx }
}
