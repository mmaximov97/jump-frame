import { describe, it, expect } from 'vitest'
import { analyseJump, measureJump } from './jumpFromCom'
import { buildComTrack } from './comTrack'
import { findFlightPhase } from './flightPhase'
import { fitParabola } from './parabolaFit'
import { generateJump } from './testing/syntheticJumper'
import { LM } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }
const BASE = {
  jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
  videoWidth: VIDEO.width, videoHeight: VIDEO.height,
}

describe('acceptance: the pipeline recovers a known jump', () => {
  // Bound is 0.001 cm (10 micrometres), not 1 cm: this and the jump-height
  // sweep below are the tests that prove the systematic bias flightPhase's
  // quadratic crossing fit removed is actually gone, not just made small
  // enough to hide under a loose bound. Measured here: 1.7e-13 cm — machine
  // noise, ten orders of magnitude under the bound. Injecting the exact
  // pre-fix behaviour (linear crossing fit) instead measures 0.6682 cm here,
  // which this bound catches; the old 1 cm bound did not.
  it('lands within 0.001 cm at 60 fps', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(0.001)
  })

  // 30 fps is where sub-frame takeoff earns its keep: sampling the parabola at
  // the first airborne frame instead would cost about 5 cm here.
  //
  // Bound is 1.3 cm, not 1 cm, and that is a recorded limitation, not a
  // target: takeoffPhase 0.1 measures 1.0386 cm (~25% headroom below 1.3),
  // caused by flightPhase's extendBoundary boundary-classification lag, not
  // by the crossing fit — the quadratic fit finds the exact correct root
  // (matching truth to 10+ significant figures) but it lands just outside
  // the clamp bounds set by the coarse airborne-threshold boundary and gets
  // discarded in favour of the linear fallback. The other four phases here
  // measure at machine zero (~1e-13 cm), so this is a single-phase artifact
  // of frame classification, not a general accuracy limit of the fit.
  it('lands within 1.3 cm at 30 fps, wherever takeoff falls inside the frame', () => {
    for (const takeoffPhase of [0.1, 0.35, 0.5, 0.75, 0.95]) {
      const result = analyseJump(
        generateJump({ ...BASE, fps: 30, takeoffPhase }).frames, VIDEO
      )!
      expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1.3)
    }
  })

  it('gives the same answer for the same clip every time', () => {
    const clip = generateJump(BASE)
    const a = analyseJump(clip.frames, VIDEO)!
    const b = analyseJump(clip.frames, VIDEO)!
    expect(a.comHeightCm).toBe(b.comHeightCm)
  })

  // Bound is 0.001 cm, not 1 cm, for the same reason as the 60 fps test
  // above: this sweep is evidence the systematic bias is gone across jump
  // heights, not merely small. Measured worst case here: 2.98e-13 cm.
  // Reverting the quadratic crossing fit measures 0.6426-0.7363 cm across
  // this same sweep (worst at the smallest, 20 cm, jump) — comfortably
  // caught by this bound, not by the old 1 cm one.
  it('holds across a range of jump heights, within 0.001 cm', () => {
    for (const jumpHeightM of [0.2, 0.35, 0.5, 0.7, 0.9]) {
      const result = analyseJump(generateJump({ ...BASE, jumpHeightM }).frames, VIDEO)!
      expect(Math.abs(result.comHeightCm - jumpHeightM * 100)).toBeLessThan(0.001)
    }
  })
})

describe('acceptance: why the segment model was necessary', () => {
  // Bound is 1.5 cm, not 1 cm, and that is a recorded limitation, not a
  // target: measures 1.2067 cm (~24% headroom below 1.5), down from 2.6441cm
  // before flightPhase's crossing fit was switched from linear to quadratic.
  // Cause: once the tuck begins, the foot stops being ballistic (it is being
  // pulled by muscle, not just gravity), while the takeoff-crossing fit still
  // models it as ballistic — a modelling mismatch at the edge frames.
  //
  // No rSquared assertion here (there was one; it was removed, not weakened).
  // The generator places each airborne pose BY COM, using the same Dempster
  // mass table centreOfMass itself uses (see syntheticJumper.ts), so the com
  // track lies exactly on its own least-squares parabola by construction —
  // rSquared is provably 1.0 at every tuck depth, not measured to be so, and
  // no regression short of a numerically degenerate fit could move it. The
  // paired test below is what actually proves the segment model matters:
  // the hip midpoint's rSquared genuinely differs from the com's, because
  // the two use different position formulas — a comparison this test cannot
  // make since it only ever looks at one side of it.
  it('stays accurate when the athlete tucks their legs', () => {
    const result = analyseJump(generateJump({ ...BASE, tuckM: 0.25 }).frames, VIDEO)!
    expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1.5)
  })

  // The hip midpoint owes nothing to the Dempster table, so this comparison
  // is meaningful even though the generator and centreOfMass share that table.
  it('would be wrong on the same jump if the hip midpoint stood in for the com', () => {
    const clip = generateJump({ ...BASE, tuckM: 0.35 })
    const track = buildComTrack(clip.frames, VIDEO)
    const outcome = findFlightPhase(track)
    if (outcome.kind !== 'found') throw new Error(`expected 'found', got '${outcome.kind}'`)
    const phase = outcome.phase
    const from = phase.takeoffFrame + 1
    const to = phase.landingFrame - 1

    const comResult = analyseJump(clip.frames, VIDEO)!
    const hipY = clip.frames.map(
      (f) => ((f.landmarks[LM.LEFT_HIP]!.y + f.landmarks[LM.RIGHT_HIP]!.y) / 2) * VIDEO.height
    )
    const hipFit = fitParabola(track.times.slice(from, to), hipY.slice(from, to))!
    const t = phase.takeoffTime
    const hipHeightCm =
      ((hipFit.c0 + hipFit.c1 * t + hipFit.c2 * t * t - hipFit.yApex) / hipFit.scalePxPerM) * 100

    // The robust claims first: the hip trajectory is measurably less ballistic
    // than the com trajectory, and the scale it implies is wrong.
    expect(hipFit.rSquared).toBeLessThan(comResult.rSquared)
    expect(Math.abs(hipFit.scalePxPerM - 400)).toBeGreaterThan(10)
    // Then the consequence the user would actually see.
    expect(Math.abs(hipHeightCm - 50)).toBeGreaterThan(2)
  })
})

