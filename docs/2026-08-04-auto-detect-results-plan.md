# Auto-detect results: markers, verdict and error margins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful "Найти прыжок автоматически" run, seed the empty takeoff/landing markers from the pipeline's own timing and let the existing `ResultsCard` show the pipeline's verdict, its center-of-mass cross-check, and its technical details — replacing the raw monospace debug block in `App.vue`.

**Architecture:** `useMeasurement.ts` gains a watcher that fills whichever marker is still `null` from `analysis.takeoffTime`/`landingTime`, plus a computed `autoDetectInfo` that bundles `{ analysis, verdict, scatter, framesParsed }` — `null` unless the current marks still land on the exact frames the analysis measured. `ResultsCard.vue` takes that bundle as one new nullable prop and renders three new, purely additive sections. `App.vue`'s debug block shrinks to the button, progress bar, and (only when there is no `analysis` to show a card for) a one-line refusal message.

**Tech Stack:** Vue 3 (Composition API, `<script setup>`), TypeScript, Vitest, Tailwind CSS.

## Global Constraints

- Auto-detect never overwrites an already-set marker — it only fills a side that is currently `null` (design doc 3.2).
- `analysis.errorCm` must never be rendered to the user, in any form — the pipeline's own source comment says it understates the true error by ~7x on average and must not be shown as a confidence interval (design doc 3.4, `jumpFromCom.ts:16-49`). The only error margin ever shown stays `useJumpCalculation.ts`'s existing ±0.5-frame quantization margin.
- The pipeline-derived sections of `ResultsCard` (verdict banner, center-of-mass cross-check, details) must disappear the instant the marked frames diverge from `analysis.takeoffTime`/`analysis.landingTime` — compared by frame number, not raw seconds (design doc 3.5).
- Markers are still seeded from `analysis` even when `verdict.kind === 'unusable'`, as long as `analysis` itself is non-null (design doc 3.3). Only the three `unusable` reasons that carry `analysis: null` (`no-flight`, `short-flight`, `degenerate-fit`) leave the markers untouched.
- Only `src/lib/**` is unit-tested in this project; composables and components are not (design doc 6, matches existing project policy stated in `docs/2026-08-03-pose-overlay-design.md` §8-9).
- All user-facing verdict text stays the existing Russian strings from `jumpFromCom.ts` — no new copy, no i18n layer.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/frameTiming.ts` | Add `sameFrame(a, b, fps)` — the one piece of new logic with real edge cases, so it's the one piece that gets a unit test. |
| `src/lib/frameTiming.test.ts` | Tests for `sameFrame`. |
| `src/composables/useMeasurement.ts` | Watcher that seeds empty markers from `analysis`. Computed `autoDetectInfo` that gates the pipeline-derived UI on marks still matching `analysis`. |
| `src/components/ResultsCard.vue` | New `autoDetect` prop. Three new template sections: verdict banner, center-of-mass cross-check line, collapsible technical details. |
| `src/App.vue` | Debug block shrinks to button/progress/cancel/error. Both `ResultsCard` usages get the new `auto-detect` binding. |

---

## Task 1: `sameFrame` in `frameTiming.ts`

**Files:**
- Modify: `src/lib/frameTiming.ts`
- Test: `src/lib/frameTiming.test.ts`

**Interfaces:**
- Consumes: `frameAtTime(time: number, fps: number): number` (already in this file).
- Produces: `sameFrame(a: number, b: number, fps: number): boolean` — later tasks (Task 3) call this to decide whether the marked frames still match `analysis`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/frameTiming.test.ts`, after the existing `describe('timeAtFrame', ...)` block:

```ts
describe('sameFrame', () => {
  it('is true for two times inside the same frame', () => {
    expect(sameFrame(60 / 60, 60.4 / 60, 60)).toBe(true)
  })

  it('is false once the times land on different frames', () => {
    expect(sameFrame(60.4 / 60, 61.1 / 60, 60)).toBe(false)
  })

  it('agrees with frameAtTime on the read-back jitter case', () => {
    // 57.99996 frames reads back a hair short of frame 58 — see frameAtTime's
    // own test above. sameFrame must snap the same way frameAtTime does.
    const asReadBack = 57.99996 / 60
    expect(sameFrame(asReadBack, 58 / 60, 60)).toBe(true)
  })

  it('is true when both times are frame 0', () => {
    expect(sameFrame(0, 0, 60)).toBe(true)
  })
})
```

