# Whole-Clip COM-Slope Marker Guess Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse-then-narrow-window frame scheduler in `usePoseDetection.ts` with one linear full-clip pass, and add a new, independent detector that scans the whole clip for the steepest rise/fall in centre of mass to seed a rough Takeoff/Landing marker guess.

**Architecture:** `usePoseDetection.ts` analyzes every frame of the clip in a single pass instead of two. A new pure function in `src/lib/comSlope.ts` scans the resulting `ComTrack` for the sharpest normalized centre-of-mass slope and proposes a rough `{ takeoffTime, landingTime }`. This guess only feeds marker seeding in `useMeasurement.ts` — `measureJump`/`findFlightPhase`/`assess` (the whole existing measurement and verdict system) are untouched.

**Tech Stack:** Vue 3 Composition API, TypeScript strict mode, Vitest.

## Global Constraints

- TypeScript strict mode: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — use `import type` for type-only imports.
- `src/lib/**` must stay pure: no DOM, no browser APIs, no non-determinism (`Math.random`, `Date.now`).
- Never add a `Co-Authored-By` trailer to any commit.
- Baseline: 190 tests passing (`npm test` from repo root), `npx vue-tsc -b` clean.
- `src/composables/**` is not covered by automated tests (project policy) — verification there is `npx vue-tsc -b` plus manual browser testing.
- Design doc: `docs/2026-08-05-com-slope-marker-guess-design.md` — read for full rationale; this plan implements it task by task.

---

### Task 1: `guessFlightWindow` — the pure slope detector

**Files:**
- Create: `src/lib/comSlope.ts`
- Test: `src/lib/comSlope.test.ts`

**Interfaces:**
- Consumes: `ComTrack` from `./comTrack` (`times: number[]`, `comY: number[]`, `spans: number[]` — all same length), `rollingPercentile` from `./stats`, `NOSE_HEIGHT_FRACTION`/`STANDING_PERCENTILE` from `./comTrack`, `ROLLING_WINDOW_SECONDS`/`MIN_ROLLING_POINTS` from `./flightPhase`.
- Produces: `export interface SlopeGuess { takeoffTime: number; landingTime: number }`, `export function guessFlightWindow(track: ComTrack): SlopeGuess | null`. Task 2 imports both.

- [ ] **Step 1: Write the failing test**

