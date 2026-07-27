import { GRAVITY } from './physics'

export interface ParabolaFit {
  c0: number
  c1: number
  c2: number
  /** Apparent vertical acceleration, px/s², positive downward. */
  aPx: number
  /** Pixels per metre, solved from the fact that aPx must represent 9.81 m/s². */
  scalePxPerM: number
  tApex: number
  yApex: number
  rSquared: number
  rmsResidualPx: number
  n: number
}

/**
 * Least-squares fit of y = c0 + c1 t + c2 t^2.
 *
 * Returns null when the fit is unusable: too few points, a degenerate time
 * axis, or c2 <= 0. In screen coordinates y grows downward, so a real flight
 * curves with c2 > 0; anything else is not ballistic motion.
 *
 * The solve runs in time centred on the sample mean. Clip timestamps reach
 * tens of seconds and the normal equations carry t^4, so without centring the
 * matrix entries span many orders of magnitude and the solution loses its
 * significant digits. Coefficients are expanded back to the original time base
 * before returning, because callers evaluate them at absolute takeoff time.
 */
export function fitParabola(times: number[], values: number[]): ParabolaFit | null {
  const n = times.length
  if (n < 3 || values.length !== n) return null

  const tm = times.reduce((s, t) => s + t, 0) / n
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0
  let r0 = 0, r1 = 0, r2 = 0
  for (let i = 0; i < n; i++) {
    const u = times[i]! - tm
    const y = values[i]!
    const u2 = u * u
    s0 += 1
    s1 += u
    s2 += u2
    s3 += u2 * u
    s4 += u2 * u2
    r0 += y
    r1 += u * y
    r2 += u2 * y
  }

  const det =
    s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2)
  if (det === 0 || !Number.isFinite(det)) return null

  const d0 =
    (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det
  const d1 =
    (s0 * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det
  const d2 =
    (s0 * (s2 * r2 - r1 * s3) - s1 * (s1 * r2 - r1 * s2) + r0 * (s1 * s3 - s2 * s2)) / det

  if (!Number.isFinite(d0) || !Number.isFinite(d1) || !Number.isFinite(d2)) return null
  if (d2 <= 0) return null

  // y = d0 + d1(t - tm) + d2(t - tm)^2, expanded around t = 0.
  const c2 = d2
  const c1 = d1 - 2 * d2 * tm
  const c0 = d0 - d1 * tm + d2 * tm * tm

  let ssRes = 0
  let ssTot = 0
  const meanY = r0 / n
  for (let i = 0; i < n; i++) {
    const t = times[i]!
    const predicted = c0 + c1 * t + c2 * t * t
    ssRes += (values[i]! - predicted) ** 2
    ssTot += (values[i]! - meanY) ** 2
  }

  const tApex = -c1 / (2 * c2)

  return {
    c0, c1, c2,
    aPx: 2 * c2,
    scalePxPerM: (2 * c2) / GRAVITY,
    tApex,
    yApex: c0 + c1 * tApex + c2 * tApex * tApex,
    rSquared: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    rmsResidualPx: Math.sqrt(ssRes / n),
    n,
  }
}
