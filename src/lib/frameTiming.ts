/**
 * Converting between a playback time and a frame number, in one place.
 *
 * Two call sites need this — the frame counter under the video and the
 * marker arithmetic that turns two timestamps into a flight time. They used
 * to round differently (`floor` for the label, `round` for the maths), so
 * for most stepped positions the number the user read was one less than the
 * number the app measured with.
 */

/**
 * How close to a frame boundary counts as being *on* it, in frames.
 *
 * `HTMLMediaElement.currentTime` does not return what you assign it. Seek a
 * 60 fps video to frame 58 and it reads back as 57.99996 frames — a
 * deficit of 4e-5, far too large for a float epsilon to absorb and far too
 * small to be a real position inside the previous frame. One thousandth of
 * a frame clears that by a factor of 25 while staying 500× below the half
 * frame that would start misreporting genuine mid-frame positions.
 */
export const FRAME_SNAP_TOLERANCE = 1e-3

/** The frame showing at `time`, snapped onto a boundary it is sitting on. */
export function frameAtTime(time: number, fps: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(fps) || fps <= 0) return 0
  return Math.max(0, Math.floor(time * fps + FRAME_SNAP_TOLERANCE))
}

/**
 * A playback time that lands inside frame `frame` — its midpoint, not its
 * leading edge.
 *
 * The half-frame matters because `fps` is a nominal rate snapped to a
 * standard ladder, while the container's real rate is a hair off it: a clip
 * tagged 60 fps actually runs at 59.966, so its frame `k` begins slightly
 * *after* `k / 60`. Seeking to the leading edge therefore shows frame
 * `k - 1`. Aiming at the middle absorbs that drift — it stays under half a
 * frame for thousands of frames — so the frame on screen is the frame the
 * counter names.
 */
export function timeAtFrame(frame: number, fps: number): number {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) return 0
  return Math.max(0, (frame + 0.5) / fps)
}

/** Whether two playback times land on the same frame at this frame rate. */
export function sameFrame(a: number, b: number, fps: number): boolean {
  return frameAtTime(a, fps) === frameAtTime(b, fps)
}
