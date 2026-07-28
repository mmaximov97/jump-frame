export interface Vec2 {
  x: number
  y: number
}

/** A MediaPipe pose landmark in normalized frame coordinates (0..1, y down). */
export type Landmark = Vec2

export interface PoseFrame {
  /** Presentation time of this frame, in seconds. */
  time: number
  /** Exactly 33 landmarks, in MediaPipe's index order. */
  landmarks: Landmark[]
}

export interface VideoSize {
  /**
   * Video pixel width. Currently unread by every function under src/lib —
   * only `.height` feeds any calculation (verified: passing `width: 1`
   * against a real clip reproduces bit-identical results to the true video
   * width). Still pass the actual decoded video pixel width here, not a CSS
   * or display width: nothing checks this today, which is not a guarantee
   * it stays unread — a future change (e.g. a horizontal-only crop or a
   * landscape jump) could start reading it, and a caller that had been
   * passing a convenient CSS width would only find out then.
   */
  width: number
  height: number
}

/** MediaPipe Pose landmark indices, named. Only the ones this project uses. */
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const

/** Every landmark that can be the lowest point of a foot. */
export const FOOT_LANDMARKS = [
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_HEEL, LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
] as const

export const LANDMARK_COUNT = 33
