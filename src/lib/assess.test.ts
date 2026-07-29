import { describe, it, expect } from 'vitest'
import { assess, measureJump, analyseJump, type QualityMetrics } from './jumpFromCom'
import { generateJump } from './testing/syntheticJumper'
import { LANDMARK_COUNT, type PoseFrame } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }

const GOOD: QualityMetrics = {
  rSquared: 0.999,
  flightFrames: 30,
  statureM: 1.8,
  comHeightCm: 50,
  flightTimeHeightCm: 52,
  tooLong: false,
}

describe('assess', () => {
  it('passes a clean measurement', () => {
    expect(assess(GOOD)).toEqual({ kind: 'ok', heightCm: 50 })
  })

  it('rejects a degenerate height before dividing by it', () => {
    expect(assess({ ...GOOD, comHeightCm: 0 })).toEqual({
      kind: 'unusable', reason: 'degenerate-fit', message: 'Не удалось измерить прыжок по этому видео.',
    })
    expect(assess({ ...GOOD, comHeightCm: -3 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, comHeightCm: NaN }).kind).toBe('unusable')
  })

  it('rejects a flight too short to fit a curve through', () => {
    const short = assess({ ...GOOD, flightFrames: 7 })
    expect(short.kind).toBe('unusable')
    expect(short.kind === 'unusable' && short.reason).toBe('short-flight')
    expect(assess({ ...GOOD, flightFrames: 8 }).kind).toBe('ok')
  })

  it('rejects a trajectory that is not ballistic', () => {
    const bad = assess({ ...GOOD, rSquared: 0.94 })
    expect(bad.kind).toBe('unusable')
    expect(bad.kind === 'unusable' && bad.reason).toBe('tracking-lost')
  })

  it('treats rSquared exactly at the unusable cutoff as usable (warn, not unusable)', () => {
    // MIN_USABLE_R_SQUARED is 0.95 and the guard is `<`, so 0.95 itself must
    // not fire it. It falls through to the MIN_CLEAN_R_SQUARED check next
    // (0.95 < 0.99), which does fire, so the expected result is 'warn', not
    // 'ok' — computed by hand: { kind: 'warn', heightCm: 50, reason: 'tracking-lost', message: ... }.
    expect(assess({ ...GOOD, rSquared: 0.95 })).toEqual({
      kind: 'warn',
      reason: 'tracking-lost',
      heightCm: 50,
      message: 'Трекинг местами срывался — цифра приблизительная.',
    })
  })

  it('treats rSquared exactly at the clean cutoff as clean (ok, not warn)', () => {
    // MIN_CLEAN_R_SQUARED is 0.99 and that guard is also `<`, so 0.99 itself
    // must not fire it. GOOD's method disagreement is |50-52|/50 = 0.04,
    // under the 0.2 cutoff, so the expected result is 'ok' — computed by
    // hand: { kind: 'ok', heightCm: 50 }.
    expect(assess({ ...GOOD, rSquared: 0.99 })).toEqual({ kind: 'ok', heightCm: 50 })
  })

  it('rejects an implausible stature and blames slow motion', () => {
    const tall = assess({ ...GOOD, statureM: 7.2 })
    expect(tall.kind).toBe('unusable')
    expect(tall.kind === 'unusable' && tall.message.length).toBeGreaterThan(0)
    expect(tall.kind === 'unusable' && tall.reason).toBe('slow-motion')
    expect(assess({ ...GOOD, statureM: 1.2 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, statureM: 1.3 }).kind).toBe('ok')
    expect(assess({ ...GOOD, statureM: 2.2 }).kind).toBe('ok')
  })

  it('warns when the fit is merely acceptable', () => {
    const verdict = assess({ ...GOOD, rSquared: 0.97 })
    expect(verdict.kind).toBe('warn')
    expect(verdict.kind === 'warn' && verdict.heightCm).toBe(50)
    expect(verdict.kind === 'warn' && verdict.reason).toBe('tracking-lost')
  })

  it('warns when the two methods disagree by more than a tenth', () => {
    // comHeightCm is 50, so the cutoff sits at 5 cm of disagreement.
    const disagree = assess({ ...GOOD, flightTimeHeightCm: 56 })
    expect(disagree.kind).toBe('warn')
    expect(disagree.kind === 'warn' && disagree.reason).toBe('pose-asymmetry')
    expect(assess({ ...GOOD, flightTimeHeightCm: 54 }).kind).toBe('ok')
    // Exactly at the cutoff passes — the comparison is strict.
    expect(assess({ ...GOOD, flightTimeHeightCm: 55 }).kind).toBe('ok')
    // The value the real clip that motivated this threshold produced: 58.7
    // com against 51.4 flight-time, 12.4% apart. The previous 0.2 passed it
    // as 'ok' while the takeoff was 3.5 frames early.
    expect(assess({ ...GOOD, comHeightCm: 58.7, flightTimeHeightCm: 51.4 }).kind).toBe('warn')
  })

  it('lets the earlier check win when two unusable-tier guards both fire', () => {
    // Both cases pair a bad stature (7.2m, itself enough to fail on its own)
    // with a second condition that ALSO fails at the unusable tier, so the
    // check that runs first is the only way to tell them apart. Asserting on
    // `kind` alone can't do that — both are 'unusable' either way — so this
    // asserts the message and reason, which are check-specific.

    // flightFrames (5, < 8) is checked before statureM, so its message/reason win.
    expect(assess({ ...GOOD, flightFrames: 5, statureM: 7.2 })).toEqual({
      kind: 'unusable',
      reason: 'short-flight',
      message: 'Слишком короткий полёт для анализа.',
    })

    // rSquared < 0.95 (here 0.5) is checked before statureM, so its message/reason win.
    expect(assess({ ...GOOD, rSquared: 0.5, statureM: 7.2 })).toEqual({
      kind: 'unusable',
      reason: 'tracking-lost',
      message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.',
    })
  })

  // Important 2/3 (final whole-branch review): the duration guard that used
  // to live inside findFlightPhase now only tags the outcome 'too-long' and
  // lets the pipeline keep going — assess is where a still-too-long run
  // finally gets refused. It runs right after the stature check (the more
  // specific 'slow-motion' diagnosis still gets first refusal), but BEFORE
  // both warn-tier checks — a post-wave regression had it running last,
  // after those two warns, which let them intercept it (see the two
  // ordering tests below).
  describe('the tooLong last-resort guard', () => {
    it('refuses an otherwise-clean measurement that ran longer than any human jump', () => {
      const verdict = assess({ ...GOOD, tooLong: true })
      expect(verdict).toEqual({
        kind: 'unusable',
        reason: 'tracking-lost',
        message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.',
      })
    })

    it('lets an earlier, more specific check win over tooLong', () => {
      // statureM 7.2 alone already fires 'slow-motion' — the far more common
      // real cause of an over-long run (see flightPhase's MAX_FLIGHT_SECONDS
      // docstring). tooLong being ALSO true must not steal that diagnosis:
      // the more specific check runs first and wins, exactly like the two
      // unusable-tier guards above.
      const verdict = assess({ ...GOOD, statureM: 7.2, tooLong: true })
      expect(verdict.kind).toBe('unusable')
      expect(verdict.kind === 'unusable' && verdict.reason).toBe('slow-motion')
    })

    it('does not fire when the run was not too long', () => {
      expect(assess({ ...GOOD, tooLong: false })).toEqual({ kind: 'ok', heightCm: 50 })
    })

    // Regression pin (post-wave fix): tooLong used to be checked LAST, after
    // both warn-tier checks, so either of them could intercept it before it
    // ever got a chance to fire. This is not an edge case — a lost tracker
    // (the failure this guard exists to catch, see MAX_FLIGHT_SECONDS's
    // docstring in flightPhase.ts) typically degrades rSquared into the
    // 0.95-0.99 band, not below 0.95, which is exactly the band the
    // warn-tier rSquared check below owns. Asserting the full verdict
    // (message included), not just `kind`: under the old, wrong ordering
    // these still returned SOME truthy-looking verdict (a 'warn', with its
    // own distinct kind and message) rather than erroring, so a `kind`-only
    // assertion on the WRONG kind would still read as a meaningful failure —
    // the risk here is specifically a correct-looking `kind: 'unusable'`
    // coming from the wrong branch, which only `message` (tied 1:1 to the
    // branch that produced it) pins precisely.
    it('wins the race against the warn-tier rSquared check, not just the unusable-tier one', () => {
      const verdict = assess({ ...GOOD, tooLong: true, rSquared: 0.97 })
      expect(verdict).toEqual({
        kind: 'unusable',
        reason: 'tracking-lost',
        message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.',
      })
    })

    it('wins the race against the method-disagreement warn check', () => {
      const verdict = assess({ ...GOOD, tooLong: true, flightTimeHeightCm: 61 })
      expect(verdict).toEqual({
        kind: 'unusable',
        reason: 'tracking-lost',
        message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.',
      })
    })
  })
})

