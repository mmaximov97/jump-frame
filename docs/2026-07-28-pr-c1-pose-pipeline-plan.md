# PR-C1: пайплайн позы — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести реальное видео до измеренной высоты прыжка: MediaPipe Pose в браузере, проход по кадрам, ландмарки в готовое ядро PR-B — и минимальная кнопка, чтобы это запустить на своём клипе.

**Architecture:** Планирование кадров и оценка шума ландмарок — чистые функции в `src/lib/` под тестами. Всё, что трогает `<video>` и WASM, живёт в одном тонком композабле `usePoseDetection`, который эти функции вызывает. Интерфейс в этом PR намеренно уродливый: кнопка, прогресс и текстовая сводка. Оформление — PR-C2.

**Tech Stack:** Vue 3 (Composition API), Vite, TypeScript, Vitest, `@mediapipe/tasks-vision`.

**Спека:** `docs/2026-07-27-com-tracking-and-zoom-design.md`, раздел 7.

## Global Constraints

- TypeScript strict. Включены `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` — никаких `enum` (только `as const` или union), никаких параметров-свойств конструктора, никаких неиспользуемых импортов.
- Наследуемый `@vue/tsconfig` включает `noUncheckedIndexedAccess` (значит `arr[i]` имеет тип `T | undefined`, и `!` в коде плана обязателен) и `verbatimModuleSyntax` (смешанные импорты значений и типов требуют инлайнового `type`).
- `src/lib/**` не импортирует Vue, не обращается к DOM, не вызывает `Math.random()` и `Date.now()`. Это правило действует и для новых файлов.
- Видео не покидает клиент. Единственный сетевой запрос за всё время — загрузка файла модели, и только по явному действию пользователя.
- `vite.config.ts` задаёт `base: '/jump-frame/'`. Все пути к ассетам строятся через `import.meta.env.BASE_URL`, иначе 404 и в разработке, и в проде.
- Ось `y` растёт вниз.
- В сообщениях коммитов **не добавлять** строки `Co-Authored-By`.
- Не запускать `git push`.
- Ничего не менять в `src/lib/bodyModel.ts`, `comTrack.ts`, `flightPhase.ts`, `parabolaFit.ts`, `jumpFromCom.ts`, `physics.ts`, `stats.ts`, `zoomMath.ts` — ядро PR-B закрыто и отревьюено.

---

## Что уже готово и что этот PR потребляет

Ядро PR-B принимает ландмарки и возвращает число с вердиктом:

```ts
// src/lib/poseTypes.ts
export interface Vec2 { x: number; y: number }
export type Landmark = Vec2
export interface PoseFrame { time: number; landmarks: Landmark[] }  // ровно 33
export interface VideoSize { width: number; height: number }        // width не используется
export const LANDMARK_COUNT = 33

// src/lib/jumpFromCom.ts
export interface JumpAnalysis {
  comHeightCm: number; flightTimeHeightCm: number; flightTimeSeconds: number
  statureM: number; scalePxPerM: number; errorCm: number
  rSquared: number; flightFrames: number; takeoffFrame: number; landingFrame: number
}
export type VerdictReason =
  | 'no-flight' | 'short-flight' | 'tracking-lost'
  | 'slow-motion' | 'degenerate-fit' | 'pose-asymmetry'
export type Verdict =
  | { kind: 'ok'; heightCm: number }
  | { kind: 'warn'; heightCm: number; message: string; reason: VerdictReason }
  | { kind: 'unusable'; message: string; reason: VerdictReason }
export function measureJump(
  frames: PoseFrame[], video: VideoSize
): { analysis: JumpAnalysis | null; verdict: Verdict }
```

`measureJump` не бросает исключений на кривом входе: кадры с числом ландмарок, отличным от 33, пропускаются, а пустой клип даёт `unusable` с причиной `no-flight`.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `scripts/fetch-mediapipe.mjs` — создать | Кладёт WASM и модель в `public/mediapipe/`. Идемпотентный |
| `.gitignore` — изменить | `public/mediapipe/` |
| `package.json` — изменить | Зависимость, `predev`/`prebuild`, `fetch:mediapipe` |
| `src/lib/framePlan.ts` — создать | Чистое планирование проходов: какие моменты времени опрашивать |
| `src/lib/framePlan.test.ts` — создать | Тесты к нему |
| `src/lib/landmarkScatter.ts` — создать | Чистая оценка σ ландмарок по неподвижному участку |
| `src/lib/landmarkScatter.test.ts` — создать | Тесты к ней |
| `src/composables/usePoseDetection.ts` — создать | Жизненный цикл модели, цикл seek-and-detect, прогресс, отмена |
| `src/App.vue` — изменить | Кнопка «Найти прыжок», прогресс, текстовая сводка |

