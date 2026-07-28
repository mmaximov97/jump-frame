/**
 * Every Nth frame in the coarse pass. Six at 60 fps is a sample every 100 ms —
 * dense enough that a flight of 400 ms cannot hide between samples, sparse
 * enough to keep a ten-second clip near a hundred detector calls instead of
 * six hundred.
 */
export const COARSE_STRIDE = 6

/** How far either side of the coarse flight window the dense pass reaches. */
export const FINE_WINDOW_SECONDS = 0.4

/**
 * Which instants the coarse pass should sample.
 *
 * Scheduling lives here, away from the DOM, because it is arithmetic: a missed
 * frame at a boundary or a duplicated sample would otherwise surface as
 * unexplained inaccuracy on real footage, with nothing to test against.
 */
export function planCoarsePass(duration: number, fps: number): number[] {
  if (!(duration > 0) || !(fps > 0)) return []
  const step = COARSE_STRIDE / fps
  const times: number[] = []
  for (let n = 0; n * step < duration; n++) times.push(n * step)
  return times
}

/**
 * Which instants the dense pass should sample, given which coarse samples came
 * back airborne. Returns only instants the coarse pass did not already visit,
 * so no frame is decoded twice.
 */
export function planFinePass(
  coarseTimes: number[],
  airborneIndices: number[],
  duration: number,
  fps: number
): number[] {
  if (airborneIndices.length === 0 || !(duration > 0) || !(fps > 0)) return []

  const first = Math.min(...airborneIndices)
  const last = Math.max(...airborneIndices)
  const from = Math.max(0, (coarseTimes[first] ?? 0) - FINE_WINDOW_SECONDS)
  const to = Math.min(duration, (coarseTimes[last] ?? duration) + FINE_WINDOW_SECONDS)

  const frame = 1 / fps
  const seen = new Set(coarseTimes.map((t) => Math.round(t / frame)))
  const times: number[] = []
  for (let n = Math.ceil(from / frame); n * frame < to; n++) {
    if (seen.has(n)) continue
    times.push(n * frame)
  }
  return times
}