describe('measureJump', () => {
  it('reports ok on a clean generated jump', () => {
    const result = measureJump(generateJump({
      jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height,
    }).frames, VIDEO)
    expect(result.analysis).not.toBeNull()
    expect(result.verdict.kind).toBe('ok')
  })

  it('reports unusable with no analysis when there is no jump in an empty clip', () => {
    const result = measureJump([], VIDEO)
    expect(result.analysis).toBeNull()
    expect(result.verdict.kind).toBe('unusable')
    expect(result.verdict.kind === 'unusable' && result.verdict.reason).toBe('no-flight')
  })

  it('reports no-flight, not a generic failure, when the feet never leave the floor', () => {
    const flat: PoseFrame[] = Array.from({ length: 30 }, (_, i) => ({
      time: i / 60,
      landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 })),
    }))
    const result = measureJump(flat, VIDEO)
    expect(result.analysis).toBeNull()
    expect(result.verdict.kind === 'unusable' && result.verdict.reason).toBe('no-flight')
  })

  // Important 3's "landing past the end of the clip" cause, exercised
  // end-to-end: the clip is cut off mid-flight (well before the generated
  // landing, still comfortably past takeoff), so findFlightPhase's airborne
  // run reaches the end of the data with nowhere to land. Before this fix
  // this and every other analyseJump-null cause surfaced as the same
  // generic "Не нашли прыжок" message; now it reports 'short-flight' — the
  // clip simply does not contain enough of the jump, same actionable
  // category as too few post-trim frames.
  it('reports short-flight when the clip is cut off before landing', () => {
    const clip = generateJump({
      jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height,
    })
    // takeoffTime ~0.325s (frame ~20), landingTime ~0.964s (frame ~58);
    // frame 45 is well inside the flight, comfortably before landing.
    const truncated = clip.frames.slice(0, 45)
    const result = measureJump(truncated, VIDEO)
    expect(result.analysis).toBeNull()
    expect(result.verdict.kind === 'unusable' && result.verdict.reason).toBe('short-flight')
  })

  // Minor (final whole-branch review): an empty `landmarks` array — what
  // MediaPipe emits when it detects no pose — used to throw a raw
  // `TypeError` out of buildComTrack, all the way through analyseJump, with
  // no verdict at all. measureJump's return type promises a UI-actionable
  // Verdict; it should never have an unlisted throw path. Both a
  // no-pose-at-all clip and one with an otherwise-good pose landmark count
  // are exercised, matching the two malformed shapes comTrack.test.ts pins
  // at the buildComTrack level.
  it('returns a verdict instead of throwing when every frame has empty landmarks', () => {
    const noPose: PoseFrame[] = Array.from({ length: 30 }, (_, i) => ({ time: i / 60, landmarks: [] }))
    expect(() => measureJump(noPose, VIDEO)).not.toThrow()
    const result = measureJump(noPose, VIDEO)
    expect(result.analysis).toBeNull()
    expect(result.verdict.kind).toBe('unusable')
  })

  it('returns a verdict instead of throwing when a frame has the wrong landmark count', () => {
    const clip = generateJump({
      jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height,
    })
    // Corrupt one mid-flight frame to 25 landmarks instead of 33 — a partial
    // detection, not a total dropout — mixed in with otherwise-good frames.
    const corrupted: PoseFrame[] = clip.frames.map((f, i) =>
      i === 30 ? { time: f.time, landmarks: f.landmarks.slice(0, 25) } : f
    )
    expect(() => measureJump(corrupted, VIDEO)).not.toThrow()
    const result = measureJump(corrupted, VIDEO)
    // Skipping one frame out of many should not necessarily fail the whole
    // measurement — the point of this test is the absence of a throw, not a
    // particular verdict kind.
    expect(result.verdict).toBeDefined()
  })
})