## Чего в этом PR намеренно нет

Скелета поверх видео, маркеров на таймлайне, переработанной карточки результата, `useMeasurement`, миграции истории. Всё это — PR-C2, и оно не нужно, чтобы ответить на вопрос «работает ли метод на реальном видео».

---

### Task 1: Ассеты MediaPipe

**Files:**
- Create: `scripts/fetch-mediapipe.mjs`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Consumes: ничего
- Produces: `public/mediapipe/wasm/*` и `public/mediapipe/pose_landmarker_lite.task` на диске; npm-скрипт `fetch:mediapipe`

Спека предупреждает, что файлы WASM обязаны быть той же версии, что и npm-пакет, иначе инициализация ломается. Скачивание WASM с CDN этого не гарантирует. Поэтому WASM **копируется из `node_modules/@mediapipe/tasks-vision/wasm/`** — версия совпадает по построению. Скачивается только файл модели, которого в пакете нет.

- [ ] **Step 1: Установить зависимость**

```bash
npm install @mediapipe/tasks-vision
```

- [ ] **Step 2: Создать `scripts/fetch-mediapipe.mjs`**

```js
// Puts MediaPipe's runtime and model where Vite can serve them.
//
// The WASM is COPIED from node_modules rather than downloaded: the runtime and
// the JS bindings must be the same version or initialisation fails, and copying
// from the installed package makes that true by construction instead of by
// remembering to bump two numbers together.
//
// Only the model file is fetched — it does not ship inside the npm package.
import { createWriteStream } from 'node:fs'
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WASM_SRC = join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')
const OUT = join(ROOT, 'public/mediapipe')
const MODEL_NAME = 'pose_landmarker_lite.task'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!(await exists(WASM_SRC))) {
    console.error(
      '[mediapipe] @mediapipe/tasks-vision is not installed — run npm install first.'
    )
    process.exit(1)
  }

  await mkdir(OUT, { recursive: true })

  const wasmOut = join(OUT, 'wasm')
  if (await exists(wasmOut)) {
    console.log('[mediapipe] wasm already present, skipping')
  } else {
    await cp(WASM_SRC, wasmOut, { recursive: true })
    console.log('[mediapipe] copied wasm from node_modules')
  }

  const modelOut = join(OUT, MODEL_NAME)
  if (await exists(modelOut)) {
    console.log('[mediapipe] model already present, skipping')
    return
  }

  console.log(`[mediapipe] downloading ${MODEL_NAME} (~5 MB)`)
  const response = await fetch(MODEL_URL)
  if (!response.ok || !response.body) {
    console.error(`[mediapipe] download failed: ${response.status} ${response.statusText}`)
    process.exit(1)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(modelOut))
  console.log('[mediapipe] model ready')
}

main().catch((error) => {
  console.error('[mediapipe]', error)
  process.exit(1)
})
```

- [ ] **Step 3: Игнорировать артефакты**

Дописать в `.gitignore`:

```
# MediaPipe runtime and model — fetched by scripts/fetch-mediapipe.mjs
public/mediapipe/
```

- [ ] **Step 4: Прописать скрипты в `package.json`**

В блок `"scripts"` добавить три строки:

```json
    "fetch:mediapipe": "node scripts/fetch-mediapipe.mjs",
    "predev": "node scripts/fetch-mediapipe.mjs",
    "prebuild": "node scripts/fetch-mediapipe.mjs",
```

- [ ] **Step 5: Проверить**

Run: `npm run fetch:mediapipe`
Expected: сообщения о копировании WASM и загрузке модели.

Run: `npm run fetch:mediapipe`
Expected: оба шага сообщают `skipping` — скрипт идемпотентен.

