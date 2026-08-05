# Прыжки с разгона — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Находить отрыв и приземление прыжка, когда дистанция человека до камеры меняется в течение клипа (разгон к кольцу), не ломая ничего из того, что уже работает для стационарного прыжка.

**Architecture:** Пол и рост, от которых зависит поиск фазы полёта, пробуются сначала **глобально** (сегодняшний способ, без изменений) и только если это уже привело к отказу (`no-flight` или посадка, упирающаяся в конец клипа) — пересчитываются **скользящим** окном по времени. Скользящий путь никогда не запускается, если глобальный уже нашёл рабочий прыжок — поэтому он физически не может сломать ничего, что проходит сегодня.

**Tech Stack:** TypeScript, Vitest, чистые функции в `src/lib`.

**Спека:** `docs/2026-08-04-running-approach-jump-design.md`.

## Global Constraints

- TypeScript strict. Включены `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` — никаких `enum` (только `as const` или union), никаких неиспользуемых импортов.
- `@vue/tsconfig` включает `noUncheckedIndexedAccess` (`arr[i]` типизирован как `T | undefined`, `!` обязателен там, где индекс доказанно в границах) и `verbatimModuleSyntax` (смешанные импорты значений и типов — инлайновый `type`).
- `src/lib/**` не импортирует Vue, не трогает DOM, не вызывает `Math.random()`/`Date.now()`.
- Ось `y` растёт вниз.
- В сообщениях коммитов **не добавлять** `Co-Authored-By`. Не запускать `git push`.
- Базовая линия тестов на старте — **165**. Каждая задача сообщает фактическое число.
- `src/composables/**` тестами не покрывается (политика проекта) — проверка там только ручная.

---

## Важное архитектурное решение, найденное при чтении кода

Первая версия этого плана предполагала: скользящее окно включается, как только клип достаточно длинный. Чтение существующих тестов (`flightPhase.test.ts`, `acceptance.test.ts`) вскрыло, почему это опасно — в проекте уже есть тесты на **искусственно растянутый в 8 раз** замедленный прыжок (`timeScale: 8`), где сам полёт длится больше 5 секунд. Скользящее окно шириной 4 с там оказалось бы **уже самого полёта** — и считало бы «пол» по данным из самого полёта, а не по стоянию. Это не гипотетический риск: прослеживание вручную показало, что окно, посчитанное по всему такому клипу, дало бы медиану прямо внутри полёта.

Поэтому решение другое: **глобальный проход выполняется всегда первым, без изменений.** Скользящий — только если глобальный уже не смог найти рабочий прыжок (`no-flight`, либо кандидат, чья посадка утыкается в конец доступных данных). На всех уже проходящих сегодня тестах (включая растянутые в 8 раз замедленные) глобальный проход по-прежнему находит прыжок сам — значит, скользящий код для них **вообще не выполняется**, и сломать их не может. Скользящий путь трогает только то, что раньше давало отказ, — то есть по построению может только чинить, не портить.

---

## Файлы

| Файл | Что меняется |
|---|---|
| `src/lib/stats.ts` — изменить | `rollingMedian`/`rollingPercentile` — скользящие статистики по временному окну |
| `src/lib/stats.test.ts` — создать | Тесты к ним (у `percentile` своего тестового файла нет — этот файл заводится с нуля) |
| `src/lib/comTrack.ts` — изменить | `ComTrack` отдаёт `spans: number[]` (в порядке кадров, не отсортированный); `NOSE_HEIGHT_FRACTION`/`STANDING_PERCENTILE` экспортируются |
| `src/lib/comTrack.test.ts` — изменить | Тест на то, что `spans` идёт в порядке кадров |
| `src/lib/flightPhase.ts` — изменить | Глобальный проход как сегодня; скользящий — только как фолбэк на отказ. `FlightPhase` получает `staturePxAtJump` |
| `src/lib/flightPhase.test.ts` — изменить | `track()`-хелпер получает `spans`; новые тесты на скользящий фолбэк |
| `src/lib/jumpFromCom.ts` — изменить | Проверка правдоподобности роста читает `phase.staturePxAtJump` вместо `track.staturePx` |
| `src/composables/usePoseDetection.ts` — изменить | `airborneIndices()` — тот же приём: глобально, потом скользящий фолбэк |
| `src/lib/testing/syntheticJumper.ts` — изменить | Новая опция `approachScaleRatio` — дрейф масштаба до отрыва |
| `src/lib/testing/syntheticJumper.test.ts` — изменить | Тесты на новую опцию |
| `src/lib/acceptance.test.ts` — изменить | Новый сквозной тест: пайплайн не ломается на дрейфующем клипе |
| `src/lib/testing/realClipFixture.ts` — создать | Реальные координаты (не видео) из клипа, присланного для отладки — постоянная регрессия |
| `src/lib/realClipFixture.test.ts` — создать | `measureJump` на этих данных больше не даёт `landing-past-end` |

---

### Task 1: Скользящие статистики

**Files:**
- Modify: `src/lib/stats.ts`
- Create: `src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `percentile` (уже существует в этом же файле)
- Produces: `rollingPercentile(times: number[], values: number[], windowSeconds: number, minPoints: number, p: number): (number | null)[]`, `rollingMedian(times: number[], values: number[], windowSeconds: number, minPoints: number): (number | null)[]`

Окно задаётся в секундах, а не в числе кадров — двухпроходный обход кадров в продакшене сэмплирует клип неравномерно (грубый проход — каждый 6-й кадр по всему клипу, плотный — покадрово только вокруг найденного окна интереса), и окно, заданное числом кадров, означало бы разную длительность в секундах в зависимости от того, где на клипе оно считается.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rollingMedian, rollingPercentile } from './stats'

describe('rollingMedian', () => {
  it('returns the median of values within the window around each point', () => {
    const times = [0, 1, 2, 3, 4]
    const values = [10, 10, 10, 10, 10]
    expect(rollingMedian(times, values, 2, 1)).toEqual([10, 10, 10, 10, 10])
  })

  it('is robust to a short excursion smaller than half the window', () => {
    const times = [0, 1, 2, 3, 4, 5, 6]
    const values = [100, 100, 100, 40, 100, 100, 100]
    // Every index's window (+/-3s) reaches all 7 points; 6 of 7 are 100, so
    // the median stays 100 everywhere, including at the excursion itself.
    const result = rollingMedian(times, values, 6, 1)
    expect(result.every((v) => v === 100)).toBe(true)
  })

  it('tracks a slow drift instead of blending the whole range into one number', () => {
    const times = Array.from({ length: 21 }, (_, i) => i) // 0..20 seconds
    const values = times.map((t) => 100 - (t / 20) * 50) // 100 -> 50, linear
    const result = rollingMedian(times, values, 2, 1) // 2s window
    // Near t=0 the window only sees values close to 100; near t=20, close to
    // 50. A single global median (75) would be wrong at both ends.
    expect(result[0]!).toBeGreaterThan(95)
    expect(result[20]!).toBeLessThan(55)
  })

  it('returns null where fewer than minPoints fall in the window', () => {
    const times = [0, 10, 20] // far apart -- no window overlap
    const values = [1, 2, 3]
    expect(rollingMedian(times, values, 2, 2)).toEqual([null, null, null])
  })

  it('uses points from both before and after each index, not causal-only', () => {
    const times = [0, 1, 2]
    const values = [10, 20, 30]
    // Window +/-2s reaches all three points from any index. A causal-only
    // (backward-looking) window at index 0 would see just [10] and report
    // 10; this reaches forward too, seeing all of [10, 20, 30] (median 20).
    const result = rollingMedian(times, values, 4, 1)
    expect(result[0]).toBe(20)
  })

  it('handles uneven spacing -- dense clusters do not see each other', () => {
    const times = [0, 0.1, 0.2, 5, 5.1, 5.2]
    const values = [1, 2, 3, 100, 101, 102]
    const result = rollingMedian(times, values, 1, 1)
    expect(result[0]).toBeLessThan(10)
    expect(result[3]).toBeGreaterThan(90)
  })
})

describe('rollingPercentile', () => {
  it('matches rollingMedian at p=0.5', () => {
    const times = [0, 1, 2, 3, 4]
    const values = [5, 3, 8, 1, 9]
    expect(rollingPercentile(times, values, 10, 1, 0.5)).toEqual(rollingMedian(times, values, 10, 1))
  })

  it('picks a value near the top of the window at a high percentile', () => {
    const times = [0, 1, 2, 3, 4]
    const values = [1, 2, 3, 4, 100]
    // Window (+/-5s) covers all 5 points from index 0. Sorted: [1,2,3,4,100],
    // n=5, p=0.9 -> index round(0.9*4)=4 -> 100.
    expect(rollingPercentile(times, values, 10, 1, 0.9)[0]).toBe(100)
  })

  it('returns null where fewer than minPoints fall in the window', () => {
    const times = [0, 10]
    const values = [1, 2]
    expect(rollingPercentile(times, values, 1, 2, 0.9)).toEqual([null, null])
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: FAIL — `rollingMedian`/`rollingPercentile` не существуют.

- [ ] **Step 3: Дописать `src/lib/stats.ts`**

Не менять существующий `percentile`. Добавить в конец файла:

```ts
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
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Полный прогон и коммит**