Create `src/lib/comSlope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { guessFlightWindow } from './comSlope'
import { buildComTrack } from './comTrack'
import { REAL_CLIP_FRAMES, REAL_CLIP_VIDEO } from './testing/realClipFixture'
import type { ComTrack } from './comTrack'

/** A hand-built track: comY only matters here, footY/staturePx are unused by guessFlightWindow. */
function track(comY: number[], fps = 60): ComTrack {
  return {
    times: comY.map((_, i) => i / fps),
    comY,
    footY: comY.map(() => 0),
    staturePx: 500,
    spans: comY.map(() => 450),
  }
}

describe('guessFlightWindow', () => {
  it('finds a clean rise then fall', () => {
    const stand = Array.from({ length: 30 }, () => 1000)
    const rise = [1000, 940, 860, 760, 660]
    const flight = Array.from({ length: 15 }, () => 660)
    const fall = [660, 760, 860, 940, 1000]
    const land = Array.from({ length: 30 }, () => 1000)
    const guess = guessFlightWindow(track([...stand, ...rise, ...flight, ...fall, ...land]))
    expect(guess).not.toBeNull()
    // 60fps: frame index = time * 60. Takeoff lands inside the rise block
    // (index 30-34), landing at the end of the fall block (index 50).
    expect(Math.round(guess!.takeoffTime * 60)).toBe(31)
    expect(Math.round(guess!.landingTime * 60)).toBe(50)
  })

  it('returns null on a flat clip with only landmark-noise-scale wobble', () => {
    // +/-2px wobble against comY~1000 -- far below any real jump's
    // displacement, but still nonzero. Without an absolute sharpness floor,
    // the search would still return the least-flat point in this noise as
    // a "candidate", which is wrong.
    const flat = Array.from({ length: 60 }, (_, i) => 1000 + (i % 3))
    expect(guessFlightWindow(track(flat))).toBeNull()
  })

  it('returns null when the track is too short to compute a slope', () => {
    expect(guessFlightWindow(track([1000]))).toBeNull()
    expect(guessFlightWindow(track([]))).toBeNull()
  })

  it('picks the sharper of two rises in the same clip', () => {
    const stand = Array.from({ length: 20 }, () => 1000)
    const smallRise = [1000, 980, 960]
    const smallFlight = Array.from({ length: 10 }, () => 960)
    const smallFall = [960, 980, 1000]
    const mid = Array.from({ length: 20 }, () => 1000)
    const bigRise = [1000, 900, 800, 700]
    const bigFlight = Array.from({ length: 10 }, () => 700)
    const bigFall = [700, 800, 900, 1000]
    const end = Array.from({ length: 20 }, () => 1000)
    const guess = guessFlightWindow(
      track([...stand, ...smallRise, ...smallFlight, ...smallFall, ...mid, ...bigRise, ...bigFlight, ...bigFall, ...end])
    )
    expect(guess).not.toBeNull()
    // The big rise block starts at index 56 (20+3+10+3+20). The small rise
    // must NOT win even though it comes first.
    expect(Math.round(guess!.takeoffTime * 60)).toBe(56)
    expect(Math.round(guess!.landingTime * 60)).toBe(70)
  })

  it('finds a plausible, short flight window on the real clip that motivated this feature', () => {
    // No known ground truth for this clip (same caveat as
    // realClipFixture.test.ts) -- this pins that the guess is at least
    // physically plausible, not a specific timestamp. The floor-threshold
    // approach this feature sits alongside found a ~2+ second window on
    // this exact data (run-up included, see the running-approach-jump
    // design doc and 2026-08-05-com-slope-marker-guess-design.md); this is
    // the acid test that the new signal does meaningfully better.
    const guess = guessFlightWindow(buildComTrack(REAL_CLIP_FRAMES, REAL_CLIP_VIDEO))
    expect(guess).not.toBeNull()
    expect(guess!.landingTime - guess!.takeoffTime).toBeLessThan(1.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/comSlope.test.ts`