Update the import line at the top of the file:

```ts
import { frameAtTime, sameFrame, timeAtFrame } from './frameTiming'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- frameTiming`
Expected: FAIL — `sameFrame is not defined` / TypeScript error, since `sameFrame` doesn't exist yet.

- [ ] **Step 3: Implement `sameFrame`**

Add to `src/lib/frameTiming.ts`, after `timeAtFrame`:

```ts
/** Whether two playback times land on the same frame at this frame rate. */
export function sameFrame(a: number, b: number, fps: number): boolean {
  return frameAtTime(a, fps) === frameAtTime(b, fps)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- frameTiming`
Expected: PASS, all `sameFrame` and existing `frameAtTime`/`timeAtFrame` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/frameTiming.ts src/lib/frameTiming.test.ts
git commit -m "Add sameFrame, the frame-equality check auto-detect's marker match will use"
```

---

## Task 2: Seed markers and compute `autoDetectInfo` in `useMeasurement.ts`

**Files:**
- Modify: `src/composables/useMeasurement.ts`

**Interfaces:**
- Consumes: `sameFrame(a, b, fps): boolean` (Task 1). `markers.takeoffTime`/`markers.landingTime: Ref<number | null>`, `markers.setTakeoff`/`setLanding(time: number): void` (existing, `useMarkers.ts`). `pose.result: Ref<{ analysis: JumpAnalysis | null; verdict: Verdict } | null>`, `pose.scatter: Ref<LandmarkScatter | null>`, `pose.frames: Ref<PoseFrame[]>` (existing, `usePoseDetection.ts`). `analysis: ComputedRef<JumpAnalysis | null>` (existing, this file).
- Produces: `autoDetectInfo: ComputedRef<{ analysis: JumpAnalysis; verdict: Verdict; scatter: LandmarkScatter | null; framesParsed: number } | null>` — Task 4 passes this straight into `ResultsCard`'s new `autoDetect` prop.

No unit test for this task — composables aren't covered by this project's test suite (see Global Constraints). Verified in Task 5 by driving the real app.

- [ ] **Step 1: Add the import**

In `src/composables/useMeasurement.ts`, add to the top of the file:

```ts
import { sameFrame } from '../lib/frameTiming'
```

- [ ] **Step 2: Add the marker-seeding watcher**

Directly below the existing replay-start watcher (`watch(analysis, (result) => { if (result && canShowHeight.value) replay.start() })`), add:

```ts
  // Auto-detect gives a starting point but never overrides a mark the person
  // placed themselves — only fills in whichever side is still empty.
  watch(analysis, (result) => {
    if (!result) return
    if (markers.takeoffTime.value === null) markers.setTakeoff(result.takeoffTime)
    if (markers.landingTime.value === null) markers.setLanding(result.landingTime)
  })
```

- [ ] **Step 3: Add the `autoDetectInfo` computed**

Directly below the watcher just added (still above `const hasAnyMarker = ...`), add:

```ts
  // Non-null only while the current marks are still the exact frames this
  // analysis was measured on. If either mark has since been dragged, the
  // pipeline's numbers would describe a jump that isn't the one being
  // measured anymore, so they disappear rather than go stale.
  const autoDetectInfo = computed(() => {
    const result = pose.result.value
    const a = result?.analysis
    const takeoff = markers.takeoffTime.value
    const landing = markers.landingTime.value
    if (!a || !result || takeoff === null || landing === null) return null
    if (!sameFrame(takeoff, a.takeoffTime, fps.value)) return null
    if (!sameFrame(landing, a.landingTime, fps.value)) return null
    return {
      analysis: a,
      verdict: result.verdict,
      scatter: pose.scatter.value,
      framesParsed: pose.frames.value.length,
    }
  })
```

- [ ] **Step 4: Return `autoDetectInfo`**

In the function's `return` statement, add `autoDetectInfo` alongside the existing `hasAnyMarker`:

```ts
  return {
    fps,
    ...stepping,
    ...markers,
    ...calculation,
    pose,
    analysis,
    canShowHeight,
    replay,
    hasAnyMarker,
    autoDetectInfo,
  }