Run: `npm test`
Expected: PASS. Сообщите фактическое число — база 165, здесь должно стать 176.

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "Add rolling median/percentile over a time window"
```

---

### Task 2: `comTrack.ts` отдаёт `spans` и экспортирует константы

**Files:**
- Modify: `src/lib/comTrack.ts`
- Modify: `src/lib/comTrack.test.ts`

**Interfaces:**
- Consumes: ничего нового
- Produces: `ComTrack.spans: number[]` (в порядке кадров), `export const NOSE_HEIGHT_FRACTION`, `export const STANDING_PERCENTILE`

`spans` уже считается внутри `buildComTrack` сегодня — просто сортируется на месте и выбрасывается после свёртки в один `staturePx`. Единственная тонкость: сортировка должна перестать быть in-place, иначе `spans`, отданный наружу, потеряет соответствие индексам `times`/`footY` — `flightPhase.ts` в Task 3 полагается на то, что `spans[i]` относится к тому же кадру, что `times[i]`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/lib/comTrack.test.ts` (после существующего теста про `footY` как медиану):

```ts
  it('returns spans in frame order (not sorted), so they pair up with times', () => {
    const track = buildComTrack([
      frame(0, { [LM.NOSE]: { x: 0.5, y: 0.1 } }), // nose far above the foot -> large span
      frame(1 / 60, { [LM.NOSE]: { x: 0.5, y: 0.4 } }), // nose closer to the foot -> smaller span
    ], VIDEO)
    // Sorted ascending, frame 1's (smaller) span would come first. It
    // doesn't -- spans stays in frame order, matching times/footY.
    expect(track.spans[0]!).toBeGreaterThan(track.spans[1]!)
  })
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/comTrack.test.ts`
Expected: FAIL — `track.spans` не существует (TypeScript-ошибка или `undefined`).

- [ ] **Step 3: Изменить `src/lib/comTrack.ts`**

Найти:

```ts
export interface ComTrack {
  /**
   * Frame presentation times, seconds. Always the same length as `comY` and
   * `footY` — buildComTrack pushes to all three in lockstep, one malformed
   * frame at a time (see buildComTrack), skipping a frame from all three
   * arrays at once rather than leaving them to drift out of correspondence.
   * Callers outside this file that build a ComTrack by hand (tests do) must
   * preserve that invariant themselves; findFlightPhase checks it rather
   * than assuming it, since it is exported and this is not encoded in the
   * type.
   */
  times: number[]
  /** Body centre of mass, vertical pixels, y down. */
  comY: number[]
  /**
   * Vertical position of the foot, in pixels, y down: the median of both
   * ankles, heels and toes (see computeFootY). Not the lowest of the six —
   * that is the point of using a median instead of a maximum. Measured
   * (synthetic landmark noise, Monte Carlo–confirmed independently of the
   * generator): the median sits systematically about 1.6-1.7 standard
   * deviations above the lowest of the six, at both sigma 0.005 and 0.01 —
   * larger than a plain 4-sample order-statistic gap (~1.03 sigma) because
   * the two ankles occasionally rank into the comparison too. That gap is
   * the resistance to a single-landmark spike this statistic exists for,
   * not a bug to close.
   */
  footY: number[]
  /** Standing height in pixels, used to normalize thresholds by the person. */
  staturePx: number
}

/** Where the nose sits as a fraction of stature. Approximate on purpose. */
const NOSE_HEIGHT_FRACTION = 0.9

/**
 * Which percentile of (foot - nose) counts as "standing upright". The person
 * is tallest fully extended; a plain maximum would latch onto a noise spike.
 */
const STANDING_PERCENTILE = 0.9
```

Заменить на (добавлено поле `spans`, две константы получили `export`):

```ts
export interface ComTrack {
  /**
   * Frame presentation times, seconds. Always the same length as `comY` and
   * `footY` — buildComTrack pushes to all three in lockstep, one malformed
   * frame at a time (see buildComTrack), skipping a frame from all three
   * arrays at once rather than leaving them to drift out of correspondence.
   * Callers outside this file that build a ComTrack by hand (tests do) must
   * preserve that invariant themselves; findFlightPhase checks it rather
   * than assuming it, since it is exported and this is not encoded in the
   * type.
   */
  times: number[]
  /** Body centre of mass, vertical pixels, y down. */
  comY: number[]
  /**
   * Vertical position of the foot, in pixels, y down: the median of both
   * ankles, heels and toes (see computeFootY). Not the lowest of the six —
   * that is the point of using a median instead of a maximum. Measured
   * (synthetic landmark noise, Monte Carlo–confirmed independently of the
   * generator): the median sits systematically about 1.6-1.7 standard
   * deviations above the lowest of the six, at both sigma 0.005 and 0.01 —
   * larger than a plain 4-sample order-statistic gap (~1.03 sigma) because
   * the two ankles occasionally rank into the comparison too. That gap is
   * the resistance to a single-landmark spike this statistic exists for,
   * not a bug to close.
   */
  footY: number[]
  /** Standing height in pixels, used to normalize thresholds by the person. */
  staturePx: number
  /**
   * Nose-to-foot pixel span, one entry per frame, in the same order as
   * `times`/`footY`/`comY` — NOT sorted, unlike the array `staturePx` is
   * distilled from. flightPhase.ts's rolling stature estimate needs each
   * span paired with the instant it was measured at; `staturePx` alone
   * collapses that correspondence into a single number for the whole clip.
   */
  spans: number[]
}

/** Where the nose sits as a fraction of stature. Approximate on purpose. */
export const NOSE_HEIGHT_FRACTION = 0.9

/**
 * Which percentile of (foot - nose) counts as "standing upright". The person
 * is tallest fully extended; a plain maximum would latch onto a noise spike.
 */
export const STANDING_PERCENTILE = 0.9
```

