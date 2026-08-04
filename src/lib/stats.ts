/**
 * The p-th percentile (0..1) of a set of values, nearest-rank (not
 * interpolated): index = round(p * (n - 1)), clamped to the array's bounds.
 *
 * Requires `sorted` to already be sorted ascending — this function does not
 * sort. Both call sites (comTrack's stature estimate, flightPhase's floor
 * estimate) already have a natural point to sort once before calling this
 * repeatedly or alongside other work on the same array; sorting again in
 * here would either duplicate that work or silently paper over a caller
 * passing unsorted data by accident.
 *
 * Returns 0 for an empty array. There is no percentile of nothing; both
 * callers deal in pixel coordinates, where 0 is a safer default to compose
 * with downstream arithmetic than NaN or a thrown error.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[index]!
}

/**
 * The p-th percentile of `values[j]` for every `j` whose `times[j]` falls
 * within `windowSeconds / 2` of `times[i]`, evaluated at every index `i` — or
 * `null` where fewer than `minPoints` fall in that window.
 *
 * Centred, not causal: every caller runs this once over an already fully
 * decoded clip, never live, so there is no reason to discard the half of the
 * window a centred computation gets for free — a backward-only window would
 * leave the estimate lagging exactly where a real depth change is fastest.
 *
 * `times` need not be evenly spaced. The two-pass frame walk in
 * usePoseDetection.ts samples a clip unevenly on purpose — sparse everywhere,
 * dense only near a suspected flight — so the window has to be defined in
 * seconds, not in a fixed count of neighbouring array entries: a fixed-count
 * window would span wildly different real time depending on where in the
 * clip it happened to land.
 *
 * O(n^2) -- for every index, scans every other index. Deliberately not
 * optimised: real clips run to a few hundred sampled frames, and a
 * two-pointer sliding window would only pay for itself at a scale this
 * pipeline never reaches.
 */
export function rollingPercentile(
  times: number[], values: number[], windowSeconds: number, minPoints: number, p: number
): (number | null)[] {
  const halfWindow = windowSeconds / 2
  const result: (number | null)[] = []
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!
    const inWindow: number[] = []
    for (let j = 0; j < times.length; j++) {
      if (Math.abs(times[j]! - t) <= halfWindow) inWindow.push(values[j]!)
    }
    if (inWindow.length < minPoints) {
      result.push(null)
      continue
    }
    inWindow.sort((a, b) => a - b)
    result.push(percentile(inWindow, p))
  }
  return result
}

/** rollingPercentile at p=0.5 -- the statistic every rolling-floor caller wants. */
export function rollingMedian(
  times: number[], values: number[], windowSeconds: number, minPoints: number
): (number | null)[] {
  return rollingPercentile(times, values, windowSeconds, minPoints, 0.5)
}