```

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: no new TypeScript errors. (This also runs `vue-tsc -b`, which will catch a mistyped `autoDetectInfo` shape even though the file itself has no unit test.)

- [ ] **Step 6: Commit**

```bash
git add src/composables/useMeasurement.ts
git commit -m "Seed empty takeoff/landing markers from auto-detect and expose autoDetectInfo"
```

---

## Task 3: `ResultsCard.vue` — verdict banner, cross-check, details

**Files:**
- Modify: `src/components/ResultsCard.vue`

**Interfaces:**
- Consumes: the `autoDetectInfo` shape produced in Task 2 — `{ analysis: JumpAnalysis; verdict: Verdict; scatter: LandmarkScatter | null; framesParsed: number } | null`. Types `JumpAnalysis`, `Verdict` from `../lib/jumpFromCom`; `LandmarkScatter` from `../lib/landmarkScatter`.
- Produces: a new prop `autoDetect` on `ResultsCard` — Task 4 wires `App.vue`'s `autoDetectInfo` into it.

No unit test — components aren't covered by this project's test suite. Verified in Task 5.

- [ ] **Step 1: Add type imports and the new prop**

In `src/components/ResultsCard.vue`, add below the existing `import { Share2, Trophy } from 'lucide-vue-next'` line:

```ts
import type { JumpAnalysis, Verdict } from '../lib/jumpFromCom'
import type { LandmarkScatter } from '../lib/landmarkScatter'
```

Add `autoDetect` to the `defineProps<{...}>()` block, after `newRecordDelta`:

```ts
  newRecordDelta: { value: number; unit: string } | null
  autoDetect: {
    analysis: JumpAnalysis
    verdict: Verdict
    scatter: LandmarkScatter | null
    framesParsed: number
  } | null
```

- [ ] **Step 2: Add the center-of-mass cross-check line**

In the `<template>`, directly after the flight-time paragraph (the block commented `<!-- 2. Flight time ... -->`) and before the fun-fact block (`<!-- 3. Fun fact ... -->`), add:

```vue
    <!-- Auto-detect's own estimate, shown as an independent cross-check -->
    <p v-if="autoDetect" class="text-center text-xs text-slate-500 mb-2">
      центр масс: {{ formatHeight(autoDetect.analysis.comHeightCm) }} см
    </p>
```

- [ ] **Step 3: Add the verdict banner**

Directly after the existing low-FPS warning block (the `<p v-if="fps <= 30" ...>` paragraph) and before the `<!-- 4. Secondary data ... -->` comment, add:

```vue
    <p
      v-if="autoDetect && 'message' in autoDetect.verdict"
      class="text-center text-xs mb-2"
      :class="autoDetect.verdict.kind === 'unusable' ? 'text-rose-400' : 'text-amber-400'"
    >
      ⚠ {{ autoDetect.verdict.message }}
    </p>
```

(`'message' in autoDetect.verdict` narrows the `Verdict` union the same way `App.vue`'s existing debug block already does — `kind === 'ok'` is the only variant without a `message` field.)

- [ ] **Step 4: Add the collapsible technical details**

Directly after the closing `</div>` of the `<!-- 4. Secondary data ... -->` grid and before the `<!-- 5. Share -->` comment, add:

```vue
    <!-- Auto-detect's own diagnostics, collapsed by default -->
    <details v-if="autoDetect" class="mt-2 pt-2 border-t border-surface-lighter/60 text-xs text-slate-500">
      <summary class="cursor-pointer select-none hover:text-slate-300">Подробности автодетекта</summary>
      <div class="mt-2 space-y-1 font-mono">
        <p>R² {{ autoDetect.analysis.rSquared.toFixed(4) }}</p>
        <p>рост {{ autoDetect.analysis.statureM.toFixed(2) }} м</p>
        <p>масштаб {{ autoDetect.analysis.scalePxPerM.toFixed(1) }} px/м</p>
        <p>кадров в полёте {{ autoDetect.analysis.flightFrames }}, разобрано {{ autoDetect.framesParsed }}</p>
        <p v-if="autoDetect.scatter">
          σ ландмарок {{ autoDetect.scatter.overall.toFixed(4) }}, стопы {{ autoDetect.scatter.feet.toFixed(4) }}
        </p>
      </div>
    </details>
```

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: no new TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ResultsCard.vue
git commit -m "Show auto-detect's verdict, center-of-mass cross-check and details on ResultsCard"
```

---