Найти:

```ts
  spans.sort((a, b) => a - b)
  // spans.length, not frames.length: a clip full of malformed (skipped)
  // frames must fall back to 0 just as an empty clip does, and percentile's
  // own empty-array guard already returns 0 — this condition just makes
  // that intent explicit for a reader, rather than relying on frames.length
  // happening to be 0 too (true before landmark-length skipping existed,
  // not necessarily true now that frames.length and spans.length can differ).
  const staturePx = spans.length === 0
    ? 0
    : percentile(spans, STANDING_PERCENTILE) / NOSE_HEIGHT_FRACTION

  return { times, comY, footY, staturePx }
}
```

Заменить на (сортируется копия, не сам `spans` — иначе поле, отданное наружу, потеряет порядок кадров):

```ts
  // Distilled from a SORTED COPY. `spans` itself stays in frame order — it
  // is returned as part of ComTrack, and flightPhase.ts's rolling stature
  // needs each span paired with the time it was measured at.
  const sortedSpans = [...spans].sort((a, b) => a - b)
  const staturePx = sortedSpans.length === 0
    ? 0
    : percentile(sortedSpans, STANDING_PERCENTILE) / NOSE_HEIGHT_FRACTION

  return { times, comY, footY, staturePx, spans }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/comTrack.test.ts`
Expected: PASS.