Expected: FAIL — `Cannot find module './comSlope'` (the file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/comSlope.ts`:

```ts
import { rollingPercentile } from './stats'
import { NOSE_HEIGHT_FRACTION, STANDING_PERCENTILE, type ComTrack } from './comTrack'
import { ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS } from './flightPhase'

/**
 * A rough takeoff/landing guess to seed the manual markers with -- not a
 * measurement. Whoever calls this is expected to let the person correct it;
 * see docs/2026-08-05-com-slope-marker-guess-design.md section 3.3.
 */
export interface SlopeGuess {
  takeoffTime: number
  landingTime: number
}

/**
 * Half-width, in seconds, of the central-difference window used to smooth
 * the frame-to-frame comY slope. Frame-to-frame alone is too noisy --
 * landmark jitter between two adjacent frames can exceed a real jump's own
 * per-frame displacement. Starting value, not a measured optimum.
 */
const SLOPE_WINDOW_SECONDS = 0.1
/** Below this many samples in the smoothing window, the slope at that index is unusable. */
const MIN_SLOPE_WINDOW_POINTS = 3
/**
 * Below this many stature-fractions per second, even the single sharpest
 * slope in the clip is ordinary noise, not a jump -- without this floor,
 * a perfectly flat clip with only landmark jitter still returns SOME
 * candidate, because the search only ever compares slopes to each other,
 * never to an absolute "is this actually sharp" bar. Starting value, not a
 * measured optimum: a real countermovement jump's push-off displaces the
 * com several tenths of a stature over a few tenths of a second, an order
 * of magnitude above ordinary landmark jitter.
 */
const MIN_TAKEOFF_SLOPE = 0.3
/**
 * How large the landing's positive slope must be, relative to the
 * magnitude of the takeoff's negative slope, to count as the matching
 * landing rather than noise. Physically a landing impact is roughly as
 * abrupt as the push-off that started the flight, so this is relative to
 * the takeoff's own slope, not an independent absolute threshold. Starting
 * value, not a measured optimum.
 */
const LANDING_SLOPE_FRACTION = 0.5

/**
 * Scans the whole clip for the steepest normalized rise in centre of mass
 * (takeoff) and the next comparably steep fall after it (landing).
 * Normalized by a rolling stature estimate (the same rollingPercentile
 * machinery findFlightPhase's own rolling fallback uses) rather than a
 * fixed reference, so a clip where the athlete's distance to the camera
 * changes does not bias the comparison toward whichever part of the clip
 * happens to be closest to the camera.
 *
 * Deliberately does not know about MAX_FLIGHT_SECONDS, floor levels, or
 * plausibility checks -- those all belong to findFlightPhase/assess, which
 * this function's result never touches. See
 * docs/2026-08-05-com-slope-marker-guess-design.md section 3.3.
 */
export function guessFlightWindow(track: ComTrack): SlopeGuess | null {
  const { times, comY, spans } = track
  if (times.length < 2 || times.length !== comY.length || times.length !== spans.length) return null

  const staturePx = rollingPercentile(times, spans, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, STANDING_PERCENTILE)
    .map((span) => (span === null ? null : span / NOSE_HEIGHT_FRACTION))

  // Smoothed, normalized slope at each index: central difference over
  // SLOPE_WINDOW_SECONDS, in stature-fractions per second. comY grows
  // downward, so a negative slope is a real-world rise (jumping) and a
  // positive slope is a real-world fall (landing).
  const slope: (number | null)[] = times.map((t, i) => {
    let lo = i
    while (lo > 0 && t - times[lo - 1]! < SLOPE_WINDOW_SECONDS / 2) lo--
    let hi = i
    while (hi < times.length - 1 && times[hi + 1]! - t < SLOPE_WINDOW_SECONDS / 2) hi++
    if (hi - lo < MIN_SLOPE_WINDOW_POINTS - 1) return null
    const dt = times[hi]! - times[lo]!
    if (!(dt > 0)) return null
    const s = staturePx[i]
    if (s === null || !(s > 0)) return null
    return (comY[hi]! - comY[lo]!) / dt / s
  })

  let takeoffIndex = -1
  let takeoffSlope = 0
  for (let i = 0; i < slope.length; i++) {
    const v = slope[i]
    if (v !== null && v < takeoffSlope) {
      takeoffSlope = v
      takeoffIndex = i
    }
  }
  if (takeoffIndex === -1 || -takeoffSlope < MIN_TAKEOFF_SLOPE) return null

  const landingThreshold = -takeoffSlope * LANDING_SLOPE_FRACTION
  let landingIndex = -1
  for (let i = takeoffIndex + 1; i < slope.length; i++) {
    const v = slope[i]
    if (v !== null && v > landingThreshold) {
      landingIndex = i
      break
    }
  }
  if (landingIndex === -1) return null

  return { takeoffTime: times[takeoffIndex]!, landingTime: times[landingIndex]! }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/comSlope.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npx vitest run`
Expected: 195 tests passing (190 baseline + 5 new).

```bash
git add src/lib/comSlope.ts src/lib/comSlope.test.ts
git commit -m "Add a whole-clip COM-slope detector for a rough takeoff/landing guess"
```

---

### Task 2: One linear pass in `usePoseDetection.ts`, wired to the new guess

**Files:**
- Modify: `src/composables/usePoseDetection.ts`
- Delete: `src/lib/framePlan.ts`, `src/lib/framePlan.test.ts`

**Interfaces:**
- Consumes: `guessFlightWindow`, `type SlopeGuess` from `../lib/comSlope` (Task 1). `buildComTrack` from `../lib/comTrack` (already exists, exported, used internally by `measureJump` — this task calls it directly too since `measureJump` doesn't expose its internal `ComTrack`).
- Produces: the composable's returned object gains a new field `guess: Ref<SlopeGuess | null>`. Task 3 consumes this.

`src/lib/framePlan.ts` is used nowhere except `usePoseDetection.ts` and its own test — confirmed via `grep -rn "framePlan" src/`. Safe to delete both files once this task removes the only call sites.

- [ ] **Step 1: Remove the two-pass scheduling imports, add the new ones**

In `src/composables/usePoseDetection.ts`, find these import lines near the top of the file:

```ts
import { planCoarsePass, planFinePass } from '../lib/framePlan'
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, FLOOR_PERCENTILE } from '../lib/flightPhase'
import { STANDING_PERCENTILE } from '../lib/comTrack'
import { rollingMedian, rollingPercentile } from '../lib/stats'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../lib/poseTypes'
```

Replace with:

```ts
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { buildComTrack } from '../lib/comTrack'
import { guessFlightWindow, type SlopeGuess } from '../lib/comSlope'
import { LANDMARK_COUNT, type Landmark, type PoseFrame } from '../lib/poseTypes'
```

(`ROLLING_WINDOW_SECONDS`, `MIN_ROLLING_POINTS`, `FLOOR_PERCENTILE`, `STANDING_PERCENTILE`, `rollingMedian`, `rollingPercentile`, and `LM` were used only inside `classify`/`airborneIndices`, deleted in Step 3 below — removing them here now avoids an unused-import error once that code is gone. `LANDMARK_COUNT`, `type Landmark`, `type PoseFrame` are still used elsewhere in this file, e.g. `toPoseFrame`.)

- [ ] **Step 2: Delete the now-unused `COARSE_AIRBORNE_FRACTION` constant**

Find:

```ts
/** A foot this far above the clip's floor level counts as airborne. */
const COARSE_AIRBORNE_FRACTION = 0.02
```

Delete this block entirely (it was used only inside `classify`, deleted next).

- [ ] **Step 3: Delete `classify`, `airborneIndices`, and `dedupeByTime`; add `planFullPass`, add the `guess` ref**

Find the `classify` function through the end of `dedupeByTime` — this is one contiguous block:

```ts
  function classify(
    footY: number[], floor: (i: number) => number, stature: (i: number) => number
  ): number[] {
    const indices: number[] = []
    for (let i = 0; i < footY.length; i++) {
      const s = stature(i)
      if (!(s > 0)) continue
      if (floor(i) - footY[i]! > COARSE_AIRBORNE_FRACTION * s) indices.push(i)
    }
    return indices
  }

  /**
   * Which coarse samples had a foot clear of the clip's floor level.
   *
   * A deliberately crude cousin of `findFlightPhase` — it only has to say
   * roughly where to look closer, so it skips the sub-frame work entirely.
   *
   * Global floor/stature first, exactly as before this fallback existed.
   * Rolling is tried only if the global pass finds nothing, or finds a
   * stretch that runs to the very last coarse sample without coming back
   * down — the same failure shape flightPhase.ts's own rolling fallback
   * exists for (see its docstring): the athlete's distance to the camera
   * changed during the clip, so the whole-clip floor no longer describes
   * "standing" anywhere past where it was measured. See the
   * running-approach-jump design doc.
   */
  function airborneIndices(coarse: PoseFrame[]): number[] {
    if (coarse.length === 0) return []
    const footY = coarse.map((f) =>
      Math.max(
        f.landmarks[LM.LEFT_HEEL]!.y, f.landmarks[LM.RIGHT_HEEL]!.y,
        f.landmarks[LM.LEFT_FOOT_INDEX]!.y, f.landmarks[LM.RIGHT_FOOT_INDEX]!.y
      )
    )
    const noseY = coarse.map((f) => f.landmarks[LM.NOSE]!.y)
    const spans = footY.map((y, i) => y - noseY[i]!)

    const sorted = [...footY].sort((a, b) => a - b)
    const globalFloor = sorted[Math.min(sorted.length - 1, Math.round(FLOOR_PERCENTILE * (sorted.length - 1)))]!
    // Deliberately a different statistic than the rolling pass below
    // (max vs. a percentile) -- this composable is a coarse heuristic for
    // where to sample densely, not the final measurement (see
    // findFlightPhase for that), and changing this to match would be a
    // behavior change, not a naming cleanup.
    const globalStature = Math.max(...spans)
    // A degenerate detection (nose at or below foot level in every frame)
    // sends the threshold to zero or negative, which then reads nearly every
    // sample as airborne — measured: 50 of 50 fine-pass seeks, roughly six
    // times the detector calls, before the pipeline downstream correctly
    // refuses the result anyway. Refuse to flag anything here instead, on
    // either pass — a nose reading at or below the foot is not something a
    // rolling window fixes.
    if (!(globalStature > 0)) return []

    const globalIndices = classify(footY, () => globalFloor, () => globalStature)
    if (globalIndices.length > 0 && globalIndices[globalIndices.length - 1]! < footY.length - 1) {
      return globalIndices
    }

    const times = coarse.map((f) => f.time)
    const rollingFloor = rollingMedian(times, footY, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS)
    const rollingStature = rollingPercentile(times, spans, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, STANDING_PERCENTILE)
    const rollingIndices = classify(
      footY,
      (i) => rollingFloor[i] ?? globalFloor,
      (i) => rollingStature[i] ?? globalStature
    )
    return rollingIndices.length > 0 ? rollingIndices : globalIndices
  }

  /**
   * Two seeks can land on the same decoded frame — the fine pass schedules at
   * the nominal frame period, which drifts from the real one. Duplicated
   * timestamps would feed the same sample to the fit twice, quietly weighting
   * it double.
   */
  function dedupeByTime(collected: PoseFrame[]): PoseFrame[] {
    const seen = new Set<number>()
    const unique: PoseFrame[] = []
    for (const frame of collected) {
      const key = Math.round(frame.time * 1e6)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(frame)
    }
    return unique
  }
```

Replace this entire block with:

```ts
  /**
   * Every playback instant to sample, once per frame across the whole clip.
   * Multiplies (n * step) instead of accumulating (t += step) to avoid
   * floating-point drift on a long clip — the same technique the old
   * two-pass scheduler's planCoarsePass used, kept when that file was
   * deleted (see docs/2026-08-05-com-slope-marker-guess-design.md).
   */
  function planFullPass(duration: number, fps: number): number[] {
    if (!(duration > 0) || !(fps > 0)) return []
    const step = 1 / fps
    const times: number[] = []
    for (let n = 0; n * step < duration; n++) times.push(n * step)
    return times
  }
```

(`dedupeByTime` is not replaced with anything — a single linear pass produces one strictly increasing, non-duplicate time list by construction, unlike the old two-pass merge of a coarse and a fine schedule.)

Now find the ref declarations near the top of the composable function body:

```ts
  const status = ref<DetectionStatus>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)
  const result = ref<{ analysis: JumpAnalysis | null; verdict: Verdict } | null>(null)
  const scatter = ref<LandmarkScatter | null>(null)
  const frames = ref<PoseFrame[]>([])
