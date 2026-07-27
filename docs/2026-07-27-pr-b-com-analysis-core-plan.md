# PR-B: ядро анализа центра тяжести — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Посчитать высоту прыжка по траектории центра тяжести — чистой математикой, без UI и без MediaPipe, доказав корректность на синтетическом прыгуне с известным ответом.

**Architecture:** Всё живёт в `src/lib/` — чистые функции без DOM, Vue и MediaPipe. Вход конвейера — массив кадров с 33 нормализованными ландмарками и временной меткой; выход — высота в сантиметрах и вердикт достоверности. Проверка строится на генераторе синтетического прыгуна, который порождает ландмарки по заданной истинной высоте, так что каждый шаг конвейера можно прижать к точно известному ответу.

**Tech Stack:** TypeScript (strict), Vitest. Ни одной новой зависимости.

**Спека:** `docs/2026-07-27-com-tracking-and-zoom-design.md`, раздел 6.

## Global Constraints

- TypeScript strict. Включены `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` — никаких `enum` (использовать `as const`) и параметров-свойств конструктора.
- `src/lib/**` **не импортирует** Vue, не обращается к DOM и не знает про MediaPipe. Это проверяется глазами на ревью каждой задачи.
- Ни `Math.random()`, ни `Date.now()` в `src/lib/**` — генератор шума получает seed и детерминирован.
- Ускорение свободного падения: `9.81` м/с². Объявить один раз как `GRAVITY` в `src/lib/physics.ts` и импортировать везде — расхождение констант между модулями даст ошибку, которую будет крайне трудно найти.
- Ось `y` растёт **вниз** (экранная система координат). Это источник большинства знаковых ошибок в этом PR.
- Тесты живут рядом с кодом: `src/lib/<name>.test.ts`. Vitest уже настроен (`include: ['src/**/*.test.ts']`, `environment: 'node'`).
- В сообщениях коммитов **не добавлять** строки `Co-Authored-By`.
- Не запускать `git push`.
- Ничего не менять в `src/components/**`, `src/composables/**`, `src/App.vue` — это PR-C.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `src/lib/physics.ts` | `GRAVITY = 9.81`. Одна строка, один источник правды |
| `src/lib/poseTypes.ts` | `Vec2`, `Landmark`, `PoseFrame`, `VideoSize`, индексы ландмарок `LM` |
| `src/lib/bodyModel.ts` | Таблица сегментов Dempster + `centreOfMass(landmarks)` |
| `src/lib/testing/syntheticJumper.ts` | Генератор прыгуна с известной истиной. Импортируется **только** тестами, поэтому в бандл не попадает |
| `src/lib/comTrack.ts` | `buildComTrack` — трек ЦТ, стоп и рост в пикселях |
| `src/lib/flightPhase.ts` | `findFlightPhase` — границы полёта, включая субкадровые моменты |
| `src/lib/parabolaFit.ts` | `fitParabola` — МНК, R², вершина, масштаб px/м |
| `src/lib/jumpFromCom.ts` | `analyseJump` + `assess` + `measureJump` — сборка и вердикт |

---

## О границах доверия к синтетическому прыгуну

Генератор расставляет ландмарки, **используя ту же таблицу масс**, что и `centreOfMass`. Это надо понимать честно:

- Сквозные тесты **не** доказывают, что таблица Dempster верна. Согласованно неверная таблица прошла бы их.
- Что они доказывают: подгонка параболы, восстановление масштаба из `g`, субкадровый отрыв и расчёт высоты работают — то есть весь конвейер поверх модели тела.
- Таблица проверяется отдельно и независимо: суммой долей и тестами `centreOfMass` с посчитанными на бумаге ответами (Task 1).
- Контрастный тест с поджатием ног (Task 8) **осмыслен**, потому что середина бёдер — прокси, не зависящий от таблицы вовсе. Он показывает: сегментный ЦТ восстанавливает высоту там, где таз промахивается.

Эти три вещи вместе закрывают то, что каждая по отдельности не закрывает.

---

### Task 1: Типы, константа g и модель тела

**Files:**
- Create: `src/lib/physics.ts`
- Create: `src/lib/poseTypes.ts`
- Create: `src/lib/bodyModel.ts`
- Create: `src/lib/bodyModel.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `GRAVITY = 9.81` из `physics.ts`
  - `Vec2 { x: number; y: number }`, `Landmark = Vec2`, `PoseFrame { time: number; landmarks: Landmark[] }`, `VideoSize { width: number; height: number }`, `LM` из `poseTypes.ts`
  - `Anchor`, `Segment`, `SEGMENTS`, `resolveAnchor(landmarks, anchor): Vec2`, `centreOfMass(landmarks): Vec2` из `bodyModel.ts`

- [ ] **Step 1: Создать `src/lib/physics.ts`**

```ts
/** Standard gravity, m/s². Declared once so no two modules can disagree. */
export const GRAVITY = 9.81
```

- [ ] **Step 2: Создать `src/lib/poseTypes.ts`**

```ts
export interface Vec2 {
  x: number
  y: number
}

/** A MediaPipe pose landmark in normalized frame coordinates (0..1, y down). */
export type Landmark = Vec2

export interface PoseFrame {
  /** Presentation time of this frame, in seconds. */
  time: number
  /** Exactly 33 landmarks, in MediaPipe's index order. */
  landmarks: Landmark[]
}

export interface VideoSize {
  width: number
  height: number
}

/** MediaPipe Pose landmark indices, named. Only the ones this project uses. */
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const

/** Every landmark that can be the lowest point of a foot. */
export const FOOT_LANDMARKS = [
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_HEEL, LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX,
] as const

export const LANDMARK_COUNT = 33
```

- [ ] **Step 3: Написать падающие тесты**

Создать `src/lib/bodyModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SEGMENTS, centreOfMass } from './bodyModel'
import { LM, LANDMARK_COUNT, type Landmark } from './poseTypes'

/** All landmarks at the origin, then override the listed indices. */
function pose(overrides: Record<number, Landmark> = {}): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }))
  for (const [index, value] of Object.entries(overrides)) {
    landmarks[Number(index)] = value
  }
  return landmarks
}