## Task 4: Wire `App.vue` — shrink the debug block, pass `autoDetectInfo` through

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `autoDetectInfo` from `useMeasurement()` (Task 2). `autoDetect` prop on `ResultsCard` (Task 3).

No unit test — this file isn't covered by this project's test suite. Verified in Task 5.

- [ ] **Step 1: Destructure `autoDetectInfo`**

In the `useMeasurement(...)` destructuring block, add `autoDetectInfo` after `hasAnyMarker`:

```ts
  replay,
  hasAnyMarker,
  autoDetectInfo,
} = useMeasurement(videoRef, isVideoLoaded, currentTime, duration, pause)
```

- [ ] **Step 2: Replace the debug block**

Replace this whole block (currently right after the `<p v-if="pose.status.value === 'cancelled'" ...>` line and before the closing `</div>` of the side-panel card):

```vue
            <div v-if="pose.result.value" class="mt-3 space-y-1 font-mono text-slate-300">
              <p class="text-base font-sans font-semibold text-white">
                {{ pose.result.value.verdict.kind === 'unusable'
                    ? 'измерить не удалось'
                    : pose.result.value.verdict.heightCm.toFixed(1) + ' см' }}
              </p>
              <p class="font-sans text-slate-400">
                {{ pose.result.value.verdict.kind }}<template v-if="'reason' in pose.result.value.verdict">
                · {{ pose.result.value.verdict.reason }}</template>
              </p>
              <p v-if="'message' in pose.result.value.verdict" class="font-sans text-slate-500">
                {{ pose.result.value.verdict.message }}
              </p>
              <template v-if="pose.result.value.analysis">
                <p>центр масс {{ pose.result.value.analysis.comHeightCm.toFixed(1) }} см</p>
                <p>flight-time {{ pose.result.value.analysis.flightTimeHeightCm.toFixed(1) }} см</p>
                <p>R² {{ pose.result.value.analysis.rSquared.toFixed(4) }}</p>
                <p>рост {{ pose.result.value.analysis.statureM.toFixed(2) }} м</p>
                <p>масштаб {{ pose.result.value.analysis.scalePxPerM.toFixed(1) }} px/м</p>
                <p>кадров в полёте {{ pose.result.value.analysis.flightFrames }}</p>
                <p>
                  отрыв {{ pose.result.value.analysis.takeoffTime.toFixed(3) }} с (кадр {{ frameAtTime(pose.result.value.analysis.takeoffTime, fps) }}),
                  приземление {{ pose.result.value.analysis.landingTime.toFixed(3) }} с (кадр {{ frameAtTime(pose.result.value.analysis.landingTime, fps) }})
                </p>
                <p>полёт {{ pose.result.value.analysis.flightTimeSeconds.toFixed(4) }} с</p>
                <p>±{{ pose.result.value.analysis.errorCm.toFixed(2) }} см (только фит)</p>
              </template>
              <p v-if="pose.scatter.value" class="text-amber-300">
                σ ландмарок {{ pose.scatter.value.overall.toFixed(4) }},
                стопы {{ pose.scatter.value.feet.toFixed(4) }}
              </p>
              <p v-else class="text-slate-500">недостаточно неподвижных кадров</p>
              <p class="text-slate-500">кадров разобрано {{ pose.frames.value.length }}</p>
            </div>
```

with:

```vue
            <p
              v-if="pose.result.value && !pose.result.value.analysis && 'message' in pose.result.value.verdict"
              class="mt-2 text-slate-400"
            >
              {{ pose.result.value.verdict.message }}
            </p>
```