describe('acceptance: noise and failure modes', () => {
  // Distributional, not a worst-of-N draw: a single seed from this
  // heavy-tailed error distribution is a weak assertion on its own — on the
  // exact 5 seeds below, reverting EITHER production fix in this PR still
  // measures under the old 1 cm bound's replacement value (2.4393 cm and
  // 2.7518 cm respectively, against the shipped pipeline's 2.7618 cm), so a
  // worst-of-5 bound would not have caught either regression. Measured over
  // 50 seeds at sigma 0.005 (the shipped pipeline): mean error 1.2021 cm,
  // 28 of 50 seeds (56%) under 1 cm, worst observed 4.821 cm. The two bounds
  // below carry ~25-27% headroom over the shipped mean and under-1cm count.
  //
  // Cause of the residual: propagated landmark variance at the point of
  // peak sensitivity in the pipeline — flightPhase's takeoff crossing is
  // worth about 3.1 mm of reported height per millisecond of timing error,
  // and noiseSigma 0.005 puts real jitter into that estimate. Whether
  // noiseSigma 0.005 itself reflects real MediaPipe landmark scatter is an
  // open question for PR-C to measure.
  //
  // RE-MEASURED, and the fixture below it is the one that now carries the
  // argument. This one has no leg tuck, and that turned out to matter more
  // than anything else this comment used to discuss: a takeoff-edge fit
  // window that reaches further forward keeps improving on a tuck-free
  // parabola and starts fitting muscle instead of gravity on a real one.
  // Tuning against this fixture alone therefore pushes the window in exactly
  // the wrong direction for real footage, where every vertical jump tucks.
  //
  // Measured across the takeoff fit window, 50 seeds at sigma 0.005, mean
  // error on each fixture (window: no-tuck / tucked):
  //   4 -> 2.356 / 1.179     6 -> 1.567 / 1.416
  //   5 -> 1.888 / 1.242     7 -> 1.317 / 1.536
  // The two orderings are opposite. The window is set from the tucked
  // column.
  //
  // Current pipeline on the two fixtures: no-tuck mean 2.356, 13 of 50 under
  // 1 cm; tucked mean 1.179, 25 of 50. The pipeline before the local-floor
  // and clamp fixes measured almost the mirror image — no-tuck 1.202 and 28
  // of 50, tucked 2.326 and 8 of 50 — i.e. it was twice as accurate on the
  // fixture that omits the tuck and half as accurate on the one that has it.
  it('keeps tuck-free landmark-noise error to a 2.9 cm mean across 50 seeds at sigma 0.005', () => {
    const errors: number[] = []
    for (let seed = 1; seed <= 50; seed++) {
      const result = analyseJump(
        generateJump({ ...BASE, noiseSigma: 0.005, seed }).frames, VIDEO
      )!
      errors.push(Math.abs(result.comHeightCm - 50))
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    // 2.356 measured, 23% headroom. A drift alarm on an unrepresentative
    // fixture — deliberately loose, because tightening it would pull the fit
    // window the wrong way. The assertion that constrains the window is the
    // tucked one below.
    expect(mean).toBeLessThan(2.9)
    expect(errors.filter((e) => e < 1).length).toBeGreaterThanOrEqual(10)
  })

  // The fixture that represents a real vertical jump: landmark noise AND the
  // leg tuck every jumper does on the way up. This is the assertion that
  // governs the takeoff fit window.
  it('keeps tucked landmark-noise error to a 1.5 cm mean, half the draws under 1 cm', () => {
    const errors: number[] = []
    for (let seed = 1; seed <= 50; seed++) {
      const result = analyseJump(
        generateJump({ ...BASE, noiseSigma: 0.005, tuckM: 0.25, seed }).frames, VIDEO
      )!
      errors.push(Math.abs(result.comHeightCm - 50))
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    const under1cm = errors.filter((e) => e < 1).length
    // 1.179 measured (27% headroom); the pre-fix pipeline measures 2.326
    // here and 8 under 1 cm, so both bounds catch a revert of it.
    expect(mean).toBeLessThan(1.5)
    expect(under1cm).toBeGreaterThanOrEqual(20)
  })

  // Was timeScale: 2 (1.277s apparent flight against the 1.5s
  // MAX_FLIGHT_SECONDS cap — only 14.9% headroom). That headroom mattered
  // more than it looked: findFlightPhase used to reject any run over the cap
  // outright, before the stature check below ever ran, so a timeScale that
  // stayed under the cap never actually exercised the interaction between
  // the two — this test was, unknowingly, only ever testing the stature
  // check on an ordinary-length run. timeScale: 8 (5.108s apparent flight,
  // 3.4x the cap) is the design's actual motivating case — a 240fps clip
  // saved and played back as 30fps — and is comfortably past where the OLD
  // code fell back to a bare "no jump found" with no analysis and no reason
  // at all. See the k x jumpHeightM sweep below for the general case.
  it('catches baked-in slow motion through an impossible stature, well past the duration cap', () => {
    const result = measureJump(generateJump({ ...BASE, timeScale: 8 }).frames, VIDEO)
    expect(result.analysis).not.toBeNull()
    expect(result.verdict.kind).toBe('unusable')
    expect(result.verdict.kind === 'unusable' && result.verdict.reason).toBe('slow-motion')
    expect(result.analysis!.statureM).toBeGreaterThan(2.2)
  })

  it('inflates both methods by the same factor under slow motion, so they still agree', () => {
    // This is the cross-check's blind spot, pinned down as a test so nobody
    // later mistakes agreement between the two methods for correctness.
    const result = analyseJump(generateJump({ ...BASE, timeScale: 2 }).frames, VIDEO)!
    const relative = Math.abs(result.comHeightCm - result.flightTimeHeightCm) / result.comHeightCm
    expect(relative).toBeLessThan(0.1)
    expect(result.comHeightCm).toBeGreaterThan(150)
  })

  // Important 2 (final whole-branch review): findFlightPhase used to reject
  // any airborne run over MAX_FLIGHT_SECONDS outright, so the stature-band
  // slow-motion check below could never run on the case that actually
  // motivated it — a saved slow-motion clip, which is exactly what pushes
  // duration past the cap in the first place. Measured before this fix (see
  // the fix report for the full before/after table): at jumpHeightM 0.5,
  // k=2 (1.277s) and k=2.4 (1.533s) were correctly diagnosed 'slow-motion',
  // but k=3 and above returned a null analysis and a generic failure — the
  // highest surviving k fell with jump height (about 3.15 at 0.3m, 2.40 at
  // 0.5m, 2.00 at 0.7m, since a smaller true flight time leaves more k
  // headroom under the fixed 1.5s cap). After the fix, findFlightPhase still
  // resolves the phase and tags it 'too-long' instead of discarding it, so
  // the stature check runs regardless of duration: every cell below,
  // including k=8 — an order of magnitude past the cap, and the 240fps-saved-
  // as-30fps case that motivated the whole check — comes back diagnosed.
  it('diagnoses slow motion across a k x jump-height grid, including well past the old duration cliff', () => {
    const ks = [2, 3, 4, 6, 8]
    const jumpHeightsM = [0.3, 0.5, 0.7]
    for (const jumpHeightM of jumpHeightsM) {
      for (const k of ks) {
        const clip = generateJump({ ...BASE, jumpHeightM, timeScale: k })
        const result = measureJump(clip.frames, VIDEO)
        expect(result.verdict.kind, `h=${jumpHeightM}, k=${k}`).toBe('unusable')
        expect(
          result.verdict.kind === 'unusable' && result.verdict.reason,
          `h=${jumpHeightM}, k=${k}`
        ).toBe('slow-motion')
      }
    }
  })
})

describe('acceptance: a small apparent-scale wobble during the approach', () => {
  // approachScaleRatio's drift model only moves the athlete's scale ABOVE a
  // fixed floor line (see syntheticJumper.ts) -- it does not move footY
  // itself, unlike a real running approach (see realClipFixture.test.ts,
  // built from real MediaPipe output where footY genuinely drifts). Because
  // computeFootY medians six foot landmarks and four of them (heel, toe) sit
  // exactly on that fixed floor line regardless of scale, findFlightPhase's
  // rolling fallback can never engage via this generator option, at any
  // ratio or approach length -- confirmed by sweeping 30+ parameter
  // combinations during planning. This test is NOT a proof that the rolling
  // mechanism survives a running approach end-to-end; that proof is
  // realClipFixture.test.ts. This test only pins that a mild apparent-scale
  // change (camera micro-jitter, a slight lens wobble) doesn't regress the
  // ordinary, global-path measurement.
  it('does not disturb an ordinary measurement under a mild scale wobble', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 1.15, standFrames: 90 })
    const result = measureJump(clip.frames, VIDEO)
    expect(result.verdict.kind).toBe('ok')
    expect(Math.abs(result.analysis!.comHeightCm - 50)).toBeLessThan(1)
  })
})