describe('SEGMENTS', () => {
  it('accounts for exactly the whole body mass', () => {
    const total = SEGMENTS.reduce((sum, s) => sum + s.mass, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('keeps every com ratio inside the segment', () => {
    for (const s of SEGMENTS) {
      expect(s.comRatio).toBeGreaterThanOrEqual(0)
      expect(s.comRatio).toBeLessThanOrEqual(1)
    }
  })
})

describe('centreOfMass', () => {
  it('collapses to the common point when the whole body is at one place', () => {
    const com = centreOfMass(pose({ ...Object.fromEntries(
      Array.from({ length: LANDMARK_COUNT }, (_, i) => [i, { x: 0.5, y: 0.5 }])
    ) }))
    expect(com.x).toBeCloseTo(0.5, 10)
    expect(com.y).toBeCloseTo(0.5, 10)
  })

  // Head+neck is the only segment touching the nose, its comRatio is 1.0, and
  // its mass is 0.081 — so moving the nose alone moves the body com by 8.1%.
  it('moves by the head mass fraction when only the nose moves', () => {
    const com = centreOfMass(pose({ [LM.NOSE]: { x: 0, y: 1 } }))
    expect(com.y).toBeCloseTo(0.081, 10)
  })

  // Left shank: 25 -> 27, ratio 0.433, mass 0.0465  => 0.433 * 0.0465
  // Left foot:  27 -> 31, ratio 0.500, mass 0.0145  => 1.000 * 0.0145
  it('applies the com ratio along a segment', () => {
    const com = centreOfMass(pose({
      [LM.LEFT_ANKLE]: { x: 0, y: 1 },
      [LM.LEFT_FOOT_INDEX]: { x: 0, y: 1 },
    }))
    expect(com.y).toBeCloseTo(0.433 * 0.0465 + 0.0145, 10)
  })

  // Both shoulders at y=1 drive three segments:
  //   trunk       mid(11,12)->mid(23,24), ratio 0.5,   mass 0.497 => 0.5   * 0.497
  //   upper arms  11->13 and 12->14,      ratio 0.436, mass 0.028 => 0.564 * 0.028 each
  //   head        mid(11,12)->nose,       ratio 1.0                => sits at the nose, y=0
  it('resolves midpoint anchors', () => {
    const com = centreOfMass(pose({
      [LM.LEFT_SHOULDER]: { x: 0, y: 1 },
      [LM.RIGHT_SHOULDER]: { x: 0, y: 1 },
    }))
    expect(com.y).toBeCloseTo(0.5 * 0.497 + 2 * (1 - 0.436) * 0.028, 10)
  })
})
```

- [ ] **Step 4: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./bodyModel"`.

- [ ] **Step 5: Создать `src/lib/bodyModel.ts`**

```ts
import { LM, type Landmark, type Vec2 } from './poseTypes'

/**
 * Where a segment end sits: a single landmark index, or the midpoint of two
 * (the trunk and head hang off the shoulder and hip midpoints, which are not
 * landmarks in their own right).
 */
export type Anchor = number | readonly [number, number]

export interface Segment {
  name: string
  proximal: Anchor
  distal: Anchor
  /** Fraction of total body mass. All masses sum to exactly 1. */
  mass: number
  /** Where this segment's own com sits along proximal -> distal, 0..1. */
  comRatio: number
}

/**
 * Dempster's segment mass fractions and com locations.
 *
 * Head+neck uses comRatio 1.0, placing the head's com exactly at the nose.
 * That is coarse — the real one sits higher — but a CONSTANT offset in the com
 * proxy cannot affect the result: jump height is a difference (takeoff minus
 * apex, so the constant cancels) and the px-per-metre scale comes from the
 * second derivative (immune to constants by definition). Only offsets that
 * CHANGE during flight matter, which is exactly why the limbs are modelled
 * segment by segment instead of using the hip midpoint as a proxy.
 */
export const SEGMENTS: readonly Segment[] = [
  { name: 'head+neck', proximal: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], distal: LM.NOSE, mass: 0.081, comRatio: 1.0 },
  { name: 'trunk', proximal: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], distal: [LM.LEFT_HIP, LM.RIGHT_HIP], mass: 0.497, comRatio: 0.5 },
  { name: 'upper arm L', proximal: LM.LEFT_SHOULDER, distal: LM.LEFT_ELBOW, mass: 0.028, comRatio: 0.436 },
  { name: 'upper arm R', proximal: LM.RIGHT_SHOULDER, distal: LM.RIGHT_ELBOW, mass: 0.028, comRatio: 0.436 },
  { name: 'forearm L', proximal: LM.LEFT_ELBOW, distal: LM.LEFT_WRIST, mass: 0.016, comRatio: 0.430 },
  { name: 'forearm R', proximal: LM.RIGHT_ELBOW, distal: LM.RIGHT_WRIST, mass: 0.016, comRatio: 0.430 },
  { name: 'hand L', proximal: LM.LEFT_WRIST, distal: LM.LEFT_INDEX, mass: 0.006, comRatio: 0.506 },
  { name: 'hand R', proximal: LM.RIGHT_WRIST, distal: LM.RIGHT_INDEX, mass: 0.006, comRatio: 0.506 },
  { name: 'thigh L', proximal: LM.LEFT_HIP, distal: LM.LEFT_KNEE, mass: 0.100, comRatio: 0.433 },
  { name: 'thigh R', proximal: LM.RIGHT_HIP, distal: LM.RIGHT_KNEE, mass: 0.100, comRatio: 0.433 },
  { name: 'shank L', proximal: LM.LEFT_KNEE, distal: LM.LEFT_ANKLE, mass: 0.0465, comRatio: 0.433 },
  { name: 'shank R', proximal: LM.RIGHT_KNEE, distal: LM.RIGHT_ANKLE, mass: 0.0465, comRatio: 0.433 },
  { name: 'foot L', proximal: LM.LEFT_ANKLE, distal: LM.LEFT_FOOT_INDEX, mass: 0.0145, comRatio: 0.5 },
  { name: 'foot R', proximal: LM.RIGHT_ANKLE, distal: LM.RIGHT_FOOT_INDEX, mass: 0.0145, comRatio: 0.5 },
]

export function resolveAnchor(landmarks: Landmark[], anchor: Anchor): Vec2 {
  if (typeof anchor === 'number') {
    const p = landmarks[anchor]!
    return { x: p.x, y: p.y }
  }
  const a = landmarks[anchor[0]]!
  const b = landmarks[anchor[1]]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Segment-weighted centre of mass, in whatever units the landmarks use.
 *
 * In flight the true body com must follow a perfect parabola no matter what
 * the limbs do — that is the law this whole measurement rests on. The hip
 * midpoint does not: tuck the legs and their mass moves up toward the trunk,
 * so the hips must dip below the parabola to compensate.
 */
export function centreOfMass(landmarks: Landmark[]): Vec2 {
  let x = 0
  let y = 0
  for (const segment of SEGMENTS) {
    const p = resolveAnchor(landmarks, segment.proximal)
    const d = resolveAnchor(landmarks, segment.distal)
    x += segment.mass * (p.x + segment.comRatio * (d.x - p.x))
    y += segment.mass * (p.y + segment.comRatio * (d.y - p.y))
  }
  return { x, y }
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 21 существующих (`zoomMath`) + 6 новых = 27.

- [ ] **Step 7: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add src/lib/physics.ts src/lib/poseTypes.ts src/lib/bodyModel.ts src/lib/bodyModel.test.ts
git commit -m "Add pose types and the Dempster segment body model"
```

---

### Task 2: Генератор синтетического прыгуна

**Files:**
- Create: `src/lib/testing/syntheticJumper.ts`
- Create: `src/lib/testing/syntheticJumper.test.ts`

**Interfaces:**
- Consumes: `GRAVITY`, `PoseFrame`, `Landmark`, `LM`, `LANDMARK_COUNT`, `centreOfMass`
- Produces: `JumpOptions`, `SyntheticClip`, `generateJump(options: JumpOptions): SyntheticClip`

Это самый ответственный файл в PR: если генератор врёт, все последующие тесты доказывают неправду. Поэтому у него есть собственные тесты, проверяющие ровно те свойства, на которые будут опираться остальные задачи.

Устройство: фигура строится в долях роста от земли вверх, затем переводится в пиксели и нормализуется. В фазе стойки её ставят **по стопам на полу**; в фазе полёта — **по центру тяжести на параболе**, а куда при этом попадут стопы и таз, определяет поза. Именно так ведёт себя настоящее тело, и именно поэтому поджатие ног автоматически утаскивает таз с параболы, ничего специально для этого не подкручивая.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/testing/syntheticJumper.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateJump } from './syntheticJumper'
import { centreOfMass } from '../bodyModel'
import { FOOT_LANDMARKS, LANDMARK_COUNT } from '../poseTypes'
import { GRAVITY } from '../physics'

const BASE = {
  jumpHeightM: 0.5,
  scalePxPerM: 400,
  fps: 60,
  videoWidth: 720,
  videoHeight: 1280,
}

function footY(landmarks: { y: number }[]): number {
  return Math.max(...FOOT_LANDMARKS.map((i) => landmarks[i]!.y))
}

describe('generateJump', () => {
  it('emits well-formed frames with monotonically increasing times', () => {
    const clip = generateJump(BASE)
    expect(clip.frames.length).toBeGreaterThan(40)
    for (const frame of clip.frames) {
      expect(frame.landmarks).toHaveLength(LANDMARK_COUNT)
      for (const l of frame.landmarks) {
        expect(Number.isFinite(l.x)).toBe(true)
        expect(Number.isFinite(l.y)).toBe(true)
      }
    }
    for (let i = 1; i < clip.frames.length; i++) {
      expect(clip.frames[i]!.time).toBeGreaterThan(clip.frames[i - 1]!.time)
    }
  })

  it('reports a flight time matching the ballistic formula', () => {
    const clip = generateJump(BASE)
    expect(clip.truth.flightTimeS).toBeCloseTo(2 * Math.sqrt(2 * BASE.jumpHeightM / GRAVITY), 10)
  })

  it('puts takeoff strictly between two frames, not on one', () => {
    const clip = generateJump(BASE)
    const frameIndex = clip.truth.takeoffTime * BASE.fps
    expect(Math.abs(frameIndex - Math.round(frameIndex))).toBeGreaterThan(0.01)
  })

  it('keeps the feet on a level floor while standing and lifts them in flight', () => {
    const clip = generateJump(BASE)
    const standing = clip.frames.filter(
      (f) => f.time < clip.truth.takeoffTime || f.time > clip.truth.landingTime
    )
    const floors = standing.map((f) => footY(f.landmarks))
    expect(Math.max(...floors) - Math.min(...floors)).toBeCloseTo(0, 9)

    const midAir = clip.frames.find(
      (f) => Math.abs(f.time - (clip.truth.takeoffTime + clip.truth.landingTime) / 2) < 1 / BASE.fps
    )!
    // The com rises 0.5 m at 400 px/m on a 1280 px frame, so the feet must drop
    // 0.5 * 400 / 1280 = 0.15625 — normalized units, the same ones footY is in.
    // Two-sided on purpose: a one-sided epsilon would wave through a generator
    // that lifts the feet a third as far as it should. midAir is the frame
    // nearest the apex rather than the apex itself, hence the tolerance.
    expect(floors[0]! - footY(midAir.landmarks)).toBeCloseTo(0.15625, 1)
  })

  it('drives the body com along a parabola whose curvature encodes real gravity', () => {
    const clip = generateJump(BASE)
    const air = clip.frames.filter(
      (f) => f.time > clip.truth.takeoffTime && f.time < clip.truth.landingTime
    )
    // Second difference of com y over evenly spaced frames is a*dt^2.
    const dt = 1 / BASE.fps
    const comY = air.map((f) => centreOfMass(f.landmarks).y * BASE.videoHeight)
    const second = comY[2]! - 2 * comY[1]! + comY[0]!
    const expected = GRAVITY * BASE.scalePxPerM * dt * dt
    expect(second).toBeCloseTo(expected, 6)
  })

  it('keeps the com on the same parabola when the legs tuck', () => {
    const plain = generateJump(BASE)
    const tucked = generateJump({ ...BASE, tuckM: 0.35 })
    const at = (clip: ReturnType<typeof generateJump>, t: number) =>
      centreOfMass(clip.frames.find((f) => f.time >= t)!.landmarks).y
    const t = (plain.truth.takeoffTime + plain.truth.landingTime) / 2
    expect(at(tucked, t)).toBeCloseTo(at(plain, t), 9)
  })

  it('pulls the hip midpoint OFF that parabola when the legs tuck', () => {
    const plain = generateJump(BASE)
    const tucked = generateJump({ ...BASE, tuckM: 0.35 })
    const hipAt = (clip: ReturnType<typeof generateJump>, t: number) => {
      const f = clip.frames.find((x) => x.time >= t)!
      return (f.landmarks[23]!.y + f.landmarks[24]!.y) / 2
    }
    const t = (plain.truth.takeoffTime + plain.truth.landingTime) / 2
    // This test and its twin above justify the whole segment-mass model, so the
    // threshold must have real headroom. Measured deviation at tuckM 0.25 was
    // 0.010340 against a 0.01 bar — a 3.4% margin that neither survived a
    // legitimate tweak nor failed on a generator 3% short. At tuckM 0.35 the
    // deviation is about 0.0145, so 0.008 leaves ~45% while still failing if
    // the effect drops below roughly half. tuckM matches Task 8's contrast test.
    expect(Math.abs(hipAt(tucked, t) - hipAt(plain, t))).toBeGreaterThan(0.008)
  })

  it('is deterministic for a given seed and different for another', () => {
    const a = generateJump({ ...BASE, noiseSigma: 0.005, seed: 1 })
    const b = generateJump({ ...BASE, noiseSigma: 0.005, seed: 1 })
    const c = generateJump({ ...BASE, noiseSigma: 0.005, seed: 2 })
    expect(a.frames[10]!.landmarks[0]!.y).toBe(b.frames[10]!.landmarks[0]!.y)
    expect(a.frames[10]!.landmarks[0]!.y).not.toBe(c.frames[10]!.landmarks[0]!.y)
  })

  it('stretches apparent time under slow motion without changing the pose sequence', () => {
    const normal = generateJump(BASE)
    const slow = generateJump({ ...BASE, timeScale: 2 })
    expect(slow.truth.apparentFlightTimeS).toBeCloseTo(normal.truth.flightTimeS * 2, 9)
    expect(slow.frames.length).toBeGreaterThan(normal.frames.length)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./syntheticJumper"`.

- [ ] **Step 3: Создать `src/lib/testing/syntheticJumper.ts`**

```ts
import { GRAVITY } from '../physics'
import { centreOfMass } from '../bodyModel'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../poseTypes'

export interface JumpOptions {
  /** True rise of the body com from takeoff to apex, in metres. */
  jumpHeightM: number
  scalePxPerM: number
  fps: number
  videoWidth: number
  videoHeight: number
  /** Default 1.8. */
  statureM?: number
  /** Frames of standing before takeoff and after landing. Default 20. */
  standFrames?: number
  /** How far knees and feet rise toward the hips at the apex, metres. Default 0. */
  tuckM?: number
  /** Gaussian noise on normalized coordinates. Default 0. */
  noiseSigma?: number
  /** Slow-motion factor: apparent time is stretched by this. Default 1. */
  timeScale?: number
  /** Where takeoff falls inside the frame interval, 0..1 exclusive. Default 0.5. */
  takeoffPhase?: number
  /** Seed for the noise PRNG. Default 1. */
  seed?: number
}

export interface SyntheticClip {
  frames: PoseFrame[]
  truth: {
    jumpHeightM: number
    scalePxPerM: number
    statureM: number
    /** Sub-frame takeoff instant, in apparent (video) seconds. */
    takeoffTime: number
    /** Sub-frame landing instant, in apparent (video) seconds. */
    landingTime: number
    /** Real-world flight duration, seconds. */
    flightTimeS: number
    /** Flight duration as it appears in the video's timebase. */
    apparentFlightTimeS: number
  }
}

/**
 * Standing body proportions as fractions of stature, measured upward from the
 * floor (Drillis & Contini). The nose sits at 0.936 — deliberately NOT the
 * 0.90 constant comTrack divides by, so that the stature estimator is tested
 * against an independent value rather than its own assumption.
 */
const HEIGHT_FRACTION = {
  foot: 0.0,
  ankle: 0.039,
  knee: 0.285,
  hip: 0.530,
  wrist: 0.485,
  elbow: 0.630,
  shoulder: 0.818,
  nose: 0.936,
  hand: 0.431,
} as const

const HALF_WIDTH_FRACTION = {
  hip: 0.05,
  shoulder: 0.10,
  arm: 0.13,
  foot: 0.05,
} as const

/** Deterministic PRNG — src/lib must never reach for Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/**
 * How the leg tuck rises and falls over the flight, as a 0..1 bump.
 *
 * Deliberately ASYMMETRIC, peaking around 31% of the flight rather than at the
 * apex, because a symmetric bump would make this whole scenario useless.
 * sin(pi*x) approximates 4x(1-x) to within about 5%, i.e. a symmetric tuck is
 * itself nearly a parabola — least squares then absorbs it into c2 instead of
 * rejecting it, and the resulting scale error cancels against the matching
 * error in the measured rise almost exactly. The hip midpoint would come out
 * roughly correct and the contrast test would prove nothing.
 *
 * Real athletes tuck on the way up and extend the legs before landing, so the
 * asymmetric shape is also the truthful one.
 */
function tuckShape(x: number): number {
  return Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, x)), 0.6))
}

export function generateJump(options: JumpOptions): SyntheticClip {
  const {
    jumpHeightM, scalePxPerM, fps, videoWidth, videoHeight,
    statureM = 1.8,
    standFrames = 20,
    tuckM = 0,
    noiseSigma = 0,
    timeScale = 1,
    takeoffPhase = 0.5,
    seed = 1,
  } = options

  const staturePx = statureM * scalePxPerM
  const v0 = Math.sqrt(2 * GRAVITY * jumpHeightM)
  const flightTimeS = (2 * v0) / GRAVITY
  const apparentFlightTimeS = flightTimeS * timeScale

  const takeoffTime = (standFrames - takeoffPhase) / fps
  const landingTime = takeoffTime + apparentFlightTimeS
  const totalFrames = standFrames + Math.ceil(apparentFlightTimeS * fps) + standFrames

  // Floor position on screen, chosen so the standing figure sits in frame.
  const floorYPx = videoHeight * 0.92

  /**
   * Builds one pose. `liftM` raises knees and feet toward the hips; the caller
   * decides where the figure ends up vertically.
   */
  function buildPose(liftM: number): Landmark[] {
    const up = (fraction: number, lift = 0) => floorYPx - (fraction * statureM + lift) * scalePxPerM
    const cx = videoWidth / 2
    const sideX = (halfWidth: number, side: number) => cx + side * halfWidth * staturePx

    const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: cx, y: up(0) }))
    const put = (index: number, x: number, y: number) => { landmarks[index] = { x, y } }

    for (const side of [-1, 1]) {
      const isLeft = side < 0
      const hipX = sideX(HALF_WIDTH_FRACTION.hip, side)
      const shoulderX = sideX(HALF_WIDTH_FRACTION.shoulder, side)
      const armX = sideX(HALF_WIDTH_FRACTION.arm, side)
      const footX = sideX(HALF_WIDTH_FRACTION.foot, side)

      put(isLeft ? LM.LEFT_HIP : LM.RIGHT_HIP, hipX, up(HEIGHT_FRACTION.hip))
      put(isLeft ? LM.LEFT_KNEE : LM.RIGHT_KNEE, hipX, up(HEIGHT_FRACTION.knee, liftM * 0.6))
      put(isLeft ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE, footX, up(HEIGHT_FRACTION.ankle, liftM))
      put(isLeft ? LM.LEFT_HEEL : LM.RIGHT_HEEL, footX, up(HEIGHT_FRACTION.foot, liftM))
      put(isLeft ? LM.LEFT_FOOT_INDEX : LM.RIGHT_FOOT_INDEX, footX, up(HEIGHT_FRACTION.foot, liftM))
      put(isLeft ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER, shoulderX, up(HEIGHT_FRACTION.shoulder))
      put(isLeft ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW, armX, up(HEIGHT_FRACTION.elbow))
      put(isLeft ? LM.LEFT_WRIST : LM.RIGHT_WRIST, armX, up(HEIGHT_FRACTION.wrist))
      put(isLeft ? LM.LEFT_INDEX : LM.RIGHT_INDEX, armX, up(HEIGHT_FRACTION.hand))
    }
    put(LM.NOSE, cx, up(HEIGHT_FRACTION.nose))

    return landmarks
  }

  function shift(landmarks: Landmark[], dyPx: number): Landmark[] {
    return landmarks.map((l) => ({ x: l.x, y: l.y + dyPx }))
  }

  // The standing figure defines both the floor contact and the takeoff com
  // level, so flight begins exactly where standing ends — no discontinuity.
  const standingPose = buildPose(0)
  const standingComYPx = centreOfMass(standingPose).y

  const rand = mulberry32(seed)
  const frames: PoseFrame[] = []

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps
    let landmarks: Landmark[]

    if (time <= takeoffTime || time >= landingTime) {
      landmarks = standingPose
    } else {
      const tReal = (time - takeoffTime) / timeScale
      const riseM = v0 * tReal - (GRAVITY * tReal * tReal) / 2
      const lift = tuckM * tuckShape(tReal / flightTimeS)
      const airbornePose = buildPose(lift)
      // Place by com, not by feet: this is what makes a leg tuck drag the hips
      // off the parabola on its own, with nothing special coded for it.
      const targetComYPx = standingComYPx - riseM * scalePxPerM
      landmarks = shift(airbornePose, targetComYPx - centreOfMass(airbornePose).y)
    }

    const normalized: Landmark[] = landmarks.map((l) => ({
      x: l.x / videoWidth + (noiseSigma > 0 ? gaussian(rand) * noiseSigma : 0),
      y: l.y / videoHeight + (noiseSigma > 0 ? gaussian(rand) * noiseSigma : 0),
    }))

    frames.push({ time, landmarks: normalized })
  }

  return {
    frames,
    truth: {
      jumpHeightM, scalePxPerM, statureM,
      takeoffTime, landingTime, flightTimeS, apparentFlightTimeS,
    },
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 27 + 9 новых = 36.

Если тест про вторую разность не сходится, причина почти наверняка в знаке: `y` растёт вниз, поэтому подъём тела — это **уменьшение** `y`, а вторая разность положительна.

- [ ] **Step 5: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/testing/
git commit -m "Add a synthetic jumper generator with known ground truth"
```

---

### Task 3: Трек центра тяжести

**Files:**
- Create: `src/lib/comTrack.ts`
- Create: `src/lib/comTrack.test.ts`

**Interfaces:**
- Consumes: `PoseFrame`, `VideoSize`, `FOOT_LANDMARKS`, `LM`, `centreOfMass`
- Produces: `ComTrack { times: number[]; comY: number[]; footY: number[]; staturePx: number }`, `buildComTrack(frames: PoseFrame[], video: VideoSize): ComTrack`

Оценка роста: `staturePx = percentile(footY − noseY, 0.9) / 0.90`. Девяностый перцентиль, а не максимум — максимум подхватил бы выброс шума. Делитель 0.90 — доля роста, на которой находится нос; величина приближённая, и это нормально: полоса правдоподобия 1.3–2.2 м намеренно широкая, а отказ, который она ловит, всегда кратный.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/comTrack.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildComTrack } from './comTrack'
import { generateJump } from './testing/syntheticJumper'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }

function frame(time: number, overrides: Record<number, Landmark>): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 }))
  for (const [index, value] of Object.entries(overrides)) {
    landmarks[Number(index)] = value
  }
  return { time, landmarks }
}