Run: `ls -la public/mediapipe/ public/mediapipe/wasm/ | head -20`
Expected: файл `pose_landmarker_lite.task` около 5 МБ и каталог `wasm` с `.wasm` и `.js` внутри.

Run: `git status --short`
Expected: `public/mediapipe/` не появляется — он проигнорирован.

- [ ] **Step 6: Коммит**

```bash
git add package.json package-lock.json .gitignore scripts/fetch-mediapipe.mjs
git commit -m "Fetch MediaPipe runtime and pose model into public/"
```

---

### Task 2: Планирование проходов по кадрам

**Files:**
- Create: `src/lib/framePlan.ts`
- Create: `src/lib/framePlan.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `COARSE_STRIDE`, `FINE_WINDOW_SECONDS`, `planCoarsePass(duration: number, fps: number): number[]`, `planFinePass(times: number[], airborneIndices: number[], duration: number, fps: number): number[]`

Сплошной проход по десятисекундному клипу при 60 fps — это 600 вызовов детектора и 15–25 секунд ожидания. Двухпроходная схема даёт примерно впятеро меньше: грубый проход каждый шестой кадр находит окно полёта, плотный опрашивает каждый кадр только вокруг его границ.

Планирование вынесено в чистую функцию намеренно: расписание опроса — это арифметика, а не работа с DOM, и ошибка в ней (пропущенный кадр у границы, дубли, выход за длительность) иначе проявилась бы как необъяснимая неточность на реальном видео.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/framePlan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { COARSE_STRIDE, FINE_WINDOW_SECONDS, planCoarsePass, planFinePass } from './framePlan'

describe('planCoarsePass', () => {
  it('samples every COARSE_STRIDE-th frame across the clip', () => {
    const times = planCoarsePass(1, 60)
    expect(times[0]).toBeCloseTo(0, 10)
    expect(times[1]).toBeCloseTo(COARSE_STRIDE / 60, 10)
    expect(times.length).toBe(Math.ceil(60 / COARSE_STRIDE))
  })

  it('never proposes a time at or past the duration', () => {
    for (const t of planCoarsePass(2.05, 30)) {
      expect(t).toBeLessThan(2.05)
      expect(t).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns strictly increasing times', () => {
    const times = planCoarsePass(3, 60)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!)
    }
  })

  it('returns nothing for a degenerate clip', () => {
    expect(planCoarsePass(0, 60)).toEqual([])
    expect(planCoarsePass(1, 0)).toEqual([])
  })
})

describe('planFinePass', () => {
  // A coarse pass at 60 fps with stride 6 samples every 0.1 s.
  const coarse = Array.from({ length: 30 }, (_, i) => i * 0.1)

  it('covers every frame within the window around the airborne run', () => {
    // airborne at coarse indices 10..14, i.e. 1.0 s .. 1.4 s
    const fine = planFinePass(coarse, [10, 11, 12, 13, 14], 3, 60)
    expect(Math.min(...fine)).toBeCloseTo(1.0 - FINE_WINDOW_SECONDS, 6)
    expect(Math.max(...fine)).toBeCloseTo(1.4 + FINE_WINDOW_SECONDS - 1 / 60, 6)
    // consecutive samples are one frame apart
    const sorted = [...fine].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(1 / 60, 6)
    }
  })

  it('clamps the window to the clip', () => {
    const fine = planFinePass(coarse, [0, 1], 3, 60)
    expect(Math.min(...fine)).toBeGreaterThanOrEqual(0)
    for (const t of fine) expect(t).toBeLessThan(3)
  })

  it('omits times the coarse pass already visited', () => {
    const fine = planFinePass(coarse, [10, 11], 3, 60)
    for (const t of fine) {
      expect(coarse.some((c) => Math.abs(c - t) < 1e-9)).toBe(false)
    }
  })

  it('returns nothing when no frame was airborne', () => {
    expect(planFinePass(coarse, [], 3, 60)).toEqual([])
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./framePlan"`.

- [ ] **Step 3: Создать `src/lib/framePlan.ts`**

```ts
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
  for (let t = 0; t < duration; t += step) times.push(t)
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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. Сообщите фактическое число тестов — базовая линия 105.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/framePlan.ts src/lib/framePlan.test.ts
git commit -m "Plan the coarse and dense detector passes"
```

---

### Task 3: Оценка шума ландмарок

