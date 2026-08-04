# Оверлей позы — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Нарисовать поверх видео скелет, центр тяжести, траекторию полёта и измеренную высоту — чтобы число, посчитанное по параболе ЦТ, можно было проверить глазами.

**Architecture:** Вся геометрия отрисовки — чистые функции в `src/lib/overlayGeometry.ts` под тестами; они берут границы полёта из уже готового `JumpAnalysis` и пересчитывают только трек и подгонку. `PoseOverlay.vue` — тонкий SVG, который проецирует готовые нормализованные координаты через `project()` и раскладывает по атрибутам. Измерительная логика уезжает из `App.vue` в `useMeasurement.ts`.

**Tech Stack:** Vue 3 (Composition API), Vite, TypeScript, Vitest, SVG.

**Спека:** `docs/2026-08-03-pose-overlay-design.md`.

## Global Constraints

- TypeScript strict. Включены `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` — никаких `enum` (только `as const` или union), никаких параметров-свойств конструктора, никаких неиспользуемых импортов.
- Наследуемый `@vue/tsconfig` включает `noUncheckedIndexedAccess` (значит `arr[i]` имеет тип `T | undefined`, и `!` в коде плана обязателен) и `verbatimModuleSyntax` (смешанные импорты значений и типов требуют инлайнового `type`).
- `src/lib/**` не импортирует Vue, не обращается к DOM, не вызывает `Math.random()` и `Date.now()`.
- Видео не покидает клиент.
- `vite.config.ts` задаёт `base`. Пути к ассетам — через `import.meta.env.BASE_URL`.
- Ось `y` растёт вниз. Все координаты, которые отдаёт `src/lib/overlayGeometry.ts`, — **нормализованные** (0..1), как их сообщает MediaPipe.
- В сообщениях коммитов **не добавлять** строки `Co-Authored-By`.
- Не запускать `git push`.
- Кроме одной строки в `jumpFromCom.ts` (добавить `export` к `EDGE_TRIM_FRAMES`, Task 2), ядро PR-B не трогать: `bodyModel.ts`, `comTrack.ts`, `flightPhase.ts`, `parabolaFit.ts`, `physics.ts`, `stats.ts`, `zoomMath.ts`.
- Базовая линия тестов на старте — **140**. Каждая задача сообщает фактическое число.

---

## Что уже готово и что этот план потребляет

```ts
// src/lib/poseTypes.ts
export interface Vec2 { x: number; y: number }
export type Landmark = Vec2
export interface PoseFrame { time: number; landmarks: Landmark[] }  // ровно 33
export interface VideoSize { width: number; height: number }
export const LM = { NOSE: 0, LEFT_SHOULDER: 11, /* … */ RIGHT_FOOT_INDEX: 32 } as const
export const LANDMARK_COUNT = 33

// src/lib/bodyModel.ts
export function centreOfMass(landmarks: Landmark[]): Vec2   // нормализованные координаты

// src/lib/comTrack.ts
export interface ComTrack { times: number[]; comY: number[]; footY: number[]; staturePx: number }
export function buildComTrack(frames: PoseFrame[], video: VideoSize): ComTrack
// ВАЖНО: пропускает кадры с landmarks.length !== LANDMARK_COUNT

// src/lib/parabolaFit.ts
export interface ParabolaFit {
  c0: number; c1: number; c2: number
  aPx: number; scalePxPerM: number; tApex: number; yApex: number
  rSquared: number; rmsResidualPx: number; n: number
}
export function fitParabola(times: number[], values: number[]): ParabolaFit | null

// src/lib/jumpFromCom.ts
export interface JumpAnalysis {
  comHeightCm: number; flightTimeHeightCm: number; flightTimeSeconds: number
  statureM: number; scalePxPerM: number; errorCm: number; rSquared: number
  flightFrames: number
  takeoffTime: number; landingTime: number
  takeoffSampleIndex: number; landingSampleIndex: number
}
export function measureJump(frames: PoseFrame[], video: VideoSize):
  { analysis: JumpAnalysis | null; verdict: Verdict }

// src/lib/testing/syntheticJumper.ts
export function generateJump(options: JumpOptions): SyntheticClip
// JumpOptions: { jumpHeightM, scalePxPerM, fps, videoWidth, videoHeight,
//                statureM?, standFrames?, tuckM?, noiseSigma?, timeScale?,
//                takeoffPhase?, seed? }
// SyntheticClip: { frames, truth: { jumpHeightM, scalePxPerM, statureM,
//                  takeoffTime, landingTime, flightTimeS, apparentFlightTimeS } }

// src/composables/useVideoZoom.ts
project(nx: number, ny: number): { x: number; y: number }
// читает реактивные box и state, поэтому вызов внутри computed отслеживает зум

// src/components/VideoPlayer.vue:66
<slot name="overlay" />   // внутри контейнера, вне CSS-трансформа
```

`takeoffSampleIndex` и `landingSampleIndex` индексируют массивы **`ComTrack`**, а не исходный `frames`. Это ключевой факт для Task 2.

---

### Task 1: Скелет и выбор кадра

**Files:**
- Create: `src/lib/overlayGeometry.ts`
- Create: `src/lib/overlayGeometry.test.ts`

**Interfaces:**
- Consumes: `centreOfMass` из `./bodyModel`; `LANDMARK_COUNT`, `LM`, типы `Landmark`, `PoseFrame`, `Vec2` из `./poseTypes`
- Produces: `BONES: readonly (readonly [number, number])[]`, `JOINTS: readonly number[]`, `SkeletonGeometry`, `buildSkeleton(landmarks: Landmark[]): SkeletonGeometry | null`, `findFrameAt(frames: PoseFrame[], time: number, maxGapSeconds: number): PoseFrame | null`

Скелет — это просто список пар индексов плюс раскладка ландмарок по ним. Отдельная задача, потому что здесь легко ошибиться молча: пара, ссылающаяся на индекс вне диапазона, даст `undefined` и линию в угол экрана, а дубль пары — двойную толщину на одной кости и разную на других.

`findFrameAt` живёт здесь же: это правило видимости из спеки (3.2), и оно арифметическое.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/overlayGeometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BONES, JOINTS, buildSkeleton, findFrameAt } from './overlayGeometry'
import { LANDMARK_COUNT, type Landmark, type PoseFrame } from './poseTypes'

/** 33 ландмарки, каждая со своими различимыми координатами. */
function fakeLandmarks(): Landmark[] {
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
    x: i / 100,
    y: 1 - i / 100,
  }))
}