describe('buildComTrack', () => {
  it('scales normalized coordinates into pixels', () => {
    const track = buildComTrack([frame(0, {})], VIDEO)
    // Every landmark at y=0.5 puts the com at y=0.5 too.
    expect(track.comY[0]).toBeCloseTo(0.5 * VIDEO.height, 6)
  })

  it('takes footY as the lowest of the six foot landmarks', () => {
    const track = buildComTrack([frame(0, {
      [LM.LEFT_ANKLE]: { x: 0.5, y: 0.70 },
      [LM.LEFT_HEEL]: { x: 0.5, y: 0.80 },
      [LM.LEFT_FOOT_INDEX]: { x: 0.5, y: 0.75 },
    })], VIDEO)
    expect(track.footY[0]).toBeCloseTo(0.80 * VIDEO.height, 6)
  })

  it('carries the frame times through unchanged', () => {
    const track = buildComTrack([frame(0.25, {}), frame(0.5, {})], VIDEO)
    expect(track.times).toEqual([0.25, 0.5])
  })

  it('recovers a plausible stature from a generated clip', () => {
    const clip = generateJump({
      jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
      videoWidth: VIDEO.width, videoHeight: VIDEO.height, statureM: 1.8,
    })
    const track = buildComTrack(clip.frames, VIDEO)
    // The generator puts the nose at 0.936 of stature while the estimator
    // divides by 0.90, so a few percent of overshoot is expected and fine.
    expect(track.staturePx / 400).toBeGreaterThan(1.7)
    expect(track.staturePx / 400).toBeLessThan(2.0)
  })

  // The test above cannot justify the percentile: with tuckM defaulting to 0
  // the airborne pose is a rigid translation of the standing one, translation
  // cancels in footY - noseY, and every span is identical. A zero-variance
  // array makes percentile, max and every quantile the same number. This test
  // makes the choice earn its place by beating the naive alternative outright.
  it('resists the noise spike a plain maximum would latch onto', () => {
    // footY is itself a max over six landmarks, so noise pushes spans upward.
    const truthPx = (1.8 * 400 * 0.936) / 0.9 // stature * scale * nose fraction / divisor

    for (const seed of [1, 2, 3, 4, 5]) {
      const clip = generateJump({
        jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
        videoWidth: VIDEO.width, videoHeight: VIDEO.height, statureM: 1.8,
        noiseSigma: 0.01, seed,
      })
      const track = buildComTrack(clip.frames, VIDEO)

      const spans = clip.frames.map((f) => {
        const foot = Math.max(...FOOT_LANDMARKS.map((i) => f.landmarks[i]!.y * VIDEO.height))
        return foot - f.landmarks[LM.NOSE]!.y * VIDEO.height
      })
      const naivePx = Math.max(...spans) / 0.9

      expect(Math.abs(track.staturePx - truthPx)).toBeLessThan(Math.abs(naivePx - truthPx))
    }
  })

  it('returns empty arrays for an empty clip rather than throwing', () => {
    const track = buildComTrack([], VIDEO)
    expect(track.times).toEqual([])
    expect(track.comY).toEqual([])
    expect(track.footY).toEqual([])
    expect(track.staturePx).toBe(0)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./comTrack"`.

- [ ] **Step 3: Создать `src/lib/comTrack.ts`**

```ts
import { centreOfMass } from './bodyModel'
import { FOOT_LANDMARKS, LM, type PoseFrame, type VideoSize } from './poseTypes'

export interface ComTrack {
  /** Frame presentation times, seconds. */
  times: number[]
  /** Body centre of mass, vertical pixels, y down. */
  comY: number[]
  /** Lowest point of either foot, vertical pixels, y down. */
  footY: number[]
  /** Standing height in pixels, used to normalize thresholds by the person. */
  staturePx: number
}

/** Where the nose sits as a fraction of stature. Approximate on purpose. */
const NOSE_HEIGHT_FRACTION = 0.9

/**
 * Which percentile of (foot - nose) counts as "standing upright".
 *
 * The threat this guards against is noise, not the flight phase. Tucking the
 * legs *lowers* foot - nose, and the largest span comes from the standing
 * frames regardless, so airborne frames cannot inflate the estimate. What can
 * is noise: footY is itself a maximum over six landmarks, so it is already
 * biased upward, while the nose is a single sample. A plain maximum would
 * chase the largest spike in the clip; a high percentile does not.
 */
const STANDING_PERCENTILE = 0.9

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[index]!
}

export function buildComTrack(frames: PoseFrame[], video: VideoSize): ComTrack {
  const times: number[] = []
  const comY: number[] = []
  const footY: number[] = []
  const spans: number[] = []

  for (const frame of frames) {
    times.push(frame.time)
    comY.push(centreOfMass(frame.landmarks).y * video.height)

    let lowest = -Infinity
    for (const index of FOOT_LANDMARKS) {
      const y = frame.landmarks[index]!.y * video.height
      if (y > lowest) lowest = y
    }
    footY.push(lowest)

    spans.push(lowest - frame.landmarks[LM.NOSE]!.y * video.height)
  }

  spans.sort((a, b) => a - b)
  const staturePx = frames.length === 0
    ? 0
    : percentile(spans, STANDING_PERCENTILE) / NOSE_HEIGHT_FRACTION

  return { times, comY, footY, staturePx }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 36 + 6 новых = 42.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/comTrack.ts src/lib/comTrack.test.ts
git commit -m "Add centre-of-mass, foot and stature tracking"
```

---

### Task 4: Границы фазы полёта, включая субкадровые моменты

**Files:**
- Create: `src/lib/flightPhase.ts`
- Create: `src/lib/flightPhase.test.ts`

**Interfaces:**
- Consumes: `ComTrack`
- Produces: `FlightPhase { takeoffFrame: number; landingFrame: number; takeoffTime: number; landingTime: number; floorY: number }`, `findFlightPhase(track: ComTrack): FlightPhase | null`

Субкадровые моменты — не украшение. Разбор с числами в спеке, п. 6.3: подстановка времени первого воздушного кадра занижает высоту на 2.6 см при 60 fps и на 5.1 см при 30 fps, потому что на отрыве ЦТ движется быстрее, чем когда-либо ещё за полёт.

Оценка строится **только по воздушным кадрам**. Провести прямую через последний кадр контакта нельзя: там стопа по определению на полу, поэтому прямая пересечёт уровень пола ровно в этом кадре при любой скорости, и смещение «поздно на полкадра» просто сменится на «рано на полкадра».

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/flightPhase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findFlightPhase } from './flightPhase'
import { buildComTrack } from './comTrack'
import { generateJump } from './testing/syntheticJumper'
import type { ComTrack } from './comTrack'

/** A hand-built track: flat floor, then a lift, then back down. */
function track(footY: number[], fps = 60): ComTrack {
  return {
    times: footY.map((_, i) => i / fps),
    comY: footY.map(() => 0),
    footY,
    staturePx: 500,
  }
}

describe('findFlightPhase', () => {
  it('returns null when the feet never leave the floor', () => {
    expect(findFlightPhase(track([100, 100, 100, 100, 100]))).toBeNull()
  })

  it('finds the boundaries of the airborne run', () => {
    // threshold = 0.02 * 500 = 10px, so 100 -> 80 counts as airborne
    const phase = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))!
    expect(phase.takeoffFrame).toBe(2)
    expect(phase.landingFrame).toBe(5)
  })

  it('picks the longest run when the feet lift more than once', () => {
    const phase = findFlightPhase(track([100, 60, 100, 100, 60, 60, 60, 100]))!
    expect(phase.takeoffFrame).toBe(4)
    expect(phase.landingFrame).toBe(7)
  })

  it('rejects an airborne run longer than 1.5 seconds', () => {
    // The standing frames have to outnumber the airborne ones, otherwise the
    // 90th-percentile floor lands on the airborne value and nothing registers
    // as a lift at all — the test would pass for the wrong reason.
    const stand = Array.from({ length: 40 }, () => 100)
    const air = Array.from({ length: 100 }, () => 60) // 100 frames at 60 fps = 1.67 s
    expect(findFlightPhase(track([...stand, ...air, ...stand]))).toBeNull()
  })

  it('accepts an airborne run just under the limit', () => {
    const stand = Array.from({ length: 40 }, () => 100)
    const air = Array.from({ length: 80 }, () => 60) // 1.33 s
    expect(findFlightPhase(track([...stand, ...air, ...stand]))).not.toBeNull()
  })

  it('places takeoff between the last contact frame and the first airborne one', () => {
    const phase = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))!
    expect(phase.takeoffTime).toBeGreaterThanOrEqual(1 / 60)
    expect(phase.takeoffTime).toBeLessThanOrEqual(2 / 60)
    expect(phase.landingTime).toBeGreaterThanOrEqual(4 / 60)
    expect(phase.landingTime).toBeLessThanOrEqual(5 / 60)
  })

  it('recovers the generated takeoff instant to better than a third of a frame', () => {
    for (const fps of [30, 60]) {
      for (const takeoffPhase of [0.2, 0.5, 0.8]) {
        const clip = generateJump({
          jumpHeightM: 0.5, scalePxPerM: 400, fps,
          videoWidth: 720, videoHeight: 1280, takeoffPhase,
        })
        const phase = findFlightPhase(buildComTrack(clip.frames, { width: 720, height: 1280 }))!
        expect(Math.abs(phase.takeoffTime - clip.truth.takeoffTime)).toBeLessThan(1 / (3 * fps))
      }
    }
  })

  it('survives a flight phase that starts on the very first frame', () => {
    const phase = findFlightPhase(track([60, 60, 60, 100, 100]))!
    expect(phase.takeoffFrame).toBe(0)
    expect(phase.takeoffTime).toBe(0)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./flightPhase"`.

- [ ] **Step 3: Создать `src/lib/flightPhase.ts`**

```ts
import type { ComTrack } from './comTrack'

export interface FlightPhase {
  /** First airborne frame. */
  takeoffFrame: number
  /** First frame back in contact after the airborne run. */
  landingFrame: number
  /** Sub-frame takeoff instant, seconds. */
  takeoffTime: number
  /** Sub-frame landing instant, seconds. */
  landingTime: number
  floorY: number
}

/** The foot is on the ground most of the clip, so a high percentile is the floor. */
const FLOOR_PERCENTILE = 0.9
/** Airborne once the foot clears this fraction of the person's own height. */
const AIRBORNE_THRESHOLD_FRACTION = 0.02
/** Nobody stays in the air this long; a longer run is not a jump. */
const MAX_FLIGHT_SECONDS = 1.5
/** How many airborne frames feed the sub-frame edge estimate. */
const EDGE_FIT_FRAMES = 4

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[index]!
}

/** Least-squares slope and intercept of y over t. Returns null if t never varies. */
function fitLine(t: number[], y: number[]): { a: number; b: number } | null {
  const n = t.length
  if (n < 2) return null
  const meanT = t.reduce((s, v) => s + v, 0) / n
  const meanY = y.reduce((s, v) => s + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (t[i]! - meanT) * (y[i]! - meanY)
    den += (t[i]! - meanT) ** 2
  }
  if (den === 0) return null
  const b = num / den
  return { a: meanY - b * meanT, b }
}

/**
 * When did the foot cross the floor?
 *
 * Fitted over airborne frames ONLY. The tempting two-point interpolation
 * through the last contact frame does not work: the foot is on the floor at
 * that frame by definition, so the line crosses the floor exactly there
 * whatever the speed — trading a half-frame-late bias for a half-frame-early
 * one. Extrapolating the airborne trajectory backwards has no such anchor.
 */
function crossingTime(
  times: number[], footY: number[], indices: number[], floorY: number, fallback: number,
  bounds: [number, number]
): number {
  const line = fitLine(indices.map((i) => times[i]!), indices.map((i) => footY[i]!))
  if (!line || line.b === 0) return fallback
  const t = (floorY - line.a) / line.b
  if (!Number.isFinite(t)) return fallback
  // Takeoff cannot precede the last contact frame, nor follow the first
  // airborne one. Clamping keeps a bad extrapolation physically possible.
  return Math.min(bounds[1], Math.max(bounds[0], t))
}

export function findFlightPhase(track: ComTrack): FlightPhase | null {
  const { times, footY, staturePx } = track
  if (footY.length === 0 || staturePx <= 0) return null

  const floorY = percentile(footY, FLOOR_PERCENTILE)
  const threshold = AIRBORNE_THRESHOLD_FRACTION * staturePx

  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let i = 0; i <= footY.length; i++) {
    const airborne = i < footY.length && floorY - footY[i]! > threshold
    if (airborne && start === -1) start = i
    if (!airborne && start !== -1) {
      if (i - start > bestLength) {
        bestLength = i - start
        bestStart = start
      }
      start = -1
    }
  }
  if (bestStart === -1) return null

  const takeoffFrame = bestStart
  const landingFrame = bestStart + bestLength
  if (landingFrame >= times.length) return null

  const duration = times[landingFrame]! - times[takeoffFrame]!
  if (duration > MAX_FLIGHT_SECONDS) return null

  const leading = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, bestLength) },
    (_, k) => takeoffFrame + k
  )
  const trailing = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, bestLength) },
    (_, k) => landingFrame - 1 - k
  ).reverse()

  const takeoffTime = takeoffFrame === 0
    ? times[0]!
    : crossingTime(times, footY, leading, floorY, times[takeoffFrame]!,
        [times[takeoffFrame - 1]!, times[takeoffFrame]!])

  const landingTime = crossingTime(times, footY, trailing, floorY, times[landingFrame]!,
    [times[landingFrame - 1]!, times[landingFrame]!])

  return { takeoffFrame, landingFrame, takeoffTime, landingTime, floorY }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 42 + 8 новых = 50.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/flightPhase.ts src/lib/flightPhase.test.ts
git commit -m "Detect the flight phase with sub-frame takeoff and landing"
```

---

### Task 5: Подгонка параболы

**Files:**
- Create: `src/lib/parabolaFit.ts`
- Create: `src/lib/parabolaFit.test.ts`

**Interfaces:**
- Consumes: `GRAVITY`
- Produces: `ParabolaFit { c0, c1, c2, aPx, scalePxPerM, tApex, yApex, rSquared, rmsResidualPx, n }`, `fitParabola(times: number[], values: number[]): ParabolaFit | null`

Ключевой момент: подгонка ведётся в **центрированном** времени. Метки времени в клипе доходят до десятков секунд, а нормальные уравнения содержат `t⁴` — без центрирования числа расходятся на порядки и решение теряет точность. Коэффициенты потом разворачиваются обратно в исходную шкалу, потому что `jumpFromCom` подставляет в них абсолютное время отрыва.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/parabolaFit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fitParabola } from './parabolaFit'
import { GRAVITY } from './physics'

/** Samples of y = c0 + c1 t + c2 t^2 at n evenly spaced points. */
function samples(c0: number, c1: number, c2: number, n: number, dt: number, t0 = 0) {
  const times = Array.from({ length: n }, (_, i) => t0 + i * dt)
  return { times, values: times.map((t) => c0 + c1 * t + c2 * t * t) }
}

describe('fitParabola', () => {
  it('recovers exact coefficients from clean samples', () => {
    const { times, values } = samples(100, -300, 1962, 30, 1 / 60)
    const fit = fitParabola(times, values)!
    expect(fit.c0).toBeCloseTo(100, 4)
    expect(fit.c1).toBeCloseTo(-300, 4)
    expect(fit.c2).toBeCloseTo(1962, 4)
    expect(fit.rSquared).toBeCloseTo(1, 10)
    expect(fit.rmsResidualPx).toBeCloseTo(0, 6)
  })

  it('stays accurate when the clip timestamps are far from zero', () => {
    const { times, values } = samples(100, -300, 1962, 30, 1 / 60, 42)
    const fit = fitParabola(times, values)!
    expect(fit.c2).toBeCloseTo(1962, 3)
  })

  it('derives the pixels-per-metre scale from the fitted gravity', () => {
    const scale = 400
    // a_px = g * scale, and c2 = a_px / 2
    const { times, values } = samples(0, -1000, (GRAVITY * scale) / 2, 30, 1 / 60)
    const fit = fitParabola(times, values)!
    expect(fit.scalePxPerM).toBeCloseTo(scale, 6)
    expect(fit.aPx).toBeCloseTo(GRAVITY * scale, 6)
  })

  it('locates the apex as the minimum of a screen-space parabola', () => {
    // y down: the apex of the jump is the smallest y.
    const { times, values } = samples(1000, -400, 1962, 40, 1 / 60)
    const fit = fitParabola(times, values)!
    expect(fit.tApex).toBeCloseTo(400 / (2 * 1962), 6)
    expect(fit.yApex).toBeCloseTo(1000 - (400 * 400) / (4 * 1962), 4)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(fit.yApex - 1e-6)
  })

  it('drops the R squared when the samples are not parabolic', () => {
    const times = Array.from({ length: 20 }, (_, i) => i / 60)
    const values = times.map((t, i) => 1000 + 1962 * t * t + (i % 2 === 0 ? 40 : -40))
    const fit = fitParabola(times, values)!
    expect(fit.rSquared).toBeLessThan(0.99)
    expect(fit.rmsResidualPx).toBeGreaterThan(10)
  })

  it('refuses a fit that curves the wrong way', () => {
    const { times, values } = samples(0, 100, -500, 20, 1 / 60)
    expect(fitParabola(times, values)).toBeNull()
  })

  it('refuses fewer than three points', () => {
    expect(fitParabola([0, 1], [0, 1])).toBeNull()
  })

  it('refuses samples that share a single timestamp', () => {
    expect(fitParabola([1, 1, 1, 1], [0, 1, 2, 3])).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./parabolaFit"`.

- [ ] **Step 3: Создать `src/lib/parabolaFit.ts`**

```ts
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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 50 + 8 новых = 58.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/parabolaFit.ts src/lib/parabolaFit.test.ts
git commit -m "Fit the flight parabola and solve px-per-metre from gravity"
```

---

### Task 6: Сборка результата

**Files:**
- Create: `src/lib/jumpFromCom.ts`
- Create: `src/lib/jumpFromCom.test.ts`

**Interfaces:**
- Consumes: `GRAVITY`, `PoseFrame`, `VideoSize`, `buildComTrack`, `findFlightPhase`, `fitParabola`
- Produces: `JumpAnalysis`, `analyseJump(frames: PoseFrame[], video: VideoSize): JumpAnalysis | null`

Подгонка ведётся по кадрам полёта, **обрезанным на один с каждого края**: крайние кадры ближе всего к контакту, и на них с наибольшей вероятностью попадёт смаз или остаток опоры.

`y_отрыва` снимается **с подогнанной кривой**, а не с измеренной точки: сырая точка несёт весь шум одного кадра, кривая усреднена по двум-трём десяткам. Это и есть подавление шума в ~√30 ≈ 5 раз, ради которого метод затевался.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/jumpFromCom.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { analyseJump } from './jumpFromCom'
import { generateJump } from './testing/syntheticJumper'
import { LANDMARK_COUNT, type PoseFrame } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }
const BASE = {
  jumpHeightM: 0.5, scalePxPerM: 400, fps: 60,
  videoWidth: VIDEO.width, videoHeight: VIDEO.height,
}

describe('analyseJump', () => {
  it('returns null when there is no jump in the clip', () => {
    const flat: PoseFrame[] = Array.from({ length: 30 }, (_, i) => ({
      time: i / 60,
      landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 })),
    }))
    expect(analyseJump(flat, VIDEO)).toBeNull()
  })

  it('returns null for an empty clip', () => {
    expect(analyseJump([], VIDEO)).toBeNull()
  })

  it('recovers the generated jump height', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.comHeightCm).toBeGreaterThan(49)
    expect(result.comHeightCm).toBeLessThan(51)
  })

  it('recovers the pixels-per-metre scale without being told the stature', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.scalePxPerM).toBeGreaterThan(396)
    expect(result.scalePxPerM).toBeLessThan(404)
  })

  it('reports a stature inside the plausible human band', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.statureM).toBeGreaterThan(1.3)
    expect(result.statureM).toBeLessThan(2.2)
  })

  it('agrees with the flight-time formula on a symmetric jump', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    const relative = Math.abs(result.comHeightCm - result.flightTimeHeightCm) / result.comHeightCm
    expect(relative).toBeLessThan(0.05)
  })

  it('fits a clean parabola on noiseless input', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(result.rSquared).toBeGreaterThan(0.999)
    expect(result.flightFrames).toBeGreaterThan(8)
  })

  it('quotes an error bar that grows with the noise', () => {
    const clean = analyseJump(generateJump(BASE).frames, VIDEO)!
    const noisy = analyseJump(generateJump({ ...BASE, noiseSigma: 0.005, seed: 7 }).frames, VIDEO)!
    expect(noisy.errorCm).toBeGreaterThan(clean.errorCm)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./jumpFromCom"`.

- [ ] **Step 3: Создать `src/lib/jumpFromCom.ts`**

```ts
import { GRAVITY } from './physics'
import { buildComTrack } from './comTrack'
import { findFlightPhase } from './flightPhase'
import { fitParabola } from './parabolaFit'
import type { PoseFrame, VideoSize } from './poseTypes'

export interface JumpAnalysis {
  /** Rise of the centre of mass from takeoff to apex, centimetres. */
  comHeightCm: number
  /** What the flight-time formula would say about the same jump. */
  flightTimeHeightCm: number
  flightTimeSeconds: number
  /** The athlete's height in metres, solved from the fitted scale. */
  statureM: number
  scalePxPerM: number
  /** Deliberately conservative one-sigma estimate, centimetres. */
  errorCm: number
  rSquared: number
  /** Frames that actually fed the parabola fit. */
  flightFrames: number
  takeoffFrame: number
  landingFrame: number
}

/**
 * Frames dropped from each end of the airborne run before fitting. The edge
 * frames sit closest to contact and are the likeliest to carry motion blur or
 * a lingering trace of the foot still loaded.
 */
const EDGE_TRIM_FRAMES = 1

export function analyseJump(frames: PoseFrame[], video: VideoSize): JumpAnalysis | null {
  const track = buildComTrack(frames, video)
  const phase = findFlightPhase(track)
  if (!phase) return null

  const from = phase.takeoffFrame + EDGE_TRIM_FRAMES
  const to = phase.landingFrame - EDGE_TRIM_FRAMES
  if (to - from < 3) return null

  const fit = fitParabola(track.times.slice(from, to), track.comY.slice(from, to))
  if (!fit) return null

  const { takeoffTime, landingTime } = phase
  // Read the takeoff height off the FITTED curve, not the measured sample:
  // one sample carries a whole frame's noise, the curve averages it over the
  // twenty-odd frames of flight.
  const yTakeoff = fit.c0 + fit.c1 * takeoffTime + fit.c2 * takeoffTime * takeoffTime
  const riseM = (yTakeoff - fit.yApex) / fit.scalePxPerM

  const flightTimeSeconds = landingTime - takeoffTime
  const flightTimeHeightM = (GRAVITY * flightTimeSeconds * flightTimeSeconds) / 8

  return {
    comHeightCm: riseM * 100,
    flightTimeHeightCm: flightTimeHeightM * 100,
    flightTimeSeconds,
    statureM: track.staturePx / fit.scalePxPerM,
    scalePxPerM: fit.scalePxPerM,
    errorCm: ((2 * fit.rmsResidualPx) / Math.sqrt(fit.n) / fit.scalePxPerM) * 100,
    rSquared: fit.rSquared,
    flightFrames: fit.n,
    takeoffFrame: phase.takeoffFrame,
    landingFrame: phase.landingFrame,
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 58 + 8 новых = 66.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/jumpFromCom.ts src/lib/jumpFromCom.test.ts
git commit -m "Assemble the centre-of-mass jump measurement"
```

---

### Task 7: Политика достоверности

**Files:**
- Modify: `src/lib/jumpFromCom.ts`
- Create: `src/lib/assess.test.ts`

**Interfaces:**
- Consumes: `JumpAnalysis`, `analyseJump`
- Produces: `QualityMetrics`, `Verdict`, `assess(m: QualityMetrics): Verdict`, `measureJump(frames, video): { analysis: JumpAnalysis | null; verdict: Verdict }`

Здесь единственное место в PR, где нет объективно правильного ответа — есть продуктовое решение, и оно уже принято. Цена ошибки несимметрична: слишком строгая политика приводит к усталости от ложных тревог, после чего предупреждения перестают читать; слишком мягкая — к тому, что человек публикует высоту, которой у него нет. Второе дороже.

Полоса роста намеренно широкая (1.3–2.2 м): проверка ловит отказ величиной в `k²`, то есть минимум четырёхкратный. Промежуточных случаев не бывает, зато узкая полоса начала бы срабатывать на подростках и неудачных ракурсах.

Проверка роста даёт `unusable`, а не `warn`: если она сработала, неверны **оба** числа на один и тот же множитель, и «180 см, но осторожно» хуже, чем ничего.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/assess.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assess, measureJump, type QualityMetrics } from './jumpFromCom'
import { generateJump } from './testing/syntheticJumper'

const VIDEO = { width: 720, height: 1280 }

const GOOD: QualityMetrics = {
  rSquared: 0.999,
  flightFrames: 30,
  statureM: 1.8,
  comHeightCm: 50,
  flightTimeHeightCm: 52,
}

describe('assess', () => {
  it('passes a clean measurement', () => {
    expect(assess(GOOD)).toEqual({ kind: 'ok', heightCm: 50 })
  })

  it('rejects a degenerate height before dividing by it', () => {
    expect(assess({ ...GOOD, comHeightCm: 0 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, comHeightCm: -3 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, comHeightCm: NaN }).kind).toBe('unusable')
  })

  it('rejects a flight too short to fit a curve through', () => {
    expect(assess({ ...GOOD, flightFrames: 7 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, flightFrames: 8 }).kind).toBe('ok')
  })

  it('rejects a trajectory that is not ballistic', () => {
    expect(assess({ ...GOOD, rSquared: 0.94 }).kind).toBe('unusable')
  })

  it('rejects an implausible stature and blames slow motion', () => {
    const tall = assess({ ...GOOD, statureM: 7.2 })
    expect(tall.kind).toBe('unusable')
    expect(tall.kind === 'unusable' && tall.message.length).toBeGreaterThan(0)
    expect(assess({ ...GOOD, statureM: 1.2 }).kind).toBe('unusable')
    expect(assess({ ...GOOD, statureM: 1.3 }).kind).toBe('ok')
    expect(assess({ ...GOOD, statureM: 2.2 }).kind).toBe('ok')
  })

  it('warns when the fit is merely acceptable', () => {
    const verdict = assess({ ...GOOD, rSquared: 0.97 })
    expect(verdict.kind).toBe('warn')
    expect(verdict.kind === 'warn' && verdict.heightCm).toBe(50)
  })

  it('warns when the two methods disagree by more than a fifth', () => {
    expect(assess({ ...GOOD, flightTimeHeightCm: 61 }).kind).toBe('warn')
    expect(assess({ ...GOOD, flightTimeHeightCm: 59 }).kind).toBe('ok')
  })

  it('lets the earlier check win when several fire at once', () => {
    // A bad stature AND a bad fit: the stature message must be the one shown.
    const verdict = assess({ ...GOOD, statureM: 7.2, rSquared: 0.96 })
    expect(verdict.kind).toBe('unusable')
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

  it('reports unusable with no analysis when there is no jump', () => {
    const result = measureJump([], VIDEO)
    expect(result.analysis).toBeNull()
    expect(result.verdict.kind).toBe('unusable')
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `assess is not exported from './jumpFromCom'`.

- [ ] **Step 3: Дописать в `src/lib/jumpFromCom.ts`**

```ts
export interface QualityMetrics {
  rSquared: number
  flightFrames: number
  statureM: number
  comHeightCm: number
  flightTimeHeightCm: number
}

export type Verdict =
  | { kind: 'ok'; heightCm: number }
  | { kind: 'warn'; heightCm: number; message: string }
  | { kind: 'unusable'; message: string }

const MIN_FLIGHT_FRAMES = 8
const MIN_USABLE_R_SQUARED = 0.95
const MIN_CLEAN_R_SQUARED = 0.99
const MIN_STATURE_M = 1.3
const MAX_STATURE_M = 2.2
const MAX_METHOD_DISAGREEMENT = 0.2

/**
 * Decides what the user is shown: a number, a number with a caveat, or a
 * refusal. Checks run in order and the first one to fire wins.
 *
 * The cost of being wrong is asymmetric, and that asymmetry sets every
 * threshold here. Too strict and warnings fire on ordinary jumps until people
 * stop reading them. Too lax and someone publishes a height they never
 * reached — which is worse, because the app's credibility lasts exactly until
 * the first debunked result.
 */
export function assess(m: QualityMetrics): Verdict {
  if (!Number.isFinite(m.comHeightCm) || m.comHeightCm <= 0) {
    return { kind: 'unusable', message: 'Не удалось измерить прыжок по этому видео.' }
  }
  if (m.flightFrames < MIN_FLIGHT_FRAMES) {
    return { kind: 'unusable', message: 'Слишком короткий полёт для анализа.' }
  }
  if (m.rSquared < MIN_USABLE_R_SQUARED) {
    return { kind: 'unusable', message: 'Не удалось проследить движение — снимайте сбоку, целиком в кадре.' }
  }
  // A scale error is always a factor of k squared, so at least fourfold. The
  // band is wide on purpose: it should never fire on a short teenager, only
  // on a timebase that is flatly wrong.
  if (m.statureM < MIN_STATURE_M || m.statureM > MAX_STATURE_M) {
    return { kind: 'unusable', message: 'Похоже, видео в замедленной съёмке — результат недостоверен.' }
  }
  if (m.rSquared < MIN_CLEAN_R_SQUARED) {
    return { kind: 'warn', heightCm: m.comHeightCm, message: 'Трекинг местами срывался — цифра приблизительная.' }
  }
  if (Math.abs(m.comHeightCm - m.flightTimeHeightCm) / m.comHeightCm > MAX_METHOD_DISAGREEMENT) {
    return { kind: 'warn', heightCm: m.comHeightCm, message: 'Поза на отрыве и приземлении заметно различаются.' }
  }
  return { kind: 'ok', heightCm: m.comHeightCm }
}

export function measureJump(
  frames: PoseFrame[], video: VideoSize
): { analysis: JumpAnalysis | null; verdict: Verdict } {
  const analysis = analyseJump(frames, video)
  if (!analysis) {
    return { analysis: null, verdict: { kind: 'unusable', message: 'Не нашли прыжок в этом видео.' } }
  }
  return { analysis, verdict: assess(analysis) }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. 66 + 10 новых = 76.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/jumpFromCom.ts src/lib/assess.test.ts
git commit -m "Add the confidence policy governing what the user is shown"
```

---

### Task 8: Приёмочные тесты на синтетическом прыгуне

**Files:**
- Create: `src/lib/acceptance.test.ts`

**Interfaces:**
- Consumes: всё из задач 1–7
- Produces: ничего (последняя задача PR-B)

Это то, ради чего PR-B существует. Каждый тест здесь отвечает на вопрос, который иначе пришлось бы выяснять на живом видео вслепую.

Отдельно про тест с поджатием ног: он **обосновывает всю таблицу Dempster**. Середина бёдер — прокси, не зависящий от таблицы вовсе, поэтому сравнение с ним осмысленно даже при том, что генератор и `centreOfMass` делят одну модель масс.

Важно, почему поджатие в генераторе несимметрично. Симметричный горб `sin(π·t/T)` сам почти парабола (`sin(πx) ≈ 4x(1−x)` с точностью ~5 %), поэтому МНК поглощает его, занижая `c₂` — а вместе с ним и масштаб — ровно настолько же, насколько занижается измеренный подъём. Ошибки сокращаются, и таз выдаёт почти верную высоту. Тест доказывал бы обратное тому, что заявлено. Скошенная форма с максимумом около 31 % полёта и на параболу не похожа, и ближе к тому, как люди прыгают на самом деле.

**Пороги в этом файле — предсказания, а не подогнанные числа.** Если тест не проходит, сообщите фактическое значение и статус `DONE_WITH_CONCERNS`. Ослабить порог, чтобы тест позеленел, — значит уничтожить единственное свидетельство, ради которого он написан.

- [ ] **Step 1: Написать тесты**

Создать `src/lib/acceptance.test.ts`:

```ts
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
  it('lands within 1 cm at 60 fps', () => {
    const result = analyseJump(generateJump(BASE).frames, VIDEO)!
    expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
  })

  // 30 fps is where sub-frame takeoff earns its keep: sampling the parabola at
  // the first airborne frame instead would cost about 5 cm here.
  it('lands within 1 cm at 30 fps, wherever takeoff falls inside the frame', () => {
    for (const takeoffPhase of [0.1, 0.35, 0.5, 0.75, 0.95]) {
      const result = analyseJump(
        generateJump({ ...BASE, fps: 30, takeoffPhase }).frames, VIDEO
      )!
      expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
    }
  })

  it('gives the same answer for the same clip every time', () => {
    const clip = generateJump(BASE)
    const a = analyseJump(clip.frames, VIDEO)!
    const b = analyseJump(clip.frames, VIDEO)!
    expect(a.comHeightCm).toBe(b.comHeightCm)
  })

  it('holds across a range of jump heights', () => {
    for (const jumpHeightM of [0.2, 0.35, 0.5, 0.7, 0.9]) {
      const result = analyseJump(generateJump({ ...BASE, jumpHeightM }).frames, VIDEO)!
      expect(Math.abs(result.comHeightCm - jumpHeightM * 100)).toBeLessThan(1)
    }
  })
})

describe('acceptance: why the segment model was necessary', () => {
  it('stays accurate when the athlete tucks their legs', () => {
    const result = analyseJump(generateJump({ ...BASE, tuckM: 0.25 }).frames, VIDEO)!
    expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
    expect(result.rSquared).toBeGreaterThan(0.999)
  })

  // The hip midpoint owes nothing to the Dempster table, so this comparison
  // is meaningful even though the generator and centreOfMass share that table.
  it('would be wrong on the same jump if the hip midpoint stood in for the com', () => {
    const clip = generateJump({ ...BASE, tuckM: 0.35 })
    const track = buildComTrack(clip.frames, VIDEO)
    const phase = findFlightPhase(track)!
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
  it('averages landmark noise down to within 1 cm', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = analyseJump(
        generateJump({ ...BASE, noiseSigma: 0.005, seed }).frames, VIDEO
      )!
      expect(Math.abs(result.comHeightCm - 50)).toBeLessThan(1)
    }
  })

  it('catches baked-in slow motion through an impossible stature', () => {
    const result = measureJump(generateJump({ ...BASE, timeScale: 2 }).frames, VIDEO)
    expect(result.analysis).not.toBeNull()
    expect(result.verdict.kind).toBe('unusable')
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
})
```

- [ ] **Step 2: Запустить тесты**

Run: `npm test`
Expected: PASS. 76 + 11 новых = 87.

**Если какой-то приёмочный порог не проходит — не ослабляйте его молча.** Сообщите фактическое значение и статус `DONE_WITH_CONCERNS`. Пороги здесь взяты из спеки и означают обещания пользователю; если конвейер их не держит, это результат, а не помеха.

- [ ] **Step 3: Проверить типы и сборку**

Run: `npm run build`
Expected: без ошибок.

- [ ] **Step 4: Убедиться, что `src/lib` остался чистым**

Run: `grep -rn "from 'vue'\|from \"vue\"\|document\.\|window\.\|Math.random\|Date.now" src/lib/`
Expected: ни одного совпадения.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/acceptance.test.ts
git commit -m "Add acceptance tests proving the pipeline on a known jump"
```

---

## Что из раздела 9 спеки сюда не входит

Регрессионный фикстур на ландмарках реального клипа (спека, п. 9.2) в PR-B невозможен: чтобы его записать, нужны настоящее видео и работающая модель, а они появляются только в PR-C. Пункт переезжает в PR-C, где становится дешёвым — пайплайн там уже будет уметь выдавать ландмарки, останется сериализовать один прогон в JSON.

## Определение готовности

- `npm test` — 87 тестов проходят
- `npm run build` — без ошибок
- `grep` из Task 8 Step 4 — пусто: ни Vue, ни DOM, ни недетерминированности в `src/lib/`
- Высота восстанавливается в пределах 1 см при 30 и 60 fps, с поджатием ног и с шумом σ = 0.005
- Замедленная съёмка ловится проверкой роста
- Ни одна строка вне `src/lib/` не тронута