**Files:**
- Create: `src/lib/landmarkScatter.ts`
- Create: `src/lib/landmarkScatter.test.ts`

**Interfaces:**
- Consumes: `PoseFrame`, `LANDMARK_COUNT`, `FOOT_LANDMARKS` из `./poseTypes`
- Produces: `LandmarkScatter { overall: number; feet: number; frames: number }`, `estimateScatter(frames: PoseFrame[]): LandmarkScatter | null`

Это измерительный прибор, а не часть измерения прыжка. Три открытых вопроса из PR-B — обещание точности при шуме, выбор между переклассификацией границы и простым кодом, и провал в 1.94 см при 240 fps — все калибровались против σ = 0.005, которая была выдумана. Эта функция даёт настоящее число.

Метод: взять самый длинный участок, где человек **не движется** (разброс положения ЦТ мал), и посчитать стандартное отклонение каждой координаты вокруг её среднего на этом участке. Отдельно по всем ландмаркам и отдельно по шести точкам стопы, потому что именно стопы работают в самом чувствительном месте конвейера.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/landmarkScatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estimateScatter } from './landmarkScatter'
import { LANDMARK_COUNT, LM, type PoseFrame } from './poseTypes'

/** A still pose with independent gaussian noise of a known sigma. */
function stillClip(frameCount: number, sigma: number, seed = 1): PoseFrame[] {
  let state = seed >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const gauss = () => {
    const u = Math.max(rand(), Number.EPSILON)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  return Array.from({ length: frameCount }, (_, i) => ({
    time: i / 60,
    landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({
      x: 0.5 + gauss() * sigma,
      y: 0.5 + gauss() * sigma,
    })),
  }))
}