(Every other case — `analysis` present, whatever the verdict — now shows entirely through `ResultsCard`'s new `autoDetect`-driven sections; nothing else needs to render here.)

- [ ] **Step 3: Drop the now-unused `frameAtTime` import**

`frameAtTime` was only used inside the block just deleted. In the imports at the top of `App.vue`, remove it:

```ts
import { frameAtTime } from './lib/frameTiming'
```

Check first with a search (`grep -n frameAtTime src/App.vue`) that no other use remains before deleting the import — if `npm run build` in Step 5 flags an unused import, that confirms it's safe to remove.

- [ ] **Step 4: Pass `autoDetectInfo` into both `ResultsCard` usages**

There are two `<ResultsCard ... />` usages (desktop panel and mobile section). In **both**, add `:auto-detect="autoDetectInfo"` alongside the existing `:new-record-delta="newRecordDelta"` prop:

```vue
              <ResultsCard
                v-if="hasValidMarkers"
                :display-height="displayHeight"
                :display-error="displayError"
                :flight-time="flightTimeSeconds"
                :takeoff-frame="takeoffFrame"
                :landing-frame="landingFrame"
                :fps="fps"
                :unit="unit"
                :jump-height-cm="jumpHeightCm"
                :new-record-delta="newRecordDelta"
                :auto-detect="autoDetectInfo"
                @set-unit="setUnit"
                @share="openShareCard"
              />
```

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: no TypeScript errors — in particular, no "unused import" error for `frameAtTime` (confirming Step 3 was correct) and no prop-mismatch error on either `ResultsCard` usage.

- [ ] **Step 6: Commit**

```bash
git add src/App.vue
git commit -m "Fold auto-detect's debug block into ResultsCard, wire autoDetectInfo through"
```

---

## Task 5: Manual verification in a real browser

**Files:** none — this task only drives the running app.

This project's testing policy excludes composables and components (Global Constraints), so this task is the only verification the marker-seeding watcher, the matching logic wired end-to-end, and the new `ResultsCard` sections get. Use the existing sample clips already in `.playwright-mcp/` — `jump-test.mp4` is a known-good clip that has been used for prior pose-pipeline manual QA.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (leave it running; note the printed local URL, typically `http://localhost:5173/jump-frame/`)

- [ ] **Step 2: Full auto-detect flow on a clean clip**

Using the Playwright MCP browser tools: navigate to the app, upload `.playwright-mcp/jump-test.mp4`, click "Найти прыжок автоматически", and wait for it to finish.

Verify:
- The takeoff/landing pins appear on the `Timeline` without touching Takeoff/Landing by hand.
- `ResultsCard` appears automatically (no manual marking needed) and shows a height with the existing `±` quantization error.
- If the verdict is `ok`: no warning banner, but the "центр масс: … см" cross-check line is visible, and "Подробности автодетекта" expands to show R², рост, масштаб, кадров, σ.
- If the verdict is `warn`: an amber banner with `verdict.message` appears above the secondary data grid, height still shows.
- Nowhere on the card does a number labelled with `errorCm`'s old "(только фит)" caveat appear — the only `±` on the card is the existing quantization margin next to the hero height.
- Take a screenshot of the resulting card for the record.

- [ ] **Step 3: Manual marker overrides the auto-detected one**

With the same clip and a landed measurement from Step 2, manually drag the takeoff (or landing) marker on the `Timeline` to a different frame.

Verify: the verdict banner, cross-check line, and "Подробности автодетекта" disclosure all disappear — `ResultsCard` falls back to showing exactly what it shows for a fully manual measurement (height + `±` error only).

- [ ] **Step 4: Auto-detect does not clobber a marker set first**

Reload the app, upload the clip again, manually click Takeoff at some arbitrary frame (without clicking Landing), then run "Найти прыжок автоматически".

Verify: the manually-set Takeoff marker's frame is unchanged after auto-detect finishes; only Landing gets filled in by the pipeline.

- [ ] **Step 5: `unusable`-with-analysis clip still gets markers and a refusal banner**

If a clip that reliably produces a `warn`/`unusable`-with-analysis verdict (e.g. `jump-portrait.mp4`, or the same clip played back at reduced quality) is available, run auto-detect on it.

Verify: markers still land on the pipeline's frames, `ResultsCard` still shows a height, and the banner is red (`text-rose-400`) with the specific `verdict.message` (e.g. "Похоже, видео в замедленной съёмке — результат недостоверен." or "Трекинг местами срывался — цифра приблизительная.").

If no such clip is readily available, skip this step and note it as unverified rather than guessing at the outcome.

- [ ] **Step 6: `unusable`-without-analysis clip shows the short refusal, not a stuck panel**

Upload `.playwright-mcp/not-a-video.txt` renamed to something the file picker accepts, or any clip with no visible jump, and run auto-detect.

Verify: no markers appear, no `ResultsCard`, just the one-line `verdict.message` (e.g. "Не нашли прыжок в этом видео.") under the button — the old multi-line debug dump is gone.

- [ ] **Step 7: Automated checks**

Run: `npm test`
Expected: all tests pass, including the new `sameFrame` tests from Task 1.

Run: `npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 8: Stop the dev server**

Close the Playwright browser session and stop the `npm run dev` process.