```

Add one more ref immediately after:

```ts
  const status = ref<DetectionStatus>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)
  const result = ref<{ analysis: JumpAnalysis | null; verdict: Verdict } | null>(null)
  const scatter = ref<LandmarkScatter | null>(null)
  const frames = ref<PoseFrame[]>([])
  const guess = ref<SlopeGuess | null>(null)
```

- [ ] **Step 4: Reset `guess` alongside the other run-start state**

Find (inside `run()`, right before the run actually starts scanning):

```ts
    error.value = null
    result.value = null
    scatter.value = null
    frames.value = []
    progress.value = 0
    status.value = 'loading'
```

Replace with:

```ts
    error.value = null
    result.value = null
    scatter.value = null
    frames.value = []
    guess.value = null
    progress.value = 0
    status.value = 'loading'
```

- [ ] **Step 5: Update the `planCoarsePass` reference in the duration guard's comment**

Find:

```ts
      // `duration` reads `Infinity` for a freshly recorded MediaRecorder
      // WebM in Chrome until the file has been seeked to the end at least
      // once. `planCoarsePass`'s loop would never terminate against that,
      // and — being synchronous — that hang is unreachable by cancel(), the
      // abort signal, or the seek timeout. Refuse it outright.
```

Replace with:

```ts
      // `duration` reads `Infinity` for a freshly recorded MediaRecorder
      // WebM in Chrome until the file has been seeked to the end at least
      // once. `planFullPass`'s loop would never terminate against that,
      // and — being synchronous — that hang is unreachable by cancel(), the
      // abort signal, or the seek timeout. Refuse it outright.