describe('estimateScatter', () => {
  it('recovers the sigma it was given', () => {
    const result = estimateScatter(stillClip(120, 0.004))!
    expect(result.overall).toBeGreaterThan(0.0032)
    expect(result.overall).toBeLessThan(0.0048)
  })

  it('scales with the sigma', () => {
    const small = estimateScatter(stillClip(120, 0.002))!
    const large = estimateScatter(stillClip(120, 0.008))!
    expect(large.overall / small.overall).toBeGreaterThan(3)
    expect(large.overall / small.overall).toBeLessThan(5)
  })

  it('reports the feet separately', () => {
    const frames = stillClip(120, 0.002)
    // Make the feet three times noisier than everything else.
    let flip = 1
    for (const frame of frames) {
      flip = -flip
      for (const index of [LM.LEFT_HEEL, LM.RIGHT_HEEL, LM.LEFT_FOOT_INDEX,
                           LM.RIGHT_FOOT_INDEX, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) {
        frame.landmarks[index] = { x: 0.5, y: 0.5 + flip * 0.006 }
      }
    }
    const result = estimateScatter(frames)!
    expect(result.feet).toBeGreaterThan(result.overall)
  })

  it('reports how many frames it measured over', () => {
    const result = estimateScatter(stillClip(90, 0.003))!
    expect(result.frames).toBeGreaterThan(20)
    expect(result.frames).toBeLessThanOrEqual(90)
  })

  it('returns null when there is no still stretch to measure', () => {
    expect(estimateScatter([])).toBeNull()
    expect(estimateScatter(stillClip(5, 0.003))).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./landmarkScatter"`.

- [ ] **Step 3: Создать `src/lib/landmarkScatter.ts`**

```ts
import { FOOT_LANDMARKS, LANDMARK_COUNT, type PoseFrame } from './poseTypes'

export interface LandmarkScatter {
  /** Standard deviation over all landmarks, in normalized units. */
  overall: number
  /** The same, restricted to the six foot landmarks. */
  feet: number
  /** How many frames the estimate was measured over. */
  frames: number
}

/** Shortest run of frames worth estimating a standard deviation from. */
const MIN_STILL_FRAMES = 20

/** How many candidate windows to try when hunting for the stillest stretch. */
const WINDOW_FRAMES = 30

function meanOf(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * How much a landmark position wobbles frame to frame while the athlete stands
 * still — MediaPipe's own measurement noise, with none of the subject's motion
 * mixed in.
 *
 * This is instrumentation, not part of measuring a jump. Several thresholds in
 * the analysis core were calibrated against an invented sigma of 0.005; this
 * function supplies the real one so those choices can be revisited against a
 * number rather than a guess.
 *
 * The stillest window is chosen by the smallest spread of the mid-hip point,
 * which moves with the body but not with a waving arm.
 */
export function estimateScatter(frames: PoseFrame[]): LandmarkScatter | null {
  const usable = frames.filter((f) => f.landmarks.length === LANDMARK_COUNT)
  if (usable.length < MIN_STILL_FRAMES) return null

  const window = Math.min(WINDOW_FRAMES, usable.length)
  let bestStart = 0
  let bestSpread = Infinity
  for (let start = 0; start + window <= usable.length; start++) {
    const slice = usable.slice(start, start + window)
    const hipY = slice.map((f) => (f.landmarks[23]!.y + f.landmarks[24]!.y) / 2)
    const spread = Math.max(...hipY) - Math.min(...hipY)
    if (spread < bestSpread) {
      bestSpread = spread
      bestStart = start
    }
  }

  const still = usable.slice(bestStart, bestStart + window)
  const footSet = new Set<number>(FOOT_LANDMARKS)
  const all: number[] = []
  const feet: number[] = []

  for (let index = 0; index < LANDMARK_COUNT; index++) {
    for (const axis of ['x', 'y'] as const) {
      const series = still.map((f) => f.landmarks[index]![axis])
      const sd = stdDev(series)
      all.push(sd)
      if (footSet.has(index)) feet.push(sd)
    }
  }

  return { overall: meanOf(all), feet: meanOf(feet), frames: still.length }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS. Сообщите фактическое число.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/landmarkScatter.ts src/lib/landmarkScatter.test.ts
git commit -m "Measure MediaPipe's own landmark scatter from a still stretch"
```

---

### Task 4: Композабл детекции позы

**Files:**
- Create: `src/composables/usePoseDetection.ts`

**Interfaces:**
- Consumes: `planCoarsePass`, `planFinePass`, `COARSE_STRIDE` из `../lib/framePlan`; `measureJump` из `../lib/jumpFromCom`; `estimateScatter` из `../lib/landmarkScatter`; `LANDMARK_COUNT`, типы из `../lib/poseTypes`
- Produces: `usePoseDetection(videoRef: Ref<HTMLVideoElement | null>)`, возвращающий `{ status, progress, error, result, scatter, frames, run, cancel }`

Здесь и только здесь живут DOM и WASM. Тестов на этот файл нет — политика проекта покрывает `src/lib/`, а всё содержательное из него уже вынесено в чистые функции. Проверка — ручная, в Task 6.

Четыре решения, которые надо понимать до чтения кода:

**`runningMode: 'IMAGE'`, а не `'VIDEO'`.** В режиме VIDEO детектор работает трекером: берёт область интереса из предыдущего кадра. Это быстрее, но делает результат зависящим от порядка подачи кадров — а мы подаём их двумя проходами, второй из которых идёт назад по времени. Задача PR — убрать разброс, а не завезти новый.

**Время берётся из `mediaTime`.** `requestVideoFrameCallback` сообщает фактическое время предъявления кадра. Это выводит автоопределение FPS из расчёта целиком.

**Ждём и `seeked`, и кадр.** Событие `seeked` означает, что позиция изменилась, но не то, что новый кадр отрисован. Без ожидания `requestVideoFrameCallback` детектор может получить предыдущее изображение.

**Отмена проверяется перед каждым кадром.** Иначе уход с экрана оставляет цикл работать на сотнях кадров.

- [ ] **Step 1: Создать `src/composables/usePoseDetection.ts`**

```ts
import { ref, type Ref } from 'vue'
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { planCoarsePass, planFinePass } from '../lib/framePlan'
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../lib/poseTypes'

export type DetectionStatus = 'idle' | 'loading' | 'scanning' | 'done' | 'error' | 'cancelled'

const ASSETS = `${import.meta.env.BASE_URL}mediapipe`

/** A foot this far above the clip's floor level counts as airborne. */
const COARSE_AIRBORNE_FRACTION = 0.02

/**
 * `fps` is only used to schedule which instants to sample. The measurement
 * itself never sees it: every frame is stamped with the `mediaTime` the
 * browser reports, so a wrong FPS costs a few redundant seeks, not accuracy.
 */
export function usePoseDetection(
  videoRef: Ref<HTMLVideoElement | null>,
  fps: Ref<number>
) {
  const status = ref<DetectionStatus>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)
  const result = ref<{ analysis: JumpAnalysis | null; verdict: Verdict } | null>(null)
  const scatter = ref<LandmarkScatter | null>(null)
  const frames = ref<PoseFrame[]>([])

  let landmarker: PoseLandmarker | null = null
  let abort: AbortController | null = null

  async function loadModel(): Promise<PoseLandmarker> {
    if (landmarker) return landmarker
    const vision = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`)
    const baseOptions = { modelAssetPath: `${ASSETS}/pose_landmarker_lite.task` }
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      })
    } catch {
      // Some browsers and older GPUs reject the WebGL delegate. CPU is slower
      // but always available, and the arithmetic is identical either way.
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      })
    }
    return landmarker
  }

  /**
   * Seeks, waits for the frame to actually be presented, and returns its true
   * presentation time. `seeked` alone only says the position moved — the new
   * picture may not be painted yet, and detecting then reads the old one.
   */
  function seekAndShow(video: HTMLVideoElement, time: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let settled = false
      const onError = () => {
        if (settled) return
        settled = true
        reject(new Error(`seek failed at ${time.toFixed(3)}s`))
      }
      video.addEventListener('error', onError, { once: true })
      video.requestVideoFrameCallback((_now, metadata) => {
        if (settled) return
        settled = true
        video.removeEventListener('error', onError)
        resolve(metadata.mediaTime)
      })
      video.currentTime = time
    })
  }

  function toPoseFrame(time: number, detection: PoseLandmarkerResult): PoseFrame | null {
    const pose = detection.landmarks[0]
    if (!pose || pose.length !== LANDMARK_COUNT) return null
    const landmarks: Landmark[] = pose.map((p) => ({ x: p.x, y: p.y }))
    return { time, landmarks }
  }

  async function scan(
    video: HTMLVideoElement, detector: PoseLandmarker, times: number[],
    signal: AbortSignal, onProgress: (done: number) => void
  ): Promise<PoseFrame[]> {
    const collected: PoseFrame[] = []
    for (let i = 0; i < times.length; i++) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError')
      const mediaTime = await seekAndShow(video, times[i]!)
      const frame = toPoseFrame(mediaTime, detector.detect(video))
      if (frame) collected.push(frame)
      onProgress(i + 1)
    }
    return collected
  }

  /**
   * Which coarse samples had a foot clear of the clip's floor level.
   *
   * A deliberately crude cousin of `findFlightPhase` — it only has to say
   * roughly where to look closer, so it skips the sub-frame work entirely.
   */
  function airborneIndices(coarse: PoseFrame[]): number[] {
    if (coarse.length === 0) return []
    const footY = coarse.map((f) =>
      Math.max(
        f.landmarks[LM.LEFT_HEEL]!.y, f.landmarks[LM.RIGHT_HEEL]!.y,
        f.landmarks[LM.LEFT_FOOT_INDEX]!.y, f.landmarks[LM.RIGHT_FOOT_INDEX]!.y
      )
    )
    const sorted = [...footY].sort((a, b) => a - b)
    const floor = sorted[Math.min(sorted.length - 1, Math.round(0.9 * (sorted.length - 1)))]!
    const noseY = coarse.map((f) => f.landmarks[LM.NOSE]!.y)
    const stature = Math.max(...footY.map((y, i) => y - noseY[i]!))
    const threshold = COARSE_AIRBORNE_FRACTION * stature
    const indices: number[] = []
    for (let i = 0; i < footY.length; i++) {
      if (floor - footY[i]! > threshold) indices.push(i)
    }
    return indices
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

  async function run(): Promise<void> {
    const video = videoRef.value
    if (!video || !(video.duration > 0)) {
      error.value = 'Видео не готово'
      status.value = 'error'
      return
    }
    if (!('requestVideoFrameCallback' in video)) {
      error.value = 'Браузер не поддерживает покадровое чтение видео'
      status.value = 'error'
      return
    }

    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal

    error.value = null
    result.value = null
    scatter.value = null
    frames.value = []
    progress.value = 0
    status.value = 'loading'

    const wasPaused = video.paused
    const originalTime = video.currentTime

    try {
      const detector = await loadModel()
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError')

      video.pause()
      status.value = 'scanning'

      const rate = fps.value > 0 ? fps.value : 60
      const coarseTimes = planCoarsePass(video.duration, rate)
      const coarse = await scan(video, detector, coarseTimes, signal, (done) => {
        progress.value = (done / coarseTimes.length) * 0.5
      })

      const fineTimes = planFinePass(coarseTimes, airborneIndices(coarse), video.duration, rate)
      const fine = fineTimes.length === 0
        ? []
        : await scan(video, detector, fineTimes, signal, (done) => {
            progress.value = 0.5 + (done / fineTimes.length) * 0.5
          })

      const all = dedupeByTime([...coarse, ...fine].sort((a, b) => a.time - b.time))
      frames.value = all
      scatter.value = estimateScatter(all)
      result.value = measureJump(all, { width: video.videoWidth, height: video.videoHeight })
      progress.value = 1
      status.value = 'done'
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        status.value = 'cancelled'
      } else {
        error.value = caught instanceof Error ? caught.message : String(caught)
        status.value = 'error'
      }
    } finally {
      video.currentTime = originalTime
      if (!wasPaused) void video.play()
    }
  }

  function cancel(): void {
    abort?.abort()
  }

  return { status, progress, error, result, scatter, frames, run, cancel }
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок. Если TypeScript не знает про `requestVideoFrameCallback`, добавьте `"dom.iterable"` — но сначала проверьте: в актуальных `lib.dom.d.ts` он есть, и обходной путь может не понадобиться.