- [ ] **Step 5: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок. Если есть ошибка про недостающее поле `spans` в другом файле (например, в `flightPhase.test.ts`'s `track()`-хелпере) — это ожидаемо, чинится в Task 3.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/comTrack.ts src/lib/comTrack.test.ts
git commit -m "Expose per-frame spans from buildComTrack, export the stature constants"
```

---

### Task 3: Скользящий фолбэк в `flightPhase.ts`

**Files:**
- Modify: `src/lib/flightPhase.ts`
- Modify: `src/lib/flightPhase.test.ts`

**Interfaces:**
- Consumes: `rollingMedian`, `rollingPercentile` из `./stats`; `NOSE_HEIGHT_FRACTION`, `STANDING_PERCENTILE`, `spans` (поле `ComTrack`) из `./comTrack`
- Produces: `FlightPhase.staturePxAtJump: number`; `export const ROLLING_WINDOW_SECONDS`, `export const MIN_ROLLING_POINTS` (нужны Task 5)

**Принцип, см. раздел «Важное архитектурное решение» выше: глобальный проход выполняется всегда, скользящий — только если глобальный не смог найти прыжок, чья посадка укладывается в границы клипа.**

- [ ] **Step 1: Написать падающие тесты**

Добавить в `src/lib/flightPhase.test.ts`. Сначала расширить импорты — заменить:

```ts
import { findFlightPhase } from './flightPhase'
```

на:

```ts
import { findFlightPhase, ROLLING_WINDOW_SECONDS } from './flightPhase'
```

(`ROLLING_WINDOW_SECONDS` используется ниже, чтобы тест сам подстраивался под ширину окна, а не дублировал число.)

Заменить хелпер `track()`:

```ts
function track(footY: number[], fps = 60): ComTrack {
  return {
    times: footY.map((_, i) => i / fps),
    comY: footY.map(() => 0),
    footY,
    staturePx: 500,
  }
}
```

на:

```ts
function track(footY: number[], fps = 60): ComTrack {
  return {
    times: footY.map((_, i) => i / fps),
    comY: footY.map(() => 0),
    footY,
    staturePx: 500,
    // A constant 450 makes percentile(spans, 0.9) / 0.9 work out to exactly
    // 500 -- the same staturePx these tests already hard-code -- so every
    // existing assertion keeps its original meaning unchanged.
    spans: footY.map(() => 450),
  }
}
```

Затем дописать в конец файла, перед закрывающей скобкой `describe('findFlightPhase', ...)` — то есть добавить это как ОТДЕЛЬНЫЙ `describe`-блок ПОСЛЕ него, на том же уровне вложенности:

```ts
describe('findFlightPhase — rolling fallback when the athlete drifts from the camera', () => {
  const FPS = 30

  /**
   * A clip where the athlete moves steadily away from the camera (footY and
   * the nose-to-foot span both shrink) for 6s, then does a short, real jump
   * at the new distance, then lands and stays there -- footY never returns
   * to the original level. Against a single whole-clip floor (dominated by
   * the brief initial stretch near the camera), this whole drifting stretch
   * reads as one continuous "airborne" run that never comes back down
   * before the clip ends -- exactly what happened on the real clip that
   * motivated this fallback (see the running-approach-jump design doc).
   */
  function driftingClip(): ComTrack {
    const times: number[] = []
    const footY: number[] = []
    const spans: number[] = []
    const push = (t: number, foot: number, span: number) => {
      times.push(t)
      footY.push(foot)
      spans.push(span)
    }

    // 1s standing near the camera.
    for (let i = 0; i < FPS * 1; i++) push(i / FPS, 900, 800)

    // Drifting away, for comfortably longer than ROLLING_WINDOW_SECONDS --
    // wide enough that the window actually rolls across real variation
    // instead of seeing the whole drift as one span.
    const driftSeconds = ROLLING_WINDOW_SECONDS * 1.5
    const driftFrames = Math.round(FPS * driftSeconds)
    for (let i = 0; i < driftFrames; i++) {
      const t = FPS * 1 + i
      const progress = i / driftFrames
      push(t / FPS, 900 - progress * 500, 800 - progress * 450) // 900->400, 800->350
    }

    // A short, real jump at the new (arrived) distance.
    const jumpStartFrame = FPS * 1 + driftFrames
    for (let i = 0; i < Math.round(FPS * 0.3); i++) {
      push((jumpStartFrame + i) / FPS, 280, 350)
    }

    // Standing at the new distance -- never recovers the original footY.
    const afterFrame = jumpStartFrame + Math.round(FPS * 0.3)
    for (let i = 0; i < FPS * 2; i++) push((afterFrame + i) / FPS, 400, 350)

    return { times, comY: footY.map(() => 0), footY, staturePx: 800 / 0.9, spans }
  }

  it('recovers a short flight instead of landing-past-end', () => {
    const outcome = findFlightPhase(driftingClip())
    expect(outcome.kind === 'found' || outcome.kind === 'too-long').toBe(true)
  })

  it('places takeoff near the real jump, not wherever the drift itself started or ended', () => {
    const outcome = findFlightPhase(driftingClip())
    if (outcome.kind !== 'found' && outcome.kind !== 'too-long') {
      throw new Error(`expected a resolved phase, got '${outcome.kind}'`)
    }
    const jumpStartS = 1 + ROLLING_WINDOW_SECONDS * 1.5
    expect(outcome.phase.takeoffTime).toBeGreaterThan(jumpStartS - 0.5)
    expect(outcome.phase.takeoffTime).toBeLessThan(jumpStartS + 0.5)
  })

  it('reads the stature at the jump, not the near-camera stretch at the start', () => {
    const outcome = findFlightPhase(driftingClip())
    if (outcome.kind !== 'found' && outcome.kind !== 'too-long') {
      throw new Error(`expected a resolved phase, got '${outcome.kind}'`)
    }
    // The near-camera stature (800/0.9 ~= 889px) is what the OLD whole-clip
    // staturePx reports. The stature at the jump, where the athlete is
    // smaller in frame, must be noticeably less than that.
    expect(outcome.phase.staturePxAtJump).toBeLessThan(700)
  })

  it('does not engage the rolling fallback on an ordinary, non-drifting jump', () => {
    // Same shape as this file's existing "finds the boundaries" fixture --
    // pins that the fallback path is inert when the global pass already
    // succeeds, by checking the answer is unchanged from before this task.
    const outcome = findFlightPhase(track([100, 100, 80, 60, 80, 100, 100]))
    if (outcome.kind !== 'found') throw new Error(`expected 'found', got '${outcome.kind}'`)
    expect(outcome.phase.takeoffFrame).toBe(2)
    expect(outcome.phase.landingFrame).toBe(5)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/flightPhase.test.ts`
Expected: FAIL — `ROLLING_WINDOW_SECONDS` не экспортируется из `flightPhase.ts`; после её временного добавления как `export const ROLLING_WINDOW_SECONDS = 4` (без остальной логики) новые тесты на дрейф должны падать по существу (`outcome.kind` будет `'landing-past-end'`, не `'found'`/`'too-long'`), а тест «does not engage... on an ordinary jump» должен уже проходить (это регрессионный контроль, не новая логика).

- [ ] **Step 3: Изменить `src/lib/flightPhase.ts`**

Заменить блок импортов:

```ts
import { percentile } from './stats'
import { fitParabola } from './parabolaFit'
import type { ComTrack } from './comTrack'
```

на:

```ts
import { percentile, rollingMedian, rollingPercentile } from './stats'
import { fitParabola } from './parabolaFit'
import { NOSE_HEIGHT_FRACTION, STANDING_PERCENTILE, type ComTrack } from './comTrack'
```

Добавить в `FlightPhase`, после `landingTime: number`:

```ts
  /**
   * The stature (pixels) this jump was actually measured against — read
   * from a rolling window near the takeoff instant, not distilled from the
   * whole clip. jumpFromCom.ts's plausibility check reads this instead of
   * ComTrack's own `staturePx`, so a clip where the athlete's distance to
   * the camera changed elsewhere (a running approach, most often) is not
   * checked against a reference height measured somewhere else entirely.
   */
  staturePxAtJump: number
```

Добавить после `const AIRBORNE_THRESHOLD_FRACTION = 0.02` (перед `MAX_FLIGHT_SECONDS`):

```ts
/**
 * Width of the rolling window used to recover a candidate airborne run when
 * the whole-clip floor/stature already failed to find one — see
 * findFlightPhase's global-then-rolling structure below, and the
 * running-approach-jump design doc.
 *
 * Two requirements pull in opposite directions. The window must be wider
 * than the longest plausible jump (MAX_FLIGHT_SECONDS, 1.5s) with real
 * margin, or the jump itself drags the median along with it — at 2s a 1.5s
 * jump is 75% of the window, nowhere near safe. It must also be narrower
 * than how fast a real approach changes depth, or the drift smears across
 * the window and stops looking different from standing still.
 *
 * 4s gives a 1.5s jump 37.5% of the window (comfortable margin under the 50%
 * a median needs to stay anchored to the standing majority) while staying
 * under half the ~1.5-2s approach measured on the real clip that motivated
 * this. Starting point, not a measured optimum — tighten it the same way
 * EDGE_FIT_FRAMES below was tightened, once a broader set of real clips
 * exists to sweep against.
 *
 * This is never applied to a clip the global pass already resolved — see
 * findFlightPhase — which is what keeps an artificially slow-motion-stretched
 * flight (this file's own MAX_FLIGHT_SECONDS tests exercise one at 8x real
 * time, several seconds long) from ever reaching this window at all: that
 * scenario already succeeds via the unchanged global path today.
 */
export const ROLLING_WINDOW_SECONDS = 4

/**
 * Below this many samples in the rolling window, treat that index as if the
 * window were empty (fall back to the whole-clip value). Mirrors
 * MIN_FLOOR_WINDOW_FRAMES's reasoning below, applied to a window defined in
 * time rather than a fixed slice of the array — matters most on the sparse,
 * coarse-only stretches usePoseDetection.ts's two-pass frame walk produces.
 */
export const MIN_ROLLING_POINTS = 5
```

Добавить новую функцию `longestRun` перед `findFlightPhase` (после `localFloor`, перед `export function findFlightPhase`):

```ts
/**
 * The longest contiguous run of indices (0..length-1) where `isAirborne(i)`
 * holds, or null if none exists. Shared by the global and rolling candidate
 * searches in findFlightPhase below — they differ only in what "airborne"
 * means at each index, never in how the best run is picked.
 */
function longestRun(
  length: number, isAirborne: (i: number) => boolean
): { start: number; length: number } | null {
  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let i = 0; i <= length; i++) {
    const airborne = i < length && isAirborne(i)
    if (airborne && start === -1) start = i
    if (!airborne && start !== -1) {
      if (i - start > bestLength) {
        bestLength = i - start
        bestStart = start
      }
      start = -1
    }
  }
  return bestStart === -1 ? null : { start: bestStart, length: bestLength }
}
```

Заменить весь `export function findFlightPhase(track: ComTrack): FlightPhaseOutcome { ... }` целиком на:

```ts
export function findFlightPhase(track: ComTrack): FlightPhaseOutcome {
  const { times, footY, staturePx, spans } = track
  // times.length !== footY.length should never happen — buildComTrack pushes
  // to both arrays together, one frame at a time — but this function is
  // exported and ComTrack does not encode the invariant in its type, so a
  // hand-built track (tests do this) that breaks it is treated as having no
  // usable data rather than indexing past the shorter array below.
  if (footY.length === 0 || footY.length !== times.length || staturePx <= 0) {
    return { kind: 'no-flight' }
  }

  const floorY = percentile([...footY].sort((a, b) => a - b), FLOOR_PERCENTILE)
  const threshold = AIRBORNE_THRESHOLD_FRACTION * staturePx

  const globalRun = longestRun(footY.length, (i) => floorY - footY[i]! > threshold)

  // The rolling pass exists for exactly one situation: the athlete's
  // distance to the camera changed during the clip, so the single
  // whole-clip floor/stature above no longer describes "standing" anywhere
  // but where it was measured — the clip past that point can read as one
  // continuous "airborne" run relative to it (see the running-approach-jump
  // design doc). It is tried only as a fallback, and only when the global
  // pass already failed outright: no candidate at all, or a candidate whose
  // landing runs off the end of the clip. Never when the global pass
  // already found and fully resolved a run — an artificially
  // slow-motion-stretched flight (this file's own MAX_FLIGHT_SECONDS tests
  // exercise one at 8x real time) is exactly the shape a duration-based gate
  // would also try to roll-detrend, and rolling handles that badly: the
  // window ends up narrower than the artificial flight itself, so it would
  // read the flight's own moving foot as "the floor". Gating on the global
  // pass's own outcome instead means that scenario is never touched — it
  // already succeeds today, via the unchanged path above, and stays on it.
  let staturePxAtJump = staturePx
  let bestRun = globalRun
  if (!globalRun || globalRun.start + globalRun.length >= times.length) {
    const rollingFloorY = rollingMedian(times, footY, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS)
    const rollingStaturePx = rollingPercentile(
      times, spans, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, STANDING_PERCENTILE
    ).map((span) => (span === null ? null : span / NOSE_HEIGHT_FRACTION))

    const rollingRun = longestRun(footY.length, (i) => {
      const localFloorY = rollingFloorY[i] ?? floorY
      const localStaturePx = rollingStaturePx[i] ?? staturePx
      return localFloorY - footY[i]! > AIRBORNE_THRESHOLD_FRACTION * localStaturePx
    })

    if (rollingRun && (!globalRun || rollingRun.start + rollingRun.length < times.length)) {
      bestRun = rollingRun
      staturePxAtJump = rollingStaturePx[rollingRun.start] ?? staturePx
    }
  }

  if (!bestRun) return { kind: 'no-flight' }

  const coarseTakeoff = bestRun.start
  const coarseLanding = bestRun.start + bestRun.length
  if (coarseLanding >= times.length) return { kind: 'landing-past-end' }

  const edgeThreshold = AIRBORNE_THRESHOLD_FRACTION * staturePxAtJump

  // Re-derive each boundary against the standing level on its own side. The
  // global floor above is kept for WHICH run is the jump — a question the
  // whole clip answers better than either end of it.
  const takeoffFloorY = localFloor(
    footY, coarseTakeoff - FLOOR_WINDOW_GAP - FLOOR_WINDOW_FRAMES, coarseTakeoff - FLOOR_WINDOW_GAP,
    floorY
  )
  const landingFloorY = localFloor(
    footY, coarseLanding + FLOOR_WINDOW_GAP, coarseLanding + FLOOR_WINDOW_GAP + FLOOR_WINDOW_FRAMES,
    floorY
  )

  // A stricter floor moves the boundary inwards, a looser one outwards, so
  // each edge walks in whichever direction its own floor requires.
  let takeoffFrame = coarseTakeoff
  while (takeoffFrame < coarseLanding && !(takeoffFloorY - footY[takeoffFrame]! > edgeThreshold)) {
    takeoffFrame++
  }
  while (takeoffFrame > 1 && takeoffFloorY - footY[takeoffFrame - 1]! > edgeThreshold) takeoffFrame--
  if (takeoffFrame >= coarseLanding) return { kind: 'no-flight' }

  let landingFrame = coarseLanding
  while (landingFrame > takeoffFrame + 1 && !(landingFloorY - footY[landingFrame - 1]! > edgeThreshold)) {
    landingFrame--
  }
  while (landingFrame < times.length && landingFloorY - footY[landingFrame]! > edgeThreshold) {
    landingFrame++
  }
  if (landingFrame >= times.length) return { kind: 'landing-past-end' }

  const leading = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, landingFrame - takeoffFrame) },
    (_, k) => takeoffFrame + k
  )
  const trailing = Array.from(
    { length: Math.min(EDGE_FIT_FRAMES, landingFrame - takeoffFrame) },
    (_, k) => landingFrame - 1 - k
  ).reverse()

  // The coarse threshold can lag the true landing split by about a frame
  // (see MAX_BOUNDARY_EXTENSION); reclaim any adjacent frame that is
  // actually part of the flight before fitting and clamping. This always
  // runs, even for a run already far past MAX_FLIGHT_SECONDS: the too-long
  // case still needs a fully-resolved phase to hand downstream (see
  // FlightPhaseOutcome), and extension's own cost is bounded by
  // EDGE_FIT_FRAMES + MAX_BOUNDARY_EXTENSION regardless of how long the
  // airborne run is.
  const trailingExtended = extendBoundary(
    times, footY, landingFloorY, edgeThreshold, trailing, 1, times.length - 1
  )

  const finalTakeoffFrame = takeoffFrame
  const finalLandingFrame = trailingExtended[trailingExtended.length - 1]! + 1

  const finalDuration = times[finalLandingFrame]! - times[finalTakeoffFrame]!

  // Takeoff: a ballistic fit when the foot's trajectory actually supports
  // one, and the midpoint of the containing frame interval when it does not.
  // What it never does any more is CLAMP a rejected extrapolation onto the
  // interval boundary.
  //
  // The extrapolation assumes the foot is ballistic the moment it leaves the
  // ground. Off a real takeoff it is not: the ankle is still plantarflexing,
  // so the foot barely moves for a frame and then accelerates. Measured on a
  // real clip (footY at the first three airborne frames: 850.7, 851.1,
  // 836.7) the quadratic was rejected at every window size from 3 to 5 —
  // c2 came out non-positive, i.e. not a ballistic arc at all — and the
  // linear fallback extrapolated 1.5 to 3 frames before the last contact
  // frame. Clamping turned each of those into the interval's lower bound and
  // reported it as a sub-frame measurement, which is how a foot still on the
  // ground came to be timed as airborne. Falling back to the midpoint
  // instead put takeoff at frame 144.45, against 144.5 read off the video
  // frame by frame; the clamped extrapolation gave 143.95 at best.
  //
  // No extendBoundary on this edge. On the same clip it reclaimed the frame
  // the video shows still in contact — its clearance guard passed (11.3 px
  // of 14.2) and the frame did sit near the fitted line, because a foot
  // rolling onto the toes is moving, just not airborne.
  //
  // The landing keeps both its extension and its extrapolation, and that
  // asymmetry is physical rather than a compromise: nothing actuates the
  // foot on the way down, so it really is ballistic into contact. Measured
  // on the same clip, landing came out 179.79 against ~180 from the video.
  // The window the fit is allowed to land in reaches TAKEOFF_LOOKBACK_FRAMES
  // back, not one. The airborne threshold is a displacement, so the foot
  // needs time to clear it: at 0.02 of stature and a 0.5 m jump's takeoff
  // speed that is about 0.7 of a frame at 60 fps, and wherever takeoff falls
  // inside its own frame the true instant can sit more than a frame before
  // the first frame that clears. A one-frame window rejected those and fell
  // back to the midpoint, costing 5 cm on fixtures whose foot is genuinely
  // ballistic. Widening the window is not the same as reclassifying frames
  // as airborne (what extendBoundary did, and what pulled a still-planted
  // foot into the flight on real footage) — it only decides which fitted
  // answers are admissible.
  // Two tiers of trust. A quadratic that fitParabola accepted has actually
  // demonstrated a ballistic arc, so it may reach the full lookback back. A
  // linear chord has demonstrated nothing beyond a direction of travel, so it
  // may only reach one frame — enough to keep it useful where the quadratic
  // is rejected by noise, not enough to let it place takeoff before a foot
  // that is still pushing off. On the real clip its answers (1.5 to 3 frames
  // early) fall outside the one-frame window and are discarded.
  const takeoffFit = finalTakeoffFrame === 0
    ? null
    : quadraticCrossing(times, footY, leading, takeoffFloorY,
        [times[Math.max(0, finalTakeoffFrame - TAKEOFF_LOOKBACK_FRAMES)]!,
         times[finalTakeoffFrame]!], true)
      ?? linearCrossingInBounds(times, footY, leading, takeoffFloorY,
        [times[finalTakeoffFrame - 1]!, times[finalTakeoffFrame]!])

  const takeoffTime = finalTakeoffFrame === 0
    ? times[0]!
    : takeoffFit ?? (times[finalTakeoffFrame - 1]! + times[finalTakeoffFrame]!) / 2

  const landingTime = crossingTime(times, footY, trailingExtended, landingFloorY,
    times[finalLandingFrame]!,
    [times[finalLandingFrame - 1]!, times[finalLandingFrame]!], false)

  const phase: FlightPhase = {
    takeoffFrame: finalTakeoffFrame, landingFrame: finalLandingFrame,
    takeoffTime, landingTime, staturePxAtJump,
  }

  return finalDuration > MAX_FLIGHT_SECONDS ? { kind: 'too-long', phase } : { kind: 'found', phase }
}
```

Замечание для сверки: единственные содержательные отличия от прежней версии — (1) вставка блока `globalRun`/скользящего фолбэка перед вычислением `coarseTakeoff`/`coarseLanding`, (2) переменная `edgeThreshold` вместо голого `threshold` во всех местах ПОСЛЕ нахождения кандидата (циклы уточнения `takeoffFrame`/`landingFrame`, вызов `extendBoundary`), (3) новое поле `staturePxAtJump` в возвращаемом `phase`. `localFloor`'s фолбэк — по-прежнему глобальный `floorY` в обоих вызовах, без изменений: это осознанное упрощение (см. спеку, раздел 6), а не недосмотр.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/flightPhase.test.ts`
Expected: PASS. Если тесты на дрейф («recovers a short flight», «places takeoff near...», «reads the stature...») не проходят с первой попытки — это фикстура нуждается в подстройке чисел (например, `driftSeconds`, амплитуда дрейфа), а не сама логика: убедитесь через `console.log(outcome)`, что происходит на самом деле, прежде чем менять код `findFlightPhase`.

- [ ] **Step 5: Проверить типы и полный набор**

Run: `npx vue-tsc -b`
Expected: без ошибок.

Run: `npm test`
Expected: PASS. Сообщите фактическое число.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/flightPhase.ts src/lib/flightPhase.test.ts
git commit -m "Fall back to a rolling floor/stature only when the global one already failed"
```

---

### Task 4: `jumpFromCom.ts` читает `staturePxAtJump`

**Files:**
- Modify: `src/lib/jumpFromCom.ts`

**Interfaces:**
- Consumes: `FlightPhase.staturePxAtJump` (из Task 3)
- Produces: ничего нового — `JumpAnalysis.statureM` теперь точнее на дрейфующих клипах

- [ ] **Step 1: Изменить `src/lib/jumpFromCom.ts`**

Найти в `runAnalysis`:

```ts
    statureM: track.staturePx / fit.scalePxPerM,
```

Заменить на:

```ts
    statureM: phase.staturePxAtJump / fit.scalePxPerM,
```

(`phase` уже в области видимости — деструктурировано строкой выше, `const { phase } = flight`.)

- [ ] **Step 2: Убедиться, что существующие тесты проходят без изменений**

Run: `npx vitest run src/lib/jumpFromCom.test.ts`
Expected: PASS, все прежние точные значения (`statureM` между 1.3 и 2.2 и т.д.) не сдвинулись — на нестационарных синтетических клипах, которые использует этот файл, `staturePxAtJump` не отличается от `track.staturePx` (клип короче `ROLLING_WINDOW_SECONDS`, скользящий путь ни разу не задействуется).

- [ ] **Step 3: Полный набор и типы**

Run: `npx vue-tsc -b && npm test`
Expected: без ошибок, число тестов не изменилось.

- [ ] **Step 4: Коммит**

```bash
git add src/lib/jumpFromCom.ts
git commit -m "Check plausibility against the stature measured at the jump, not the whole clip"
```

---

### Task 5: `usePoseDetection.ts` — тот же приём в `airborneIndices()`

**Files:**
- Modify: `src/composables/usePoseDetection.ts`

**Interfaces:**
- Consumes: `rollingMedian`, `rollingPercentile` из `../lib/stats`; `ROLLING_WINDOW_SECONDS`, `MIN_ROLLING_POINTS` из `../lib/flightPhase` (Task 3)
- Produces: ничего нового наружу — `airborneIndices` остаётся внутренней функцией композабла

Композабл тестами не покрывается (политика проекта) — проверка только ручная, в Task 9.

- [ ] **Step 1: Изменить импорты**

Найти:

```ts
import { planCoarsePass, planFinePass } from '../lib/framePlan'
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../lib/poseTypes'
```

Заменить на:

```ts
import { planCoarsePass, planFinePass } from '../lib/framePlan'
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS } from '../lib/flightPhase'
import { rollingMedian, rollingPercentile } from '../lib/stats'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../lib/poseTypes'
```

- [ ] **Step 2: Заменить `airborneIndices`**

Найти всю функцию:

```ts
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
    // A degenerate detection (nose at or below foot level in every frame)
    // sends the threshold to zero or negative, which then reads nearly every
    // sample as airborne — measured: 50 of 50 fine-pass seeks, roughly six
    // times the detector calls, before the pipeline downstream correctly
    // refuses the result anyway. Refuse to flag anything here instead.
    if (!(stature > 0)) return []
    const threshold = COARSE_AIRBORNE_FRACTION * stature
    const indices: number[] = []
    for (let i = 0; i < footY.length; i++) {
      if (floor - footY[i]! > threshold) indices.push(i)
    }
    return indices
  }