describe('BONES', () => {
  it('references only real landmark indices', () => {
    for (const [a, b] of BONES) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(LANDMARK_COUNT)
      expect(b).toBeLessThan(LANDMARK_COUNT)
    }
  })

  it('never repeats a bone, in either direction', () => {
    const seen = new Set<string>()
    for (const [a, b] of BONES) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('never joins a landmark to itself', () => {
    for (const [a, b] of BONES) expect(a).not.toBe(b)
  })
})

describe('JOINTS', () => {
  it('is exactly the set of landmarks the bones touch', () => {
    const fromBones = new Set<number>()
    for (const [a, b] of BONES) {
      fromBones.add(a)
      fromBones.add(b)
    }
    expect([...JOINTS].sort((x, y) => x - y)).toEqual([...fromBones].sort((x, y) => x - y))
  })

  it('has no duplicates', () => {
    expect(new Set(JOINTS).size).toBe(JOINTS.length)
  })
})

describe('buildSkeleton', () => {
  it('places every bone on the landmarks it names', () => {
    const landmarks = fakeLandmarks()
    const skeleton = buildSkeleton(landmarks)!
    expect(skeleton.bones.length).toBe(BONES.length)
    BONES.forEach(([a, b], i) => {
      expect(skeleton.bones[i]!.a).toEqual({ x: landmarks[a]!.x, y: landmarks[a]!.y })
      expect(skeleton.bones[i]!.b).toEqual({ x: landmarks[b]!.x, y: landmarks[b]!.y })
    })
  })

  it('returns the centre of mass alongside the joints', () => {
    const skeleton = buildSkeleton(fakeLandmarks())!
    expect(skeleton.joints.length).toBe(JOINTS.length)
    expect(Number.isFinite(skeleton.com.x)).toBe(true)
    expect(Number.isFinite(skeleton.com.y)).toBe(true)
  })

  it('refuses a frame that is not a full pose', () => {
    expect(buildSkeleton([])).toBeNull()
    expect(buildSkeleton(fakeLandmarks().slice(0, 10))).toBeNull()
  })
})

describe('findFrameAt', () => {
  const frames: PoseFrame[] = [0, 0.1, 0.2, 0.3].map((time) => ({
    time,
    landmarks: fakeLandmarks(),
  }))

  it('returns the nearest frame within the gap', () => {
    expect(findFrameAt(frames, 0.19, 0.02)!.time).toBeCloseTo(0.2, 10)
    expect(findFrameAt(frames, 0.21, 0.02)!.time).toBeCloseTo(0.2, 10)
  })

  it('prefers the earlier frame when it is nearer', () => {
    expect(findFrameAt(frames, 0.12, 0.05)!.time).toBeCloseTo(0.1, 10)
  })

  it('returns null when the nearest frame is further than the gap', () => {
    expect(findFrameAt(frames, 0.15, 0.02)).toBeNull()
    expect(findFrameAt(frames, 5, 0.02)).toBeNull()
  })

  it('handles the ends of the clip', () => {
    expect(findFrameAt(frames, -1, 0.02)).toBeNull()
    expect(findFrameAt(frames, 0, 0.02)!.time).toBe(0)
    expect(findFrameAt(frames, 0.3, 0.02)!.time).toBeCloseTo(0.3, 10)
  })

  it('returns null for an empty clip', () => {
    expect(findFrameAt([], 0, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./overlayGeometry"`.

- [ ] **Step 3: Создать `src/lib/overlayGeometry.ts`**

```ts
import { centreOfMass } from './bodyModel'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type Vec2 } from './poseTypes'

/**
 * Which landmark pairs are drawn as bones.
 *
 * MediaPipe reports 33 landmarks; this list covers the ones the project names
 * in `LM`, which is every landmark that carries meaning for a jump. The face
 * mesh (eyes, ears, mouth) is deliberately absent: it adds a dozen points
 * around the head that tell a viewer nothing about a jump and turn the head
 * into a blob at small sizes.
 *
 * The nose connects to both shoulders rather than to a neck point, because
 * MediaPipe has no neck landmark and a synthetic midpoint would be the only
 * drawn element not backed by a measurement.
 */
export const BONES: readonly (readonly [number, number])[] = [
  [LM.NOSE, LM.LEFT_SHOULDER],
  [LM.NOSE, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.LEFT_WRIST, LM.LEFT_INDEX],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.RIGHT_WRIST, LM.RIGHT_INDEX],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL],
  [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL],
  [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
]

/** Every landmark some bone touches — the dots drawn on top of the lines. */
export const JOINTS: readonly number[] = (() => {
  const seen = new Set<number>()
  for (const [a, b] of BONES) {
    seen.add(a)
    seen.add(b)
  }
  return [...seen]
})()

export interface SkeletonGeometry {
  /** Bone endpoints, normalized, in the same order as {@link BONES}. */
  bones: { a: Vec2; b: Vec2 }[]
  /** Joint positions, normalized, in the same order as {@link JOINTS}. */
  joints: Vec2[]
  /** Body centre of mass for this frame, normalized. */
  com: Vec2
}

/**
 * Lays one pose out for drawing, or returns null if it is not a full pose.
 *
 * The null is not defensive padding: MediaPipe emits an empty landmark array
 * when it finds no one in the frame, and every index below assumes exactly
 * LANDMARK_COUNT entries.
 */
export function buildSkeleton(landmarks: Landmark[]): SkeletonGeometry | null {
  if (landmarks.length !== LANDMARK_COUNT) return null

  const bones = BONES.map(([from, to]) => ({
    a: { x: landmarks[from]!.x, y: landmarks[from]!.y },
    b: { x: landmarks[to]!.x, y: landmarks[to]!.y },
  }))
  const joints = JOINTS.map((index) => ({ x: landmarks[index]!.x, y: landmarks[index]!.y }))

  return { bones, joints, com: centreOfMass(landmarks) }
}

/**
 * The sampled pose nearest `time`, or null if none is closer than
 * `maxGapSeconds`.
 *
 * The gap is what makes the skeleton appear over the dense pass and nowhere
 * else, without anyone having to state where the dense pass ran. The coarse
 * pass samples every COARSE_STRIDE-th frame, so outside the flight window the
 * nearest pose is always several frames away and this returns null on its own.
 *
 * `frames` must be sorted by time — usePoseDetection sorts before publishing.
 */
export function findFrameAt(
  frames: PoseFrame[],
  time: number,
  maxGapSeconds: number
): PoseFrame | null {
  if (frames.length === 0) return null

  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (frames[mid]!.time < time) low = mid + 1
    else high = mid
  }

  let best = frames[low]!
  const previous = frames[low - 1]
  if (previous && Math.abs(previous.time - time) < Math.abs(best.time - time)) {
    best = previous
  }

  return Math.abs(best.time - time) <= maxGapSeconds ? best : null
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. Сообщите фактическое число — базовая линия 140.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/overlayGeometry.ts src/lib/overlayGeometry.test.ts
git commit -m "Lay out the skeleton and pick the pose nearest a given instant"
```

---

### Task 2: Геометрия полёта

**Files:**
- Modify: `src/lib/jumpFromCom.ts` (одна строка — добавить `export` к `EDGE_TRIM_FRAMES`)
- Modify: `src/lib/overlayGeometry.ts`
- Modify: `src/lib/overlayGeometry.test.ts`

**Interfaces:**
- Consumes: `buildComTrack` из `./comTrack`; `EDGE_TRIM_FRAMES`, тип `JumpAnalysis` из `./jumpFromCom`; `fitParabola` из `./parabolaFit`
- Produces: `FlightGeometry`, `buildFlightGeometry(frames: PoseFrame[], video: VideoSize, analysis: JumpAnalysis): FlightGeometry | null`

След ЦТ, парабола, уровень отрыва и вершина. Границы полёта **не пересчитываются** — берутся из `analysis`, поэтому подгонка выходит той же, что уже дала число.

Единственная тонкость, из-за которой эта задача отдельная: `buildComTrack` пропускает кадры с числом ландмарок ≠ 33, а `takeoffSampleIndex` индексирует массивы трека. Если построить след напрямую из `frames`, он сдвинется относительно параболы ровно на число битых кадров — и только на тех клипах, где MediaPipe местами терял позу. Отсюда фильтрация тем же условием и отдельный тест на это.

- [ ] **Step 1: Написать падающие тесты**

В `src/lib/overlayGeometry.test.ts` дополнить существующие импорты — `buildFlightGeometry`
добавить к тому, что уже импортируется из `./overlayGeometry`, а `VideoSize` к импорту из
`./poseTypes` (`LANDMARK_COUNT` там уже есть) — и добавить два новых импорта:

```ts
import { measureJump } from './jumpFromCom'
import { generateJump } from './testing/syntheticJumper'
```

Затем дописать в конец файла:

```ts
describe('buildFlightGeometry', () => {
  const video: VideoSize = { width: 1080, height: 1920 }
  const clip = generateJump({
    jumpHeightM: 0.5,
    scalePxPerM: 600,
    fps: 60,
    videoWidth: video.width,
    videoHeight: video.height,
  })
  const { analysis } = measureJump(clip.frames, video)

  it('has an analysis to work from', () => {
    expect(analysis).not.toBeNull()
  })

  it('recovers the same height the analysis reported', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    const riseCm =
      (((geometry.takeoffY - geometry.apexY) * video.height) / geometry.scalePxPerM) * 100
    expect(riseCm).toBeCloseTo(analysis!.comHeightCm, 6)
  })

  it('puts the apex above the takeoff level', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    // y grows downward, so "above" means a smaller y.
    expect(geometry.apexY).toBeLessThan(geometry.takeoffY)
  })

  it('samples the curve in increasing time order, spanning the flight', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    expect(geometry.curve.length).toBeGreaterThan(10)
    const ys = geometry.curve.map((p) => p.y)
    // The curve dips (y decreases) then rises again — one turning point only.
    const lowest = Math.min(...ys)
    const apexAt = ys.indexOf(lowest)
    expect(apexAt).toBeGreaterThan(0)
    expect(apexAt).toBeLessThan(ys.length - 1)
    expect(lowest).toBeCloseTo(geometry.apexY, 4)
  })

  it('draws a trail spanning takeoff to landing', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    expect(geometry.trail.length).toBeGreaterThan(5)
    for (const point of geometry.trail) {
      expect(point.x).toBeGreaterThan(0)
      expect(point.x).toBeLessThan(1)
      expect(point.y).toBeGreaterThan(0)
      expect(point.y).toBeLessThan(1)
    }
  })

  it('keeps the trail aligned with the curve when frames are malformed', () => {
    // Blank out a few poses early in the clip. buildComTrack skips them, so
    // sample indices shift — a trail built from `frames` directly would slide
    // out from under the parabola.
    const damaged = clip.frames.map((frame, i) =>
      i % 17 === 0 && i < 20 ? { time: frame.time, landmarks: [] } : frame
    )
    const damagedAnalysis = measureJump(damaged, video).analysis!
    const geometry = buildFlightGeometry(damaged, video, damagedAnalysis)!
    const riseCm =
      (((geometry.takeoffY - geometry.apexY) * video.height) / geometry.scalePxPerM) * 100
    expect(riseCm).toBeCloseTo(damagedAnalysis.comHeightCm, 6)
    expect(geometry.trail.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('returns null when the flight window is too short to fit', () => {
    const stub = { ...analysis!, takeoffSampleIndex: 10, landingSampleIndex: 12 }
    expect(buildFlightGeometry(clip.frames, video, stub)).toBeNull()
  })

  it('returns null on a degenerate video size', () => {
    expect(buildFlightGeometry(clip.frames, { width: 0, height: 0 }, analysis!)).toBeNull()
  })

  it('returns null on an empty clip', () => {
    expect(buildFlightGeometry([], video, analysis!)).toBeNull()
  })

  it('ignores frames that are not full poses without throwing', () => {
    const blanked = clip.frames.map((f) => ({
      time: f.time,
      landmarks: f.landmarks.slice(0, LANDMARK_COUNT - 1),
    }))
    expect(buildFlightGeometry(blanked, video, analysis!)).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `buildFlightGeometry is not a function` (или ошибка импорта `EDGE_TRIM_FRAMES`).

- [ ] **Step 3: Экспортировать `EDGE_TRIM_FRAMES`**

В `src/lib/jumpFromCom.ts` найти:

```ts
const EDGE_TRIM_FRAMES = 1
```

и заменить на:

```ts
export const EDGE_TRIM_FRAMES = 1
```

Комментарий над константой не трогать. Это единственная правка в ядре PR-B во всём плане: оверлей обязан обрезать окно ровно так же, как его обрезал расчёт, а собственная копия числа рано или поздно разойдётся.

- [ ] **Step 4: Дописать `src/lib/overlayGeometry.ts`**

Дополнить импорты сверху файла:

```ts
import { buildComTrack } from './comTrack'
import { EDGE_TRIM_FRAMES, type JumpAnalysis } from './jumpFromCom'
import { fitParabola } from './parabolaFit'
import type { VideoSize } from './poseTypes'
```

и добавить в конец файла:

```ts
/** How many points the drawn parabola is sampled into. */
const CURVE_SAMPLES = 48

export interface FlightGeometry {
  /** Sampled com positions from takeoff to landing, normalized. */
  trail: Vec2[]
  /** Points along the fitted parabola, normalized, in time order. */
  curve: Vec2[]
  /** Normalized y of the com at the sub-frame takeoff instant. */
  takeoffY: number
  /** Normalized y of the fitted apex. */
  apexY: number
  /** Pixels per metre from the fit — the caller needs it to label a distance. */
  scalePxPerM: number
}

/** Value of the piecewise-linear function (times → values) at `t`. */
function interpolate(times: number[], values: number[], t: number): number {
  const last = times.length - 1
  if (last < 0) return 0
  if (t <= times[0]!) return values[0] ?? 0
  if (t >= times[last]!) return values[last] ?? 0

  for (let i = 1; i <= last; i++) {
    const t1 = times[i]!
    if (t1 < t) continue
    const t0 = times[i - 1]!
    const v0 = values[i - 1]
    const v1 = values[i]
    if (v0 === undefined || v1 === undefined) return v1 ?? v0 ?? 0
    const span = t1 - t0
    return span === 0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / span
  }
  return values[last] ?? 0
}

/**
 * Everything about the flight that gets drawn: the com's measured path, the
 * parabola fitted through it, and the two levels the height is measured
 * between.
 *
 * The flight boundaries are NOT recomputed — they come from `analysis`, which
 * the caller already has. Feeding the fit the same sample indices the analysis
 * used makes the drawn curve the same curve the number came from, rather than
 * a second opinion that happens to agree today.
 *
 * The frames are filtered by the same rule `buildComTrack` applies, because
 * `analysis.takeoffSampleIndex` indexes the TRACK, not `frames`. Skipping that
 * filter slides the trail out from under the parabola by however many frames
 * MediaPipe failed to find a pose in — silently, and only on the clips where
 * it happened.
 */
export function buildFlightGeometry(
  frames: PoseFrame[],
  video: VideoSize,
  analysis: JumpAnalysis
): FlightGeometry | null {
  if (!(video.height > 0)) return null

  const usable = frames.filter((frame) => frame.landmarks.length === LANDMARK_COUNT)
  if (usable.length === 0) return null

  const track = buildComTrack(frames, video)

  const from = analysis.takeoffSampleIndex + EDGE_TRIM_FRAMES
  const to = analysis.landingSampleIndex - EDGE_TRIM_FRAMES
  if (to - from < 3) return null

  const fit = fitParabola(track.times.slice(from, to), track.comY.slice(from, to))
  if (!fit) return null

  // comTrack carries only the vertical component; the horizontal one is
  // needed to lay the trail across the frame, and is cheap to recover.
  const comX = usable.map((frame) => centreOfMass(frame.landmarks).x)

  const trail: Vec2[] = []
  for (let i = analysis.takeoffSampleIndex; i <= analysis.landingSampleIndex; i++) {
    const y = track.comY[i]
    const x = comX[i]
    if (y === undefined || x === undefined) continue
    trail.push({ x, y: y / video.height })
  }

  const span = analysis.landingTime - analysis.takeoffTime
  const curve: Vec2[] = []
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = analysis.takeoffTime + (span * i) / (CURVE_SAMPLES - 1)
    const yPx = fit.c0 + fit.c1 * t + fit.c2 * t * t
    curve.push({ x: interpolate(track.times, comX, t), y: yPx / video.height })
  }

  const t0 = analysis.takeoffTime
  const takeoffYPx = fit.c0 + fit.c1 * t0 + fit.c2 * t0 * t0

  return {
    trail,
    curve,
    takeoffY: takeoffYPx / video.height,
    apexY: fit.yApex / video.height,
    scalePxPerM: fit.scalePxPerM,
  }
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. Сообщите фактическое число.

- [ ] **Step 6: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add src/lib/overlayGeometry.ts src/lib/overlayGeometry.test.ts src/lib/jumpFromCom.ts
git commit -m "Build the flight overlay geometry from the analysis that produced the number"
```

---

### Task 3: Зум-контекст через provide/inject

**Files:**
- Create: `src/composables/zoomContext.ts`
- Modify: `src/components/VideoPlayer.vue`

**Interfaces:**
- Consumes: тип `Point` из `../lib/zoomMath`
- Produces: `ZoomContext { project(nx: number, ny: number): Point }`, `ZOOM_CONTEXT: InjectionKey<ZoomContext>`

Оверлей монтируется в слот `VideoPlayer`, то есть формально он ребёнок `App.vue`, а физически живёт внутри контейнера плеера. `provide`/`inject` — единственный способ передать ему `project` без того, чтобы `App.vue` таскал функцию через template-ref из одного своего ребёнка в другого.

Реактивность сохраняется сама: `project` читает `box.value` и `state.value` внутри себя, поэтому вызов из `computed` в оверлее отслеживает и зум, и ресайз.

- [ ] **Step 1: Создать `src/composables/zoomContext.ts`**

```ts
import type { InjectionKey } from 'vue'
import type { Point } from '../lib/zoomMath'

export interface ZoomContext {
  /**
   * Normalized frame coordinates (0..1) to pixels in the player container,
   * with the current zoom and pan applied.
   *
   * Reads the zoom refs on every call, so calling it inside a `computed`
   * makes that computed track zoom, pan and container resizes.
   */
  project: (nx: number, ny: number) => Point
}

/**
 * Lives in its own module rather than in VideoPlayer.vue so the overlay can
 * import the key without importing the player, which would make the two
 * components import each other.
 */
export const ZOOM_CONTEXT: InjectionKey<ZoomContext> = Symbol('zoom-context')
```

- [ ] **Step 2: Отдать контекст из `VideoPlayer.vue`**

В `src/components/VideoPlayer.vue`, в `<script setup>`:

Заменить строку импорта Vue:

```ts
import { ref, watch } from 'vue'
```

на:

```ts
import { provide, ref, watch } from 'vue'
```

Добавить после импорта `useVideoZoom`:

```ts
import { ZOOM_CONTEXT } from '../composables/zoomContext'
```

Заменить строку 41:

```ts
defineExpose({ zoomIn, zoomOut, resetZoom: reset, project, isZoomed })
```

на:

```ts
provide(ZOOM_CONTEXT, { project })

// zoomIn/zoomOut stay exposed: App.vue drives them from its keyboard handler,
// which is a parent reaching into its own direct child. Only `project` moved
// to provide/inject, because its consumer is a sibling mounted in the slot.
defineExpose({ zoomIn, zoomOut, resetZoom: reset, isZoomed })
```

- [ ] **Step 3: Проверить типы и сборку**

Run: `npx vue-tsc -b`
Expected: без ошибок. Если TypeScript ругается на неиспользуемый `project` — значит `provide` не добавлен.

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 4: Убедиться, что тесты не сломались**

Run: `npm test`
Expected: PASS, число из Task 2 без изменений.

- [ ] **Step 5: Проверить руками, что зум с клавиатуры цел**

Run: `npm run dev`

Загрузить видео, нажать `+` и `−`. Зум должен работать — это проверка того, что `defineExpose` не сломан.

- [ ] **Step 6: Коммит**

```bash
git add src/composables/zoomContext.ts src/components/VideoPlayer.vue
git commit -m "Hand the overlay its projection through provide, not a template ref"
```

---

### Task 4: Компонент оверлея

**Files:**
- Create: `src/components/PoseOverlay.vue`

**Interfaces:**
- Consumes: `ZOOM_CONTEXT` из `../composables/zoomContext`; `buildSkeleton`, `buildFlightGeometry`, `findFrameAt` из `../lib/overlayGeometry`; тип `JumpAnalysis` из `../lib/jumpFromCom`; типы `PoseFrame`, `VideoSize` из `../lib/poseTypes`
- Produces: компонент со свойствами `frames`, `analysis`, `videoSize`, `videoEl`, `fps`, `showHeight`

Тонкий по конструкции: вся арифметика уже в `src/lib/overlayGeometry.ts`, здесь остаётся проекция и раскладка по атрибутам. Если сюда просачивается вычисление — оно поехало не туда.

Собственный источник времени нужен потому, что `timeupdate` у `<video>` срабатывает около четырёх раз в секунду: на нём скелет при проигрывании отстанет на сотни миллисекунд и поедет относительно тела.

- [ ] **Step 1: Создать `src/components/PoseOverlay.vue`**

```vue
<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { ZOOM_CONTEXT } from '../composables/zoomContext'
import { buildFlightGeometry, buildSkeleton, findFrameAt } from '../lib/overlayGeometry'
import type { JumpAnalysis } from '../lib/jumpFromCom'
import type { PoseFrame, VideoSize } from '../lib/poseTypes'

const props = defineProps<{
  frames: PoseFrame[]
  analysis: JumpAnalysis | null
  videoSize: VideoSize
  videoEl: HTMLVideoElement | null
  fps: number
  /** False when the verdict says the metric scale cannot be trusted. */
  showHeight: boolean
}>()

const zoom = inject(ZOOM_CONTEXT, null)

/**
 * Playback time, tracked precisely enough to keep the skeleton on the body.
 *
 * `timeupdate` fires about four times a second, so driving the overlay from it
 * leaves the skeleton hundreds of milliseconds behind during playback. While
 * the video plays this follows `requestVideoFrameCallback` and reads the
 * `mediaTime` of the frame actually presented; while it is paused, seeking and
 * frame stepping come through the `seeked`/`timeupdate` path below.
 */
const time = ref(0)

let rafHandle: number | null = null
let rvfcHandle: number | null = null

/**
 * The element the callbacks below were registered against.
 *
 * Tracked separately from `props.videoEl` because by the time the watcher
 * tears the old element down, the prop already points at the new one — and
 * cancelling a frame callback on the wrong element leaves the old one firing
 * into a component that has moved on.
 */
let followed: HTMLVideoElement | null = null

function readCurrentTime() {
  const video = props.videoEl
  if (video) time.value = video.currentTime
}

function stopFollowing() {
  if (rvfcHandle !== null && followed && 'cancelVideoFrameCallback' in followed) {
    followed.cancelVideoFrameCallback(rvfcHandle)
  }
  if (rafHandle !== null) cancelAnimationFrame(rafHandle)
  rvfcHandle = null
  rafHandle = null
  followed = null
}

function follow() {
  const video = props.videoEl
  if (!video) return
  followed = video

  if ('requestVideoFrameCallback' in video) {
    rvfcHandle = video.requestVideoFrameCallback((_now, metadata) => {
      time.value = metadata.mediaTime
      if (!video.paused) follow()
    })
    return
  }

  // No rVFC: fall back to animation frames and currentTime. Sync is coarser,
  // the skeleton still tracks.
  rafHandle = requestAnimationFrame(() => {
    time.value = video.currentTime
    if (!video.paused) follow()
  })
}

watch(
  () => props.videoEl,
  (video, previous) => {
    stopFollowing()
    if (previous) {
      previous.removeEventListener('play', follow)
      previous.removeEventListener('pause', stopFollowing)
      previous.removeEventListener('seeked', readCurrentTime)
      previous.removeEventListener('timeupdate', readCurrentTime)
    }
    if (!video) return
    video.addEventListener('play', follow)
    video.addEventListener('pause', stopFollowing)
    video.addEventListener('seeked', readCurrentTime)
    video.addEventListener('timeupdate', readCurrentTime)
    readCurrentTime()
    if (!video.paused) follow()
  },
  { immediate: true }
)

onUnmounted(() => {
  stopFollowing()
  const video = props.videoEl
  if (!video) return
  video.removeEventListener('play', follow)
  video.removeEventListener('pause', stopFollowing)
  video.removeEventListener('seeked', readCurrentTime)
  video.removeEventListener('timeupdate', readCurrentTime)
})

/**
 * The pose to draw, or null. The one-frame gap is what confines the skeleton
 * to the dense pass: the coarse pass samples every sixth frame, so outside the
 * flight window nothing is ever this close.
 */
const pose = computed(() => {
  const rate = props.fps > 0 ? props.fps : 60
  return findFrameAt(props.frames, time.value, 1 / rate)
})

const skeleton = computed(() => {
  const frame = pose.value
  return frame ? buildSkeleton(frame.landmarks) : null
})

const flight = computed(() => {
  if (!props.analysis) return null
  return buildFlightGeometry(props.frames, props.videoSize, props.analysis)
})

/** Container pixels for a normalized point. */
function at(x: number, y: number) {
  return zoom ? zoom.project(x, y) : { x: 0, y: 0 }
}

const bones = computed(() =>
  (skeleton.value?.bones ?? []).map((bone) => {
    const a = at(bone.a.x, bone.a.y)
    const b = at(bone.b.x, bone.b.y)
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  })
)

const joints = computed(() => (skeleton.value?.joints ?? []).map((j) => at(j.x, j.y)))

const com = computed(() => {
  const point = skeleton.value?.com
  return point ? at(point.x, point.y) : null
})

const trail = computed(() => (flight.value?.trail ?? []).map((p) => at(p.x, p.y)))

const curvePath = computed(() => {
  const points = flight.value?.curve ?? []
  if (points.length < 2) return ''
  return points
    .map((p, i) => {
      const screen = at(p.x, p.y)
      return `${i === 0 ? 'M' : 'L'}${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`
    })
    .join(' ')
})

/**
 * Takeoff level and the height segment, in container pixels.
 *
 * The segment sits at a fixed inset from the right rather than at the apex's
 * own x, where it would be drawn straight through the athlete's body.
 */
const HEIGHT_SEGMENT_X = 0.88

const levels = computed(() => {
  const geometry = flight.value
  if (!geometry) return null
  const takeoff = at(0, geometry.takeoffY)
  const takeoffRight = at(1, geometry.takeoffY)
  const segmentTop = at(HEIGHT_SEGMENT_X, geometry.apexY)
  const segmentBottom = at(HEIGHT_SEGMENT_X, geometry.takeoffY)
  return {
    floorX1: takeoff.x,
    floorX2: takeoffRight.x,
    floorY: takeoff.y,
    segX: segmentTop.x,
    segY1: segmentTop.y,
    segY2: segmentBottom.y,
  }
})
</script>

<template>
  <svg
    class="absolute inset-0 w-full h-full pointer-events-none"
    aria-hidden="true"
  >
    <!-- Takeoff level, drawn under everything else -->
    <line
      v-if="levels && showHeight"
      :x1="levels.floorX1" :y1="levels.floorY"
      :x2="levels.floorX2" :y2="levels.floorY"
      stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"
    />

    <!-- Fitted parabola -->
    <path
      v-if="curvePath"
      :d="curvePath"
      fill="none" stroke="#fbbf24" stroke-width="2"
      stroke-dasharray="5 6" opacity="0.7"
    />

    <!-- Measured com positions -->
    <circle
      v-for="(point, i) in trail" :key="`t${i}`"
      :cx="point.x" :cy="point.y" r="2.5"
      fill="#fbbf24" opacity="0.45"
    />

    <!-- Height segment -->
    <g v-if="levels && showHeight" stroke="#4ade80" stroke-width="2">
      <line :x1="levels.segX" :y1="levels.segY1" :x2="levels.segX" :y2="levels.segY2" />
      <line :x1="levels.segX - 6" :y1="levels.segY1" :x2="levels.segX + 6" :y2="levels.segY1" />
      <line :x1="levels.segX - 6" :y1="levels.segY2" :x2="levels.segX + 6" :y2="levels.segY2" />
    </g>

    <!-- Skeleton -->
    <line
      v-for="(bone, i) in bones" :key="`b${i}`"
      :x1="bone.x1" :y1="bone.y1" :x2="bone.x2" :y2="bone.y2"
      stroke="#38bdf8" stroke-width="3" stroke-linecap="round" opacity="0.95"
    />
    <circle
      v-for="(joint, i) in joints" :key="`j${i}`"
      :cx="joint.x" :cy="joint.y" r="3.2"
      fill="#e0f2fe"
    />

    <!-- Centre of mass, on top -->
    <g v-if="com">
      <circle :cx="com.x" :cy="com.y" r="9" fill="#fbbf24" opacity="0.25" />
      <circle :cx="com.x" :cy="com.y" r="4.5" fill="#fbbf24" />
    </g>
  </svg>
</template>
```

- [ ] **Step 2: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок. Если TypeScript не знает `cancelVideoFrameCallback`, проверьте актуальность `lib.dom.d.ts` — в свежих версиях он есть.

- [ ] **Step 3: Убедиться, что тесты не сломались**

Run: `npm test`
Expected: PASS, число из Task 2 без изменений. Компонент тестами не покрывается — политика проекта покрывает только `src/lib/**`.

- [ ] **Step 4: Коммит**

```bash
git add src/components/PoseOverlay.vue
git commit -m "Draw the skeleton, the com and its fitted flight over the video"
```

---

### Task 5: Вынос измерительной логики

**Files:**
- Create: `src/composables/useMeasurement.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `useFpsDetection`, `useFrameStepping`, `useMarkers`, `useJumpCalculation`, `usePoseDetection`
- Produces: `useMeasurement(videoRef, isVideoLoaded, currentTime, duration, pause)` — возвращает `fps`, всё из `useFrameStepping`, всё из `useMarkers`, всё из `useJumpCalculation`, `pose`, `hasAnyMarker`

`App.vue` — 430 строк, и он держит видео, FPS, покадровые шаги, маркеры, расчёт, автодетект, историю, черновики, шер-карточку и раскладку. Оверлей добавляет туда ещё один узел; без этого выноса следующая правка в файле станет опасной.

Задача чисто механическая: ничего не переименовывается и не меняет поведения, объявления переезжают.

- [ ] **Step 1: Создать `src/composables/useMeasurement.ts`**

```ts
import { computed, ref, type Ref } from 'vue'
import { useFpsDetection } from './useFpsDetection'
import { useFrameStepping } from './useFrameStepping'
import { useMarkers } from './useMarkers'
import { useJumpCalculation } from './useJumpCalculation'
import { usePoseDetection } from './usePoseDetection'

/**
 * Everything that turns a loaded video into a measurement: frame rate, frame
 * stepping, the two markers, the flight-time arithmetic and the automatic
 * pose pipeline.
 *
 * Split out of App.vue, which had grown to hold the video, the measurement,
 * the history, the draft handling, the share card and the layout at once.
 * The overlay adds one more moving part to that file; without this split the
 * next edit to it would be guesswork.
 *
 * Deliberately NOT in here: video element lifecycle, history and drafts, the
 * share card. Those belong to the results side and move when the results card
 * is reworked.
 */
export function useMeasurement(
  videoRef: Ref<HTMLVideoElement | null>,
  isVideoLoaded: Ref<boolean>,
  currentTime: Ref<number>,
  duration: Ref<number>,
  pause: () => void
) {
  const fps = ref(60)

  useFpsDetection(videoRef, isVideoLoaded, fps)

  const stepping = useFrameStepping(videoRef, fps, currentTime, duration, pause)
  const markers = useMarkers()
  const calculation = useJumpCalculation(markers.takeoffTime, markers.landingTime, fps)
  const pose = usePoseDetection(videoRef, fps)

  const hasAnyMarker = computed(
    () => markers.takeoffTime.value !== null || markers.landingTime.value !== null
  )

  return {
    fps,
    ...stepping,
    ...markers,
    ...calculation,
    pose,
    hasAnyMarker,
  }
}
```

- [ ] **Step 2: Подключить его в `App.vue`**

В `src/App.vue`, в `<script setup>`:

Удалить импорты, которые теперь живут в композабле:

```ts
import { useFpsDetection } from './composables/useFpsDetection'
import { useFrameStepping } from './composables/useFrameStepping'
import { useMarkers } from './composables/useMarkers'
import { useJumpCalculation, cmToUnit, unitLabel } from './composables/useJumpCalculation'
import { usePoseDetection } from './composables/usePoseDetection'
```

заменив последний на импорт только тех помощников, которые `App.vue` использует сам:

```ts
import { cmToUnit, unitLabel } from './composables/useJumpCalculation'
import { useMeasurement } from './composables/useMeasurement'
```

Удалить блок объявлений — строку `const fps = ref(60)`, вызов `useFpsDetection(...)` и три деструктуризации `useFrameStepping`, `useMarkers`, `useJumpCalculation`, вызов `usePoseDetection` и объявление `hasAnyMarker` — и поставить на их место:

```ts
const {
  fps,
  currentFrame,
  startStepForwardHold,
  startStepBackwardHold,
  stopHold,
  stepForward,
  stepBackward,
  takeoffTime,
  landingTime,
  hasValidMarkers,
  setTakeoff,
  setLanding,
  clearMarkers,
  unit,
  takeoffFrame,
  landingFrame,
  flightTimeSeconds,
  jumpHeightCm,
  displayHeight,
  displayError,
  setUnit,
  pose,
  hasAnyMarker,
} = useMeasurement(videoRef, isVideoLoaded, currentTime, duration, pause)
```

Этот блок ставится **после** деструктуризации `useVideoPlayer()`, потому что берёт из неё `videoRef`, `isVideoLoaded`, `currentTime`, `duration` и `pause`.

- [ ] **Step 3: Проверить, что неиспользуемые импорты убраны**

Run: `npx vue-tsc -b`
Expected: без ошибок. `noUnusedLocals` включён, поэтому забытый импорт свалит сборку — это и есть проверка.

- [ ] **Step 4: Убедиться, что тесты и сборка целы**

Run: `npm test`
Expected: PASS, число из Task 2 без изменений.

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 5: Проверить руками, что ничего не отвалилось**

Run: `npm run dev`

Загрузить видео. Проверить: покадровые стрелки, постановка обоих маркеров, появление карточки результата, переключение единиц, кнопка автодетекта.

- [ ] **Step 6: Коммит**

```bash
git add src/composables/useMeasurement.ts src/App.vue
git commit -m "Move the measurement out of App.vue, leaving it the layout"
```

---

### Task 6: Автоповтор полёта

**Files:**
- Create: `src/composables/useFlightReplay.ts`
- Modify: `src/composables/useMeasurement.ts`

**Interfaces:**
- Consumes: тип `JumpAnalysis` из `../lib/jumpFromCom`
- Produces: `useFlightReplay(videoRef, analysis)` — возвращает `{ isReplaying, start, stop }`

Полёт длится 0.4–0.6 с: на нормальной скорости петля мелькает и разглядеть качество трекинга невозможно. Поэтому `0.5×` и запас по 0.15 с с каждой стороны, чтобы был виден сам момент отрыва.

Останавливаться петля обязана от любого признака того, что человек взял управление: иначе видео будет вырываться из рук при каждой попытке перемотать.

- [ ] **Step 1: Создать `src/composables/useFlightReplay.ts`**

```ts
import { ref, watch, type Ref } from 'vue'
import type { JumpAnalysis } from '../lib/jumpFromCom'

/**
 * Playback rate for the replay. A flight lasts 0.4–0.6 s; at 1x the loop is
 * over before the eye settles on it, and judging whether the skeleton tracked
 * the body is the entire point of showing it.
 */
const REPLAY_RATE = 0.5

/** Extra time either side, so the takeoff itself is visible, not just the hang. */
const REPLAY_MARGIN_SECONDS = 0.15

export function useFlightReplay(
  videoRef: Ref<HTMLVideoElement | null>,
  analysis: Ref<JumpAnalysis | null>
) {
  const isReplaying = ref(false)

  let rateBeforeReplay = 1
  let from = 0
  let to = 0

  function stop() {
    if (!isReplaying.value) return
    isReplaying.value = false

    const video = videoRef.value
    if (!video) return
    video.removeEventListener('timeupdate', onTimeUpdate)
    video.playbackRate = rateBeforeReplay
    video.pause()
  }

  function onTimeUpdate() {
    const video = videoRef.value
    if (!video || !isReplaying.value) return
    if (video.currentTime >= to) video.currentTime = from
  }

  function start() {
    const video = videoRef.value
    const result = analysis.value
    if (!video || !result || !(video.duration > 0)) return

    from = Math.max(0, result.takeoffTime - REPLAY_MARGIN_SECONDS)
    to = Math.min(video.duration, result.landingTime + REPLAY_MARGIN_SECONDS)
    if (!(to > from)) return

    if (!isReplaying.value) rateBeforeReplay = video.playbackRate
    isReplaying.value = true

    video.addEventListener('timeupdate', onTimeUpdate)
    video.playbackRate = REPLAY_RATE
    video.currentTime = from
    void video.play().catch(() => {
      // Autoplay blocked. The overlay still works under manual scrubbing, so
      // give up on the loop rather than leaving the element slowed down.
      stop()
    })
  }

  // A new clip, or a re-run of detection, invalidates the window being looped.
  watch(analysis, stop)
  watch(videoRef, stop)

  return { isReplaying, start, stop }
}
```

- [ ] **Step 2: Подключить в `useMeasurement.ts`**

В `src/composables/useMeasurement.ts` добавить импорты:

```ts
import { watch } from 'vue'
import { useFlightReplay } from './useFlightReplay'
```

(`watch` дописывается в существующий импорт из `vue`.)

После `const pose = usePoseDetection(videoRef, fps)` добавить:

```ts
const analysis = computed(() => pose.result.value?.analysis ?? null)

/**
 * The verdict decides whether a height may be drawn at all. A stature outside
 * the plausible band means the metric scale is wrong by a factor of k², so the
 * com path is still right in pixels while the centimetres are not — the
 * overlay draws the trajectory and omits the height segment.
 */
const canShowHeight = computed(() => pose.result.value?.verdict.kind !== 'unusable')

const replay = useFlightReplay(videoRef, analysis)

// Start the loop as soon as a usable measurement lands, not on every result:
// an unusable verdict has no flight window worth looping.
watch(analysis, (result) => {
  if (result && canShowHeight.value) replay.start()
})
```

и дополнить возвращаемый объект:

```ts
    pose,
    analysis,
    canShowHeight,
    replay,
    hasAnyMarker,
```

- [ ] **Step 3: Проверить типы и тесты**

Run: `npx vue-tsc -b`
Expected: без ошибок.

Run: `npm test`
Expected: PASS, число из Task 2 без изменений.

- [ ] **Step 4: Коммит**

```bash
git add src/composables/useFlightReplay.ts src/composables/useMeasurement.ts
git commit -m "Replay the flight in a slowed loop once a measurement lands"
```

---

### Task 7: Сборка воедино и проверка на реальном видео

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: всё выше
- Produces: ничего (последняя задача)

- [ ] **Step 1: Забрать из `useMeasurement` то, что добавил Task 6**

Деструктуризация в `App.vue` собрана в Task 5 и про новые возвраты Task 6 не знает.
Дописать в неё три имени, перед закрывающей скобкой:

```ts
  pose,
  analysis,
  canShowHeight,
  replay,
  hasAnyMarker,
} = useMeasurement(videoRef, isVideoLoaded, currentTime, duration, pause)
```

- [ ] **Step 2: Подключить оверлей в `App.vue`**

Добавить импорт рядом с остальными компонентами:

```ts
import PoseOverlay from './components/PoseOverlay.vue'
```

Заменить строку 278:

```html
<VideoPlayer ref="videoPlayer" :src="videoSrc" @video-ref="setVideoRef" />
```

на:

```html
<VideoPlayer ref="videoPlayer" :src="videoSrc" @video-ref="setVideoRef">
  <template #overlay>
    <PoseOverlay
      :frames="pose.frames.value"
      :analysis="analysis"
      :video-size="{ width: videoRef?.videoWidth ?? 0, height: videoRef?.videoHeight ?? 0 }"
      :video-el="videoRef"
      :fps="fps"
      :show-height="canShowHeight"
    />
  </template>
</VideoPlayer>
```

- [ ] **Step 3: Остановить петлю, когда человек берёт управление**

В `src/App.vue` дописать вызов `replay.stop()` в те места, где пользователь трогает воспроизведение.

Заменить `onTimelineSeek`:

```ts
function onTimelineSeek(time: number) {
  replay.stop()
  seekTo(time)
}
```

Заменить `startNewVideo` — добавить остановку первой строкой тела:

```ts
function startNewVideo() {
  replay.stop()
  history.finalizeDraft()
  pose.cancel()
  videoSrc.value = ''
  clearMarkers()
}
```

(Комментарий про `pose.cancel()` внутри функции сохранить как есть.)

В `onKeydown` добавить остановку в обе ветки шага:

```ts
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    replay.stop()
    stepBackward()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    replay.stop()
    stepForward()
  } else if (e.key === '+' || e.key === '=') {
```

В шаблоне заменить обработчики `FrameControls` (строки 294-297):

```html
            @toggle-play="replay.stop(); togglePlayPause()"
            @step-forward-hold="replay.stop(); startStepForwardHold()"
            @step-backward-hold="replay.stop(); startStepBackwardHold()"
            @step-stop="stopHold"
```

И у `Timeline` заменить `@drag-start="pause"` на:

```html
            @drag-start="replay.stop(); pause()"
```

- [ ] **Step 4: Проверить типы, тесты и сборку**

Run: `npx vue-tsc -b`
Expected: без ошибок.

Run: `npm test`
Expected: PASS, число из Task 2 без изменений.

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 5: Проверить на реальном видео**

Run: `npm run dev -- --host`

Загрузить реальный клип прыжка, нажать «Найти прыжок автоматически» и проверить:

1. После детекта видео само встаёт на отрыв и зациклено крутит полёт на половинной скорости.
2. Скелет держится на теле, а не плавает рядом.
3. Точка ЦТ идёт по телу, след и парабола ложатся друг на друга.
4. Отрезок высоты стоит между уровнем отрыва и вершиной.
5. За пределами полёта скелет не рисуется вовсе.
6. Зум до 8× — скелет остаётся на теле, толщина линий не растёт.
7. Поворот телефона / изменение размера окна — оверлей пересчитывается.
8. Перемотка таймлайном, покадровый шаг и play/pause останавливают петлю, и после этого скорость воспроизведения нормальная, а не 0.5×.
9. Клип без прыжка: ничего не рисуется, ошибок в консоли нет.
10. Новое видео посреди петли: петля останавливается, оверлей чистый.

- [ ] **Step 6: Коммит**

```bash
git add src/App.vue
git commit -m "Mount the overlay and hand playback back on any manual control"
```

---

## Определение готовности

- `npm test` проходит; новых падений нет, счётчик вырос относительно 140
- `npm run build` и `npx vue-tsc -b` чистые
- На реальном видео скелет держится на теле при зуме и при повороте экрана
- Петля останавливается от любого ручного управления и возвращает `playbackRate`
- Скелет не рисуется за пределами плотных данных
- `src/lib/**` по-прежнему без Vue, DOM и недетерминированности
- Ядро PR-B тронуто ровно одной строкой — `export` у `EDGE_TRIM_FRAMES`
- Высота, восстановленная из геометрии оверлея, совпадает с `analysis.comHeightCm`

## Чего в этом плане намеренно нет

Переделки `ResultsCard` под высоту по ЦТ, выноса `AutoDetect.vue`, миграции истории, числовой подписи к отрезку высоты, замера спринтов. Всё это — следующие итерации, см. раздел 9 спеки.