- [ ] **Step 3: Убедиться, что тесты не сломались**

Run: `npm test`
Expected: PASS, число из Task 3 без изменений.

- [ ] **Step 4: Коммит**

```bash
git add src/composables/usePoseDetection.ts
git commit -m "Add pose detection: model lifecycle and the two-pass frame walk"
```

---

### Task 5: Кнопка и текстовая сводка

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `usePoseDetection` из Task 4
- Produces: ничего (последняя задача, дающая код)

Интерфейс здесь намеренно черновой. Задача — не сделать красиво, а дать способ запустить пайплайн на своём видео и увидеть все числа, включая измеренную σ. Оформление, скелет и маркеры — PR-C2.

- [ ] **Step 1: Подключить композабл**

В `<script setup>` в `src/App.vue`, после существующих импортов композаблов, добавить:

```ts
import { usePoseDetection } from './composables/usePoseDetection'
```

и рядом с остальными вызовами композаблов:

```ts
const pose = usePoseDetection(videoRef, fps)
```

`fps` — уже существующий в `App.vue` реф, который наполняет `useFpsDetection`. Он нужен только для расписания опроса: каждый кадр всё равно помечается временем из `mediaTime`, поэтому неверно определённый FPS стоит нескольких лишних перемоток, а не точности.

- [ ] **Step 2: Добавить блок в боковую панель**