```

- [ ] **Step 6: Replace the two-pass scan with one linear pass, wire in the guess**

Find:

```ts
      const rate = fps.value > 0 ? fps.value : 60
      const coarseTimes = planCoarsePass(video.duration, rate)
      const coarse = await scan(video, detector, coarseTimes, signal, isCurrent, (done) => {
        progress.value = (done / coarseTimes.length) * 0.5
      })

      const fineTimes = planFinePass(coarseTimes, airborneIndices(coarse), video.duration, rate)
      const fine = fineTimes.length === 0
        ? []
        : await scan(video, detector, fineTimes, signal, isCurrent, (done) => {
            progress.value = 0.5 + (done / fineTimes.length) * 0.5
          })

      if (!isCurrent()) return

      const all = dedupeByTime([...coarse, ...fine].sort((a, b) => a.time - b.time))
      frames.value = all
      scatter.value = estimateScatter(all)
      result.value = measureJump(all, { width: video.videoWidth, height: video.videoHeight })
      progress.value = 1
      status.value = 'done'
```

Replace with:

```ts
      const rate = fps.value > 0 ? fps.value : 60
      const allTimes = planFullPass(video.duration, rate)
      const all = await scan(video, detector, allTimes, signal, isCurrent, (done) => {
        progress.value = done / allTimes.length
      })

      if (!isCurrent()) return

      frames.value = all
      scatter.value = estimateScatter(all)
      const videoSize = { width: video.videoWidth, height: video.videoHeight }
      result.value = measureJump(all, videoSize)
      guess.value = guessFlightWindow(buildComTrack(all, videoSize))
      progress.value = 1
      status.value = 'done'
