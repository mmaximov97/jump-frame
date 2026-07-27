import { GRAVITY } from '../physics'
import { centreOfMass } from '../bodyModel'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../poseTypes'

export interface JumpOptions {
  /** True rise of the body com from takeoff to apex, in metres. */
  jumpHeightM: number
  scalePxPerM: number
  fps: number
  videoWidth: number
  videoHeight: number
  /** Default 1.8. */
  statureM?: number
  /** Frames of standing before takeoff and after landing. Default 20. */
  standFrames?: number
  /** How far knees and feet rise toward the hips at the apex, metres. Default 0. */
  tuckM?: number
  /** Gaussian noise on normalized coordinates. Default 0. */
  noiseSigma?: number
  /** Slow-motion factor: apparent time is stretched by this. Default 1. */
  timeScale?: number
  /** Where takeoff falls inside the frame interval, 0..1 exclusive. Default 0.5. */
  takeoffPhase?: number
  /** Seed for the noise PRNG. Default 1. */
  seed?: number
}

export interface SyntheticClip {
  frames: PoseFrame[]
  truth: {
    jumpHeightM: number
    scalePxPerM: number
    statureM: number
    /** Sub-frame takeoff instant, in apparent (video) seconds. */
    takeoffTime: number
    /** Sub-frame landing instant, in apparent (video) seconds. */
    landingTime: number
    /** Real-world flight duration, seconds. */
    flightTimeS: number
    /** Flight duration as it appears in the video's timebase. */
    apparentFlightTimeS: number
  }
}

/**
 * Standing body proportions as fractions of stature, measured upward from the
 * floor (Drillis & Contini). The nose sits at 0.936 — deliberately NOT the
 * 0.90 constant comTrack divides by, so that the stature estimator is tested
 * against an independent value rather than its own assumption.
 */
const HEIGHT_FRACTION = {
  foot: 0.0,
  ankle: 0.039,
  knee: 0.285,
  hip: 0.530,
  wrist: 0.485,
  elbow: 0.630,
  shoulder: 0.818,
  nose: 0.936,
  hand: 0.431,
} as const

const HALF_WIDTH_FRACTION = {
  hip: 0.05,
  shoulder: 0.10,
  arm: 0.13,
  foot: 0.05,
} as const

/** Deterministic PRNG — src/lib must never reach for Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/**
 * How the leg tuck rises and falls over the flight, as a 0..1 bump.
 *
 * Deliberately ASYMMETRIC, peaking around 31% of the flight rather than at the
 * apex, because a symmetric bump would make this whole scenario useless.
 * sin(pi*x) approximates 4x(1-x) to within about 5%, i.e. a symmetric tuck is
 * itself nearly a parabola — least squares then absorbs it into c2 instead of
 * rejecting it, and the resulting scale error cancels against the matching
 * error in the measured rise almost exactly. The hip midpoint would come out
 * roughly correct and the contrast test would prove nothing.
 *
 * Real athletes tuck on the way up and extend the legs before landing, so the
 * asymmetric shape is also the truthful one.
 */
function tuckShape(x: number): number {
  return Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, x)), 0.6))
}