В `src/App.vue`, внутри `<div v-if="isVideoLoaded" class="shrink-0 md:w-72 flex flex-col gap-3">`, сразу после `<MarkerControls ... />`, вставить:

```html
<div class="rounded-xl border border-surface-lighter bg-surface-light p-3 text-xs">
  <button
    v-if="pose.status.value !== 'scanning' && pose.status.value !== 'loading'"
    class="w-full min-h-11 rounded-lg bg-brand text-sm font-medium text-white
           hover:brightness-110 transition"
    @click="pose.run()"
  >
    Найти прыжок автоматически
  </button>

  <div v-else class="space-y-2">
    <p class="text-slate-400">
      {{ pose.status.value === 'loading' ? 'Загружаем модель (~8 МБ)…' : 'Разбираем кадры…' }}
    </p>
    <div class="h-1.5 rounded-full bg-surface-lighter overflow-hidden">
      <div class="h-full bg-brand transition-all"
           :style="{ width: (pose.progress.value * 100).toFixed(0) + '%' }" />
    </div>
    <button class="w-full min-h-11 rounded-lg border border-surface-lighter text-slate-400"
            @click="pose.cancel()">
      Отмена
    </button>
  </div>

  <p v-if="pose.error.value" class="mt-2 text-rose-400">{{ pose.error.value }}</p>
  <p v-if="pose.status.value === 'cancelled'" class="mt-2 text-slate-500">Отменено</p>

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
      <p>flight-time {{ pose.result.value.analysis.flightTimeHeightCm.toFixed(1) }} см</p>
      <p>R² {{ pose.result.value.analysis.rSquared.toFixed(4) }}</p>
      <p>рост {{ pose.result.value.analysis.statureM.toFixed(2) }} м</p>
      <p>масштаб {{ pose.result.value.analysis.scalePxPerM.toFixed(1) }} px/м</p>
      <p>кадров в полёте {{ pose.result.value.analysis.flightFrames }}</p>
      <p>±{{ pose.result.value.analysis.errorCm.toFixed(2) }} см (только фит)</p>
    </template>
    <p v-if="pose.scatter.value" class="text-amber-300">
      σ ландмарок {{ pose.scatter.value.overall.toFixed(4) }},
      стопы {{ pose.scatter.value.feet.toFixed(4) }}
    </p>
    <p class="text-slate-500">кадров разобрано {{ pose.frames.value.length }}</p>
  </div>
</div>
```

