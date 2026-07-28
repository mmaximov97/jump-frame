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