```

- [ ] **Step 7: Expose `guess` from the composable**

Find the return statement at the end of the composable:

```ts
  return { status, progress, error, result, scatter, frames, run, cancel }
```

Replace with:

```ts
  return { status, progress, error, result, scatter, frames, guess, run, cancel }
```

- [ ] **Step 8: Delete `framePlan.ts` and its test**

```bash
rm src/lib/framePlan.ts src/lib/framePlan.test.ts
```

- [ ] **Step 9: Verify — full suite, typecheck, no unused imports**

Run: `npx vitest run`
Expected: 187 tests passing (195 after Task 1, minus the 8 tests in `src/lib/framePlan.test.ts` deleted in Step 8 — that file is removed, not replaced, since the two-pass scheduler it tested no longer exists). `usePoseDetection.ts` itself is a composable and not covered by automated tests, so this task adds none.

Run: `npx vue-tsc -b`
Expected: clean, no errors — this is what catches an unused import or a missed reference (e.g. `airborneIndices`) left dangling.

- [ ] **Step 10: Commit**

```bash
git add src/composables/usePoseDetection.ts
git rm src/lib/framePlan.ts src/lib/framePlan.test.ts
git commit -m "Replace the two-pass frame scheduler with one linear whole-clip pass"
```

---

### Task 3: Seed markers from the new guess

**Files:**
- Modify: `src/composables/useMeasurement.ts`

**Interfaces:**
- Consumes: `pose.guess` (`Ref<SlopeGuess | null>`, produced by Task 2).

- [ ] **Step 1: Change what the auto-seed watch reads from**

In `src/composables/useMeasurement.ts`, find:

```ts
  // Auto-detect gives a starting point but never overrides a mark the person
  // placed themselves — only fills in whichever side is still empty, and
  // never seeds a side that would invalidate the OTHER already-set mark via
  // useMarkers' own out-of-order clearing (setTakeoff/setLanding each null
  // the opposite mark if the new time would put them out of order).
  watch(analysis, (result) => {
    if (!result) return
    const takeoff = markers.takeoffTime.value
    const landing = markers.landingTime.value
    const canSeedTakeoff = takeoff === null && (landing === null || result.takeoffTime < landing)
    const canSeedLanding = landing === null && (takeoff === null || result.landingTime > takeoff)
    if (canSeedTakeoff) markers.setTakeoff(result.takeoffTime)
    if (canSeedLanding) markers.setLanding(result.landingTime)
  })