- [ ] **Step 3: Собрать**

Run: `npm run build`
Expected: сборка проходит без ошибок.

- [ ] **Step 4: Убедиться, что тесты не сломались**

Run: `npm test`
Expected: PASS, число без изменений.

- [ ] **Step 5: Коммит**

```bash
git add src/App.vue
git commit -m "Add a rough probe UI for automatic jump detection"
```

---

### Task 6: Проверка на реальном видео и ответы на открытые вопросы

**Files:** ничего не меняется — это измерение.

**Interfaces:**
- Consumes: всё выше
- Produces: числа, записанные в отчёт

Ради этой задачи PR-C1 и отделён от оформления. Три вопроса, оставшихся из PR-B, упираются в одно неизмеренное число.

- [ ] **Step 1: Запустить приложение**

Run: `npm run dev -- --host`

Открыть, загрузить реальное видео прыжка, нажать «Найти прыжок автоматически».

- [ ] **Step 2: Записать по каждому клипу**

Прогоните не менее трёх разных клипов, желательно с разной частотой кадров, и для каждого запишите: измеренную высоту и вердикт, `flight-time` для сравнения, R², рост, масштаб, число кадров в полёте, `errorCm`, **σ ландмарок общую и по стопам**, число разобранных кадров и время работы на глаз.

- [ ] **Step 3: Ответить на три вопроса PR-B**

1. **Настоящая σ.** Сравните измеренную σ по стопам с 0.005, против которой калибровались пороги. Если она заметно меньше — обещание «±1 см при шуме» может оказаться выполнимым, и порог 3.5 см в `acceptance.test.ts` стоит пересмотреть. Если больше — наоборот.
2. **Переклассификация границы.** В PR-B измерено, что при σ = 0.004 простой код брифа точнее, чем механизм `extendBoundary`. Скажите, по какую сторону от этой границы оказалась реальность.
3. **Провал при 240 fps.** Если попался клип на 240 fps, проверьте, воспроизводится ли отклонение около −2 см, которое видно на синтетике.

- [ ] **Step 4: Проверить деградацию**

Убедитесь, что приложение ведёт себя разумно: отмена посреди прохода останавливает работу и возвращает видео на исходную позицию; повторный запуск работает; клип без прыжка даёт `unusable` с причиной `no-flight`, а не ошибку.

- [ ] **Step 5: Записать отчёт**

Создать `docs/2026-07-28-pr-c1-field-measurements.md` с таблицей по клипам, измеренной σ и ответами на три вопроса. Это входной документ для PR-C2 и для пересмотра порогов.

- [ ] **Step 6: Коммит**

```bash
git add docs/2026-07-28-pr-c1-field-measurements.md
git commit -m "Record field measurements from real clips"
```

---

## Определение готовности

- `npm run fetch:mediapipe` идемпотентен, `public/mediapipe/` не попадает в git
- `npm test` проходит; новых падений нет
- `npm run build` чист
- На реальном видео кнопка выдаёт высоту и вердикт
- Измерена настоящая σ ландмарок, и три вопроса из PR-B закрыты числами
- `src/lib/**` по-прежнему без Vue, DOM и недетерминированности
- Ядро PR-B не тронуто