// Task 6 established a genuine failure regime in analyseJump: when the jump
// is tiny, the frame rate low and the noise high, the fitted parabola's
// vertex extrapolates outside the sampled window and the reported height
// comes out 20-90x too large (57-266cm reported for a 3cm true jump). No
// guard was added inside analyseJump itself, on the reasoning that assess()
// would catch every such case — flightFrames < 8 kills short-flight cases,
// rSquared < 0.95 kills bad fits under heavy noise, and the stature band
// kills absurd scales.
//
// Task 7's original sweep (60,000 synthetic clips: jumpHeightM 0.01-0.5m,
// fps 24-120, noiseSigma 0-0.01, tuckM 0-0.3, 10 seeds, 5 takeoff phases)
// found 1,087 cases where analyseJump reported a height more than 3x the
// generated truth. Every single one was caught by assess() as 'unusable' —
// none came back 'ok' or 'warn'. The closest call in that sweep was pinned
// as the fixture below.
//
// Two later, independently diagnosed fixes changed the pipeline's accuracy
// enough to move that fixture off its edge: flightPhase's sub-frame
// crossing went from a linear fit to a quadratic one, and comTrack's footY
// went from a maximum over six landmarks to their median. Under the current
// pipeline the original scenario no longer overshoots by 3x (it now
// measures 1.22x, comfortably non-pathological) and the fixture stopped
// exercising anything. Re-swept the same-shaped grid, 91,000 scenarios,
// against the current pipeline: 646 pathological cases (down from 1,087,
// consistent with the fixes), still zero survivors. A local refinement
// around the tightest continuous-guard margin found (~500 more scenarios,
// narrowing jumpHeightM/noiseSigma/tuckM/takeoffPhase around the region
// that produced it) narrowed the margin further; the new closest call is
// pinned below. The second test re-runs a smaller slice of the same grid so
// a future change that lets a pathological case slip through fails loudly;
// it needed no changes, since it re-derives its own grid fresh each run.
//
// Invalidated a third time, by the disagreement cutoff moving from 0.2 to
// 0.1: the pinned scenario stopped overshooting (39.72 cm against the 54 cm
// the assertion demanded) and again exercised nothing. Re-swept and
// re-pinned below — this time ranking
// candidates by the correct metric, which the two earlier re-pins got wrong
// (see the fixture's own comment). The recurrence is the point worth
// noticing: a fixture pinned to one scenario's exact numbers is invalidated
// by every accuracy improvement, and has now cost three re-pins. The second
// test, which re-derives its grid each run, has survived all three untouched.
describe('assess catches the parabola-extrapolation failure mode (Task 6)', () => {
  it('does not pass the closest near-miss found by the sweep', () => {
    // jumpHeightM 0.03, fps 30, noiseSigma 0.01, tuckM 0.1, seed 4,
    // takeoffPhase 0.8: reported height 9.49 cm against a 3 cm truth
    // (3.163x). Note the 3x assertion below clears by only 5% here — this
    // fixture sits near the pathological cutoff itself, which is what makes
    // it the closest call.
    //
    // "Closest" is now measured properly, which the previous two versions of
    // this fixture were not. Escaping requires passing EVERY guard, so a
    // case's distance from escaping is set by whichever failing guard is
    // FURTHEST from passing — the maximum, not the minimum. Ranking by the
    // rSquared margin alone (what the earlier sweeps did) picks cases that
    // are nowhere near escaping, because the guard with the thinnest margin
    // is rarely the binding one.
    //
    // Re-swept 50,000 scenarios against the current pipeline (disagreement
    // cutoff 0.1): 390 pathological, zero survivors. This case's failing
    // guards are flightFrames 6 (shortfall 0.25 of the 8-frame minimum),
    // rSquared 0.7840 (0.175 below its cutoff in relative terms) and
    // statureM 2.658 (0.208 above the 2.2 ceiling). Its worst guard is
    // therefore 0.25 away from passing, and no pathological case in the grid
    // came closer than that — a far wider margin than the 0.0398 the
    // previous fixture recorded, though the two numbers are not comparable,
    // being different metrics.
    //
    // Its disagreement is only 0.0158, i.e. the new 0.1 cutoff is NOT what
    // catches this one. That is expected: the disagreement guard exists for
    // mistimed takeoffs, not for the fit blowing up.
    const clip = generateJump({
      jumpHeightM: 0.03, scalePxPerM: 400, fps: 30,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height,
      noiseSigma: 0.01, tuckM: 0.1, seed: 4, takeoffPhase: 0.8,
    })
    const result = analyseJump(clip.frames, VIDEO)
    expect(result).not.toBeNull()
    const analysis = result!
    expect(analysis.comHeightCm).toBeGreaterThan(3 * 3)
    expect(assess({ ...analysis, tooLong: false }).kind).toBe('unusable')
  })

  it('never reports ok or warn when analyseJump overshoots the truth by more than 3x', () => {
    const jumpHeightsM = [0.01, 0.02, 0.03, 0.05, 0.08]
    const fpsValues = [24, 25, 30]
    const noiseSigmas = [0.003, 0.005, 0.007, 0.01]
    const tuckMs = [0, 0.1, 0.3]
    const seeds = [1, 2, 3, 4, 5]
    const takeoffPhases = [0.1, 0.5, 0.9]

    let pathologicalCount = 0
    const survivors: Array<{ params: Record<string, number>; ratio: number }> = []

    for (const jumpHeightM of jumpHeightsM) {
      for (const fps of fpsValues) {
        for (const noiseSigma of noiseSigmas) {
          for (const tuckM of tuckMs) {
            for (const seed of seeds) {
              for (const takeoffPhase of takeoffPhases) {
                const clip = generateJump({
                  jumpHeightM, scalePxPerM: 400, fps,
                  videoWidth: VIDEO.width, videoHeight: VIDEO.height,
                  noiseSigma, tuckM, seed, takeoffPhase,
                })
                const result = analyseJump(clip.frames, VIDEO)
                if (!result) continue
                const truthCm = jumpHeightM * 100
                if (!Number.isFinite(result.comHeightCm) || result.comHeightCm <= 0) continue
                const ratio = result.comHeightCm / truthCm
                if (ratio > 3) {
                  pathologicalCount++
                  const verdict = assess({ ...result, tooLong: false })
                  if (verdict.kind === 'ok' || verdict.kind === 'warn') {
                    survivors.push({ params: { jumpHeightM, fps, noiseSigma, tuckM, seed, takeoffPhase }, ratio })
                  }
                }
              }
            }
          }
        }
      }
    }

    // Sanity check on the test itself: this grid must actually provoke the
    // failure mode, or the assertion below would pass vacuously.
    expect(pathologicalCount).toBeGreaterThan(0)
    expect(survivors).toEqual([])
  })
})