```

Replace with:

```ts
  // Auto-detect gives a starting point but never overrides a mark the person
  // placed themselves — only fills in whichever side is still empty, and
  // never seeds a side that would invalidate the OTHER already-set mark via
  // useMarkers' own out-of-order clearing (setTakeoff/setLanding each null
  // the opposite mark if the new time would put them out of order).
  //
  // Seeded from the whole-clip COM-slope guess (pose.guess), not from
  // measureJump's own analysis.takeoffTime/landingTime: that candidate
  // comes from findFlightPhase's floor/threshold search, which on a hard
  // real clip can land inside the run-up rather than the actual jump (see
  // docs/2026-08-05-com-slope-marker-guess-design.md section 3.3).
  // measureJump keeps computing its own candidate independently either way
  // — this only changes where the initial markers land, not the
  // measurement itself.
  watch(pose.guess, (guess) => {
    if (!guess) return
    const takeoff = markers.takeoffTime.value
    const landing = markers.landingTime.value
    const canSeedTakeoff = takeoff === null && (landing === null || guess.takeoffTime < landing)
    const canSeedLanding = landing === null && (takeoff === null || guess.landingTime > takeoff)
    if (canSeedTakeoff) markers.setTakeoff(guess.takeoffTime)
    if (canSeedLanding) markers.setLanding(guess.landingTime)
  })
```

- [ ] **Step 2: Verify — full suite, typecheck**

Run: `npx vitest run`
Expected: 187 tests passing, unchanged from the end of Task 2 (this composable is not covered by automated tests).

Run: `npx vue-tsc -b`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/composables/useMeasurement.ts
git commit -m "Seed markers from the whole-clip slope guess instead of measureJump's own candidate"
```

---

### Task 4: Full revalidation and manual browser check

**Files:** none changed — this is verification.

- [ ] **Step 1: Full automated suite**

Run: `npm test`
Expected: PASS, 187 tests total (190 baseline + 5 from Task 1 − 8 removed with `framePlan.test.ts` in Task 2).

- [ ] **Step 2: Types and build**

Run: `npx vue-tsc -b`
Expected: clean.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check in the browser on the real motivating clip**

Run: `npm run dev -- --host`

Load the real running-approach clip (`1.mp4` from earlier debugging in this project's history, if available locally) and click "Найти прыжок автоматически". Check:

1. The auto-placed Takeoff/Landing markers land close to the actual jump in the video — scrub to where they land and confirm visually it's the real push-off/landing, not a moment during the run-up. (Task 1's real-clip test pins the guess at roughly 2.70s/3.67s on the exact fixture data used in this repo's tests — the live browser run may differ slightly since it now analyzes every frame instead of the fixture's saved 104, but should land in the same neighborhood; if it's clearly wrong, don't touch `comSlope.ts`'s constants blindly — extract the actual `comY`/slope values via a temporary `console.log` in `guessFlightWindow` the same way earlier sessions debugged `findFlightPhase`, and look at the real numbers before changing anything.)
2. The pose skeleton overlay is now visible through the whole clip, not just around the detected jump (the side effect described in the design doc section 3.4) — scrub to a point well before the jump and confirm the skeleton draws there too.
3. Processing time for a clip of a few seconds is still reasonable (a few seconds to run, not tens of seconds) — full-clip dense analysis does more MediaPipe calls than the old two-pass scheme, this just confirms it hasn't become unusably slow on ordinary clip lengths.
4. Load an ordinary, non-drifting jump clip (any short vertical-jump video without a running approach) and confirm the auto-detect still places sensible markers and shows a height — this is the regression check that ordinary clips aren't worse off.

- [ ] **Step 4: Record the outcome**

No commit for this task (nothing changes). If Step 3 finds a real problem, that becomes a new, separately-scoped fix — not a same-task patch to already-committed code from Tasks 1-3.