```

Заменить на:

```ts
  /**
   * Same displacement test the pixel-space version below uses, applied once
   * with a given floor/stature source. Shared so the global and rolling
   * passes below can only differ in what floor/stature they read, never in
   * how a sample gets classified from them.
   */
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
    const globalFloor = sorted[Math.min(sorted.length - 1, Math.round(0.9 * (sorted.length - 1)))]!
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
    const rollingStature = rollingPercentile(times, spans, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, 0.9)
    const rollingIndices = classify(
      footY,
      (i) => rollingFloor[i] ?? globalFloor,
      (i) => rollingStature[i] ?? globalStature
    )
    return rollingIndices.length > 0 ? rollingIndices : globalIndices
  }
```

- [ ] **Step 3: Проверить типы и сборку**

Run: `npx vue-tsc -b`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 4: Убедиться, что тесты не сломались**

Run: `npm test`
Expected: PASS, число не изменилось (композабл тестами не покрывается).

- [ ] **Step 5: Коммит**

```bash
git add src/composables/usePoseDetection.ts
git commit -m "Give the coarse-pass scheduler the same rolling fallback flightPhase.ts has"
```

---

### Task 6: Синтетический дрейф в `syntheticJumper.ts`

**Files:**
- Modify: `src/lib/testing/syntheticJumper.ts`
- Modify: `src/lib/testing/syntheticJumper.test.ts`

**Interfaces:**
- Consumes: ничего нового
- Produces: `JumpOptions.approachScaleRatio?: number`

По умолчанию (`approachScaleRatio` не задан или равен 1) генератор выдаёт **побитово** тот же результат, что и сегодня — это должно быть проверено тестом, не просто заявлено.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `src/lib/testing/syntheticJumper.test.ts`, перед закрывающей скобкой `describe('generateJump', ...)`:

```ts
  it('is identical to no-drift output when approachScaleRatio is left at its default', () => {
    const withDefault = generateJump(BASE)
    const explicit1 = generateJump({ ...BASE, approachScaleRatio: 1 })
    expect(explicit1.frames).toEqual(withDefault.frames)
    expect(explicit1.truth).toEqual(withDefault.truth)
  })

  it('shrinks the pre-takeoff standing figure toward the arrived scale', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 2, standFrames: 40 })
    const footYAt = (t: number) => {
      const f = clip.frames.find((x) => x.time >= t)!
      return Math.max(...FOOT_LANDMARKS.map((i) => f.landmarks[i]!.y))
    }
    // Frame 0 is at the far (2x) end of the ramp; a frame just before takeoff
    // is at the arrived (1x) end. Both stand on the same floor line
    // (floorYPx), so a LARGER apparent scale pushes the foot's normalized y
    // further from that line -- frame 0's foot should sit clearly higher up
    // the frame (smaller normalized y) than the frame right before takeoff.
    expect(footYAt(0)).toBeLessThan(footYAt(clip.truth.takeoffTime - 1 / BASE.fps))
  })

  it('holds the arrived scale for the flight and after landing, matching scalePxPerM exactly', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 2 })
    // truth.scalePxPerM is always the arrived (post-drift) scale -- the
    // flight itself is never modelled as changing scale (see the
    // running-approach-jump design doc's explicit scope decision).
    expect(clip.truth.scalePxPerM).toBe(BASE.scalePxPerM)
    expect(clip.truth.statureM).toBe(1.8)
  })
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/testing/syntheticJumper.test.ts`
Expected: FAIL — `approachScaleRatio` не распознаётся опцией (TypeScript-ошибка) либо второй тест не находит разницы.

- [ ] **Step 3: Изменить `src/lib/testing/syntheticJumper.ts`**

Добавить в `JumpOptions`, после `seed?: number`:

```ts
  /**
   * Ratio of the person's apparent scale (px per metre) at the very start of
   * the clip to their scale from takeoff onward — simulates the
   * camera-to-subject distance changing during a running approach, before
   * the jump. Default 1: no drift, byte-identical to a clip with no
   * approach.
   *
   * Ramps linearly from `approachScaleRatio` (frame 0) to 1 (at takeoff) —
   * `scalePxPerM` always means the scale active from takeoff onward, exactly
   * as it did before this option existed. Holds at 1 (i.e. at `scalePxPerM`
   * unchanged) for the rest of the clip after that. The flight itself is
   * never modelled as changing scale: real athletes travel meaningfully less
   * far in 0.4-0.6s airborne than during a multi-second approach, and this
   * option's job is to validate takeoff/landing detection under drift, not
   * to model scale changing mid-flight (see the running-approach-jump design
   * doc's explicit scope decision).
   */
  approachScaleRatio?: number