export function generateJump(options: JumpOptions): SyntheticClip {
  const {
    jumpHeightM, scalePxPerM, fps, videoWidth, videoHeight,
    statureM = 1.8,
    standFrames = 20,
    tuckM = 0,
    noiseSigma = 0,
    timeScale = 1,
    takeoffPhase = 0.5,
    seed = 1,
  } = options

  const staturePx = statureM * scalePxPerM
  const v0 = Math.sqrt(2 * GRAVITY * jumpHeightM)
  const flightTimeS = (2 * v0) / GRAVITY
  const apparentFlightTimeS = flightTimeS * timeScale

  const takeoffTime = (standFrames - takeoffPhase) / fps
  const landingTime = takeoffTime + apparentFlightTimeS
  const totalFrames = standFrames + Math.ceil(apparentFlightTimeS * fps) + standFrames

  // Floor position on screen, chosen so the standing figure sits in frame.
  const floorYPx = videoHeight * 0.92

  /**
   * Builds one pose. `liftM` raises knees and feet toward the hips; the caller
   * decides where the figure ends up vertically.
   */
  function buildPose(liftM: number): Landmark[] {
    const up = (fraction: number, lift = 0) => floorYPx - (fraction * statureM + lift) * scalePxPerM
    const cx = videoWidth / 2
    const sideX = (halfWidth: number, side: number) => cx + side * halfWidth * staturePx

    const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: cx, y: up(0) }))
    const put = (index: number, x: number, y: number) => { landmarks[index] = { x, y } }

    for (const side of [-1, 1]) {
      const isLeft = side < 0
      const hipX = sideX(HALF_WIDTH_FRACTION.hip, side)
      const shoulderX = sideX(HALF_WIDTH_FRACTION.shoulder, side)
      const armX = sideX(HALF_WIDTH_FRACTION.arm, side)
      const footX = sideX(HALF_WIDTH_FRACTION.foot, side)

      put(isLeft ? LM.LEFT_HIP : LM.RIGHT_HIP, hipX, up(HEIGHT_FRACTION.hip))
      put(isLeft ? LM.LEFT_KNEE : LM.RIGHT_KNEE, hipX, up(HEIGHT_FRACTION.knee, liftM * 0.6))
      put(isLeft ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE, footX, up(HEIGHT_FRACTION.ankle, liftM))
      put(isLeft ? LM.LEFT_HEEL : LM.RIGHT_HEEL, footX, up(HEIGHT_FRACTION.foot, liftM))
      put(isLeft ? LM.LEFT_FOOT_INDEX : LM.RIGHT_FOOT_INDEX, footX, up(HEIGHT_FRACTION.foot, liftM))
      put(isLeft ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER, shoulderX, up(HEIGHT_FRACTION.shoulder))
      put(isLeft ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW, armX, up(HEIGHT_FRACTION.elbow))
      put(isLeft ? LM.LEFT_WRIST : LM.RIGHT_WRIST, armX, up(HEIGHT_FRACTION.wrist))
      put(isLeft ? LM.LEFT_INDEX : LM.RIGHT_INDEX, armX, up(HEIGHT_FRACTION.hand))
    }
    put(LM.NOSE, cx, up(HEIGHT_FRACTION.nose))

    return landmarks
  }

  function shift(landmarks: Landmark[], dyPx: number): Landmark[] {
    return landmarks.map((l) => ({ x: l.x, y: l.y + dyPx }))
  }

  // The standing figure defines both the floor contact and the takeoff com
  // level, so flight begins exactly where standing ends — no discontinuity.
  const standingPose = buildPose(0)
  const standingComYPx = centreOfMass(standingPose).y

  const rand = mulberry32(seed)
  const frames: PoseFrame[] = []

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps
    let landmarks: Landmark[]

    if (time <= takeoffTime || time >= landingTime) {
      landmarks = standingPose
    } else {
      const tReal = (time - takeoffTime) / timeScale
      const riseM = v0 * tReal - (GRAVITY * tReal * tReal) / 2
      const lift = tuckM * tuckShape(tReal / flightTimeS)
      const airbornePose = buildPose(lift)
      // Place by com, not by feet: this is what makes a leg tuck drag the hips
      // off the parabola on its own, with nothing special coded for it.
      const targetComYPx = standingComYPx - riseM * scalePxPerM
      landmarks = shift(airbornePose, targetComYPx - centreOfMass(airbornePose).y)
    }

    const normalized: Landmark[] = landmarks.map((l) => ({
      x: l.x / videoWidth + (noiseSigma > 0 ? gaussian(rand) * noiseSigma : 0),
      y: l.y / videoHeight + (noiseSigma > 0 ? gaussian(rand) * noiseSigma : 0),
    }))

    frames.push({ time, landmarks: normalized })
  }

  return {
    frames,
    truth: {
      jumpHeightM, scalePxPerM, statureM,
      takeoffTime, landingTime, flightTimeS, apparentFlightTimeS,
    },
  }
}