```

Найти:

```ts
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
```

Заменить на:

```ts
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
    approachScaleRatio = 1,
  } = options
```

Найти:

```ts
  /**
   * Builds one pose. `liftM` raises knees and feet toward the hips; the caller
   * decides where the figure ends up vertically.
   */
  function buildPose(liftM: number): Landmark[] {
    const up = (fraction: number, lift = 0) => floorYPx - (fraction * statureM + lift) * scalePxPerM
    const cx = videoWidth / 2
    const sideX = (halfWidth: number, side: number) => cx + side * halfWidth * staturePx
```

Заменить на:

```ts
  /**
   * Builds one pose at a given scale (px per metre) and lift (metres).
   * `scale` defaults to `scalePxPerM` — the value every call site used
   * before `approachScaleRatio` existed. Only the pre-takeoff drift ramp
   * below ever passes a different one, to simulate the person's apparent
   * size changing as they approach.
   */
  function buildPose(liftM: number, scale: number = scalePxPerM): Landmark[] {
    const up = (fraction: number, lift = 0) => floorYPx - (fraction * statureM + lift) * scale
    const cx = videoWidth / 2
    const frameStaturePx = statureM * scale
    const sideX = (halfWidth: number, side: number) => cx + side * halfWidth * frameStaturePx
```

Найти (несколько строк ниже, всё ещё внутри `buildPose`):

```ts
  }

  function shift(landmarks: Landmark[], dyPx: number): Landmark[] {
```

(Пусто между — оставить как есть, `put(LM.NOSE, ...)` и `return landmarks` между ними не трогаются.) Теперь найти основной цикл:

```ts
  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps
    let landmarks: Landmark[]

    if (time <= takeoffTime || time >= landingTime) {
      landmarks = standingPose
    } else {
```

Заменить на:

```ts
  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps
    let landmarks: Landmark[]

    if (time <= takeoffTime) {
      // Ramp the apparent scale from approachScaleRatio (frame 0) to 1 (at
      // takeoff) — see JumpOptions.approachScaleRatio. A ratio of 1 (the
      // default) makes this branch produce exactly `standingPose` every
      // frame, identical to before this option existed.
      const driftProgress = takeoffTime > 0 ? Math.min(1, Math.max(0, time / takeoffTime)) : 1
      const frameScaleRatio = approachScaleRatio + (1 - approachScaleRatio) * driftProgress
      landmarks = frameScaleRatio === 1 ? standingPose : buildPose(0, scalePxPerM * frameScaleRatio)
    } else if (time >= landingTime) {
      landmarks = standingPose
    } else {
```

Не менять ничего после этого `else {` до конца цикла — тело ветки полёта (`tReal`, `riseM`, `lift`, `airbornePose`, `targetComYPx`, `shift(...)`) остаётся как есть, оно уже использует `scalePxPerM` (арендованный/прибывший масштаб) напрямую.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/testing/syntheticJumper.test.ts`
Expected: PASS.

- [ ] **Step 5: Полный набор, типы, коммит**

Run: `npx vue-tsc -b && npm test`
Expected: без ошибок, число тестов выросло на 3.

```bash
git add src/lib/testing/syntheticJumper.ts src/lib/testing/syntheticJumper.test.ts
git commit -m "Let the synthetic jumper simulate an approach that changes apparent scale"
```

---

### Task 7: Сквозной тест на дрейфующем синтетическом клипе

**Files:**
- Modify: `src/lib/acceptance.test.ts`

**Interfaces:**
- Consumes: `generateJump` с `approachScaleRatio` (Task 6), `measureJump` (уже существует)
- Produces: ничего нового — только тест

- [ ] **Step 1: Написать тест**

Добавить в `src/lib/acceptance.test.ts`, новым `describe`-блоком в конец файла:

```ts
describe('acceptance: an approach that changes the athlete\'s distance to the camera', () => {
  // Loose bounds throughout this block, deliberately: this scenario's own
  // scope (see the running-approach-jump design doc) is "find takeoff and
  // landing, give a rough number" — not the sub-percent precision the
  // stationary-jump suite above holds itself to.
  it('still reports a usable height instead of landing-past-end', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 2.2, standFrames: 90 })
    const result = measureJump(clip.frames, VIDEO)
    expect(result.analysis).not.toBeNull()
    expect(result.verdict.kind).not.toBe('unusable')
  })

  it('keeps the recovered height within a rough neighbourhood of the true one', () => {
    const clip = generateJump({ ...BASE, approachScaleRatio: 2.2, standFrames: 90 })
    const result = measureJump(clip.frames, VIDEO)
    // BASE.jumpHeightM is 0.5 -> 50cm. Loose on purpose -- see the block
    // comment above.
    expect(Math.abs(result.analysis!.comHeightCm - 50)).toBeLessThan(10)
  })
})
```

- [ ] **Step 2: Прогнать**

Run: `npx vitest run src/lib/acceptance.test.ts`
Expected: PASS. Если нет — прежде чем трогать `flightPhase.ts`, замерьте вручную (`console.log`), что возвращает `measureJump` на этом клипе: возможно, `standFrames: 90` или `approachScaleRatio: 2.2` нужно подобрать иначе, чтобы дрейф был достаточно долгим относительно `ROLLING_WINDOW_SECONDS` — это подгонка фикстуры, а не признак того, что Task 3 сломан (Task 3's собственные тесты на `flightPhase.ts` уже проверяют сам механизм изолированно).

- [ ] **Step 3: Полный набор и коммит**

Run: `npm test`
Expected: PASS. Число выросло на 2.

```bash
git add src/lib/acceptance.test.ts
git commit -m "Prove the pipeline survives an approach that changes the athlete's distance"
```

---

### Task 8: Регрессия на реальном клипе

**Files:**
- Create: `src/lib/testing/realClipFixture.ts`
- Create: `src/lib/realClipFixture.test.ts`

**Interfaces:**
- Consumes: `measureJump` из `./jumpFromCom`
- Produces: `REAL_CLIP_FRAMES: PoseFrame[]`, `REAL_CLIP_VIDEO: VideoSize` — экспортированные константы с реальными координатами

Числа (не видео) — из клипа, который прислали для отладки скелета со спины в этой же сессии: 156 кадров, полные лендмарки MediaPipe (модель `lite`, порог уверенности 0.1 — то самое значение, которое уже вшито в `usePoseDetection.ts`).

- [ ] **Step 1: Подготовить данные фикстуры**

Файл с уже извлечёнными координатами лежит в скрэтч-директории по пути `/tmp/claude-1000/-home-cypher-Projects-jump-measurer/ecbd4e4f-5a94-4a07-b03b-97cb078814e2/scratchpad/lite_lowconf_frames.json` (104 кадра с полной позой из 156, извлечённые при пороге уверенности 0.1 — том самом, что уже используется в продакшене). Формат: `{ videoWidth, videoHeight, frames: [{ time, landmarks: [{x,y}, ...33] }, ...] }`.

Прочитать этот файл и написать его содержимое в `src/lib/testing/realClipFixture.ts` как буквальный литерал TypeScript (не `readFileSync` — `src/lib/**` не должен зависеть от файловой системы или от чего-либо вне репозитория во время выполнения):

```ts
import type { PoseFrame, VideoSize } from '../poseTypes'

/**
 * Real MediaPipe landmark output from a clip used to debug two things in
 * this codebase's history: why detection loses the athlete from behind, and
 * why the pipeline could not find a landing when the athlete ran toward the
 * camera before jumping (see the running-approach-jump design doc). Numeric
 * coordinates only — the source video never entered this repository, and
 * this fixture identifies no one.
 *
 * Extracted at the confidence gate already shipped in usePoseDetection.ts
 * (minPoseDetectionConfidence/minPosePresenceConfidence 0.1), pose_landmarker
 * lite — the same model and settings production actually runs.
 */
export const REAL_CLIP_VIDEO: VideoSize = { width: 1920, height: 1080 }

export const REAL_CLIP_FRAMES: PoseFrame[] = [
  // Paste the `frames` array from lite_lowconf_frames.json here verbatim,
  // reshaping each entry from `{time, landmarks: [{x,y}, ...]}` (already
  // this exact shape) — no reshaping needed, the JSON's `frames` value IS a
  // valid PoseFrame[] literal.
]
```

Замените плейсхолдерный комментарий на реальное содержимое поля `frames` из JSON-файла — это должно дать массив из 104 объектов вида `{ time: number, landmarks: [{ x, y }, ×33] }`.

- [ ] **Step 2: Написать тест**

Создать `src/lib/realClipFixture.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { measureJump } from './jumpFromCom'
import { REAL_CLIP_FRAMES, REAL_CLIP_VIDEO } from './testing/realClipFixture'

describe('measureJump on a real clip with a running approach', () => {
  // No known ground truth for this clip -- it was never re-measured by hand
  // frame-by-frame. This pins that the pipeline no longer refuses to even
  // try (landing-past-end, the bug that motivated this whole plan), not that
  // a specific height is correct.
  it('finds a landing instead of landing-past-end', () => {
    const result = measureJump(REAL_CLIP_FRAMES, REAL_CLIP_VIDEO)
    const isLandingPastEnd = result.verdict.kind === 'unusable'
      && result.verdict.reason === 'short-flight'
      && result.analysis === null
    expect(isLandingPastEnd).toBe(false)
  })

  it('produces a finite analysis when it does resolve a flight', () => {
    const result = measureJump(REAL_CLIP_FRAMES, REAL_CLIP_VIDEO)
    if (result.analysis) {
      expect(Number.isFinite(result.analysis.comHeightCm)).toBe(true)
      expect(Number.isFinite(result.analysis.statureM)).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Прогнать**

Run: `npx vitest run src/lib/realClipFixture.test.ts`
Expected: PASS. Если первый тест не проходит — вернитесь к Task 3 и Task 5: это означает, что на реальных, не синтетических данных откат к скользящему проходу не сработал так, как ожидалось (реальный шум ландмарок отличается от аккуратной синтетики), и стоит вывести `findFlightPhase`'s промежуточные значения (`globalRun`, `rollingRun`) через временный `console.log`, а не гадать.

- [ ] **Step 4: Полный набор, типы, коммит**

Run: `npx vue-tsc -b && npm test`
Expected: без ошибок. Число тестов выросло на 2.

```bash
git add src/lib/testing/realClipFixture.ts src/lib/realClipFixture.test.ts
git commit -m "Pin the real clip that motivated this work as a permanent regression"
```

---

### Task 9: Полная перевалидация и ручная проверка

**Files:** ничего не меняется — это проверка.

- [ ] **Step 1: Полный прогон тестов**

Run: `npm test`
Expected: PASS. Итоговое число — база 165 плюс: 11 (Task 1) + 1 (Task 2) + 4 (Task 3) + 0 (Task 4) + 0 (Task 5) + 3 (Task 6) + 2 (Task 7) + 2 (Task 8) = **188**. Если фактическое число отличается — не подгоняйте тесты под число, разберитесь, какой тест лишний или недостающий.

- [ ] **Step 2: Типы и сборка**

Run: `npx vue-tsc -b`
Expected: без ошибок.

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 3: Ручная проверка в браузере**

Run: `npm run dev -- --host`

Прогнать реальный клип с разгона (тот же самый, что уже был прислан для отладки, если он доступен локально) через кнопку автодетекта. Проверить:

1. Пайплайн не зависает и не выдаёт `unusable` из-за `landing-past-end` там, где раньше выдавал.
2. Скелет и найденное окно полёта визуально соответствуют месту, где человек действительно прыгнул (не разбегу целиком).
3. На обычном, стационарном прыжке (без разгона) поведение не изменилось — то, что работало, продолжает работать.

- [ ] **Step 4: Итоговый отчёт**

Если что-то из Step 3 выглядит не так — прежде чем менять `ROLLING_WINDOW_SECONDS` или другие константы, выведите через `console.log` в `usePoseDetection.ts` (временно, не коммитить) `airborneIndices`'s промежуточные `globalIndices`/`rollingIndices`, чтобы увидеть, какой из двух путей сработал и почему — раздел 3.2 спеки прямо называет ширину окна открытым вопросом, а не решённым числом.

---

## Определение готовности

- `npm test` проходит, число выросло с 165 до ожидаемых ~188
- `npx vue-tsc -b` и `npm run build` чистые
- Ни один существующий тест не изменил ожидаемое поведение без явного, задокументированного обоснования (единственное намеренное изменение — `flightPhase.test.ts`'s `track()`-хелпер получил поле `spans`)
- Реальный клип, из-за которого начата эта работа, больше не даёт `landing-past-end`
- `src/lib/**` по-прежнему без Vue, DOM и недетерминированности
- Единственная правка вне перечисленных файлов — если правка `ROLLING_WINDOW_SECONDS`/`MIN_ROLLING_POINTS` по результатам ручной проверки на Step 3 потребовалась, она отражена в этих же файлах, не расползлась по проекту

## Чего в этом плане намеренно нет

Изменение результата, если дистанция до камеры меняется **во время** самого полёта (не только на разгоне) — открытый вопрос, вынесенный в спеку отдельно. Переделка карточки результата — уже отдельно спроектирована пользователем. Несколько прыжков в одном видео — отдельная, ещё не спроектированная задача.
