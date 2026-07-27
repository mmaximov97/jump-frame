# PR-A: зум по видео — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю приближать и двигать видео жестами, чтобы разглядеть стопы в кадре отрыва.

**Architecture:** Чистая геометрия (расчёт прямоугольника видео, зажим сдвига, зум относительно точки, проекция координат) выносится в `src/lib/zoomMath.ts` и покрывается юнит-тестами. Композабл `useVideoZoom` добавляет реактивность и обработку Pointer Events. `VideoPlayer.vue` применяет CSS-трансформ к элементу `<video>` — композитинг идёт на GPU, без `requestAnimationFrame` и без перерисовки.

**Tech Stack:** Vue 3 (Composition API, `<script setup lang="ts">`), Vite, Tailwind CSS v4, Lucide, Vitest.

**Спека:** `docs/2026-07-27-com-tracking-and-zoom-design.md`, раздел 5.

## Global Constraints

- TypeScript strict. Включены `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` — никаких `enum` и параметров-свойств конструктора.
- Только Composition API и `<script setup lang="ts">`, как во всех существующих компонентах.
- Tailwind v4, утилитарные классы. Существующие токены палитры: `surface-light`, `surface-lighter`, `brand-light`.
- Касательные цели не меньше 44 px — в проекте это `min-h-11` / `min-w-11`.
- `vite.config.ts` содержит `base: '/jump-frame/'`. Не ломать.
- Видео не покидает клиент. Никаких новых сетевых запросов в этом PR.
- В сообщениях коммитов **не добавлять** строки `Co-Authored-By`.
- `MIN_SCALE = 1`, `MAX_SCALE = 8`, `DOUBLE_TAP_SCALE = 3`.

## Отклонения от спеки (осознанные)

1. **Vitest появляется в PR-A, а не в PR-B.** Спека помещала тестовый раннер в PR-B. Но геометрия зума — чистые функции, и писать их без тестов значило бы отлаживать матрицу проекции кликами по браузеру. Раннер ставится здесь, PR-B получает его готовым.
2. **Математика зума живёт в `src/lib/zoomMath.ts`, а не внутри композабла.** По той же причине: `src/lib/` — зона без DOM и без Vue, всё тестируемо. Композабл остаётся тонкой обёрткой с реактивностью и событиями.
3. **`touch-action: pan-y` при `scale === 1`, а не `auto`.** Спека говорила «`none` только при `scale > 1`», подразумевая `auto` в остальное время. Это ошибка: при `auto` браузер забирает двупальцевый жест себе под нативный пинч-зум страницы, и приблизить с единицы становится невозможно. `pan-y` оставляет вертикальный скролл страницы (карточка результата под фолдом) и при этом запрещает нативный пинч, отдавая жест нам.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `src/lib/zoomMath.ts` — создать | Чистая геометрия: прямоугольник видео, зажим, зум относительно точки, панорама, проекция. Без DOM, без Vue |
| `src/lib/zoomMath.test.ts` — создать | Юнит-тесты на всё вышеперечисленное |
| `src/composables/useVideoZoom.ts` — создать | Реактивное состояние, Pointer Events, колесо, двойной тап, ResizeObserver |
| `src/components/VideoPlayer.vue` — изменить | Контейнер, трансформ, кнопка сброса, слот для будущего оверлея |
| `src/App.vue` — изменить | Клавиши `+` / `−` |
| `vite.config.ts` — изменить | Конфигурация Vitest |
| `package.json` — изменить | Зависимость `vitest`, скрипты `test` и `test:watch` |

---

### Task 1: Тестовый раннер и прямоугольник видео

**Files:**
- Create: `src/lib/zoomMath.ts`
- Create: `src/lib/zoomMath.test.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: ничего
- Produces: `Size`, `Box`, `computeVideoBox(container: Size, intrinsic: Size): Box`

`computeVideoBox` повторяет то, что CSS делает при `object-contain`: вписывает видео в контейнер с сохранением пропорций и центрирует. Считать это вручную, а не читать `getBoundingClientRect()`, необходимо: как только на `<video>` ляжет трансформ, измеренный прямоугольник начнёт отражать зум, а нам нужен исходный.

- [ ] **Step 1: Поставить Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Настроить Vitest в `vite.config.ts`**

Заменить содержимое файла целиком:

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/jump-frame/',
  plugins: [vue(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

`environment: 'node'` — потому что `src/lib/` по определению не трогает DOM. Если однажды понадобится jsdom, это будет сигналом, что в `lib/` попало лишнее.

- [ ] **Step 3: Добавить скрипты в `package.json`**

В блок `"scripts"` добавить две строки:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Написать падающий тест**

Создать `src/lib/zoomMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeVideoBox } from './zoomMath'

describe('computeVideoBox', () => {
  it('leaves letterbox bars above and below a landscape clip', () => {
    const box = computeVideoBox({ width: 400, height: 300 }, { width: 1920, height: 1080 })
    expect(box.width).toBeCloseTo(400)
    expect(box.height).toBeCloseTo(225)
    expect(box.left).toBeCloseTo(0)
    expect(box.top).toBeCloseTo(37.5)
  })

  it('leaves pillarbox bars left and right of a portrait clip', () => {
    const box = computeVideoBox({ width: 400, height: 300 }, { width: 1080, height: 1920 })
    expect(box.width).toBeCloseTo(168.75)
    expect(box.height).toBeCloseTo(300)
    expect(box.left).toBeCloseTo(115.625)
    expect(box.top).toBeCloseTo(0)
  })

  it('collapses to a zero-size box at the container centre before metadata loads', () => {
    const box = computeVideoBox({ width: 400, height: 300 }, { width: 0, height: 0 })
    expect(box).toEqual({ left: 200, top: 150, width: 0, height: 0 })
  })
})
```

- [ ] **Step 5: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./zoomMath"`.

- [ ] **Step 6: Написать минимальную реализацию**

Создать `src/lib/zoomMath.ts`:

```ts
export interface Size {
  width: number
  height: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Reproduces what CSS `object-contain` does: fit the video inside the
 * container preserving aspect ratio, then centre it.
 *
 * Computed rather than measured on purpose — once a transform is applied to
 * the <video>, getBoundingClientRect() reports the zoomed rectangle, and
 * every projection here needs the unzoomed one.
 */
export function computeVideoBox(container: Size, intrinsic: Size): Box {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    return { left: container.width / 2, top: container.height / 2, width: 0, height: 0 }
  }
  const fit = Math.min(container.width / intrinsic.width, container.height / intrinsic.height)
  const width = intrinsic.width * fit
  const height = intrinsic.height * fit
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  }
}
```

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 3 теста.

- [ ] **Step 8: Коммит**

```bash
git add package.json package-lock.json vite.config.ts src/lib/zoomMath.ts src/lib/zoomMath.test.ts
git commit -m "Add vitest and computeVideoBox for zoom geometry"
```

---

### Task 2: Зажим масштаба и сдвига

**Files:**
- Modify: `src/lib/zoomMath.ts`
- Modify: `src/lib/zoomMath.test.ts`

**Interfaces:**
- Consumes: `Box` из Task 1
- Produces: `ZoomState { scale: number; tx: number; ty: number }`, `MIN_SCALE`, `MAX_SCALE`, `clampZoom(state: ZoomState, box: Box): ZoomState`

Правило зажима: масштабированное видео не должно уезжать так, чтобы его край оказался внутри исходного прямоугольника — иначе в кадре появится чёрная полоса. Масштабированный прямоугольник простирается на `width * scale / 2` от центра, исходный — на `width / 2`. Отсюда `|tx| ≤ width * (scale − 1) / 2`, и на единичном масштабе сдвиг обязан быть нулевым.

- [ ] **Step 1: Написать падающий тест**

Дописать в `src/lib/zoomMath.test.ts`:

```ts
import { clampZoom, MAX_SCALE, MIN_SCALE } from './zoomMath'

describe('clampZoom', () => {
  const box = { left: 0, top: 37.5, width: 400, height: 225 }

  it('forces the offset to zero at 1x, where there is nothing to pan', () => {
    expect(clampZoom({ scale: 1, tx: 120, ty: -80 }, box)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('stops the video edge from moving inside the unzoomed box', () => {
    const clamped = clampZoom({ scale: 2, tx: 999, ty: 999 }, box)
    expect(clamped.tx).toBeCloseTo(200)
    expect(clamped.ty).toBeCloseTo(112.5)
  })

  it('clamps symmetrically in the negative direction', () => {
    const clamped = clampZoom({ scale: 2, tx: -999, ty: -999 }, box)
    expect(clamped.tx).toBeCloseTo(-200)
    expect(clamped.ty).toBeCloseTo(-112.5)
  })

  it('leaves an in-range offset untouched', () => {
    expect(clampZoom({ scale: 2, tx: 50, ty: -20 }, box)).toEqual({ scale: 2, tx: 50, ty: -20 })
  })

  it('holds the scale inside its bounds', () => {
    expect(clampZoom({ scale: 0.2, tx: 0, ty: 0 }, box).scale).toBe(MIN_SCALE)
    expect(clampZoom({ scale: 99, tx: 0, ty: 0 }, box).scale).toBe(MAX_SCALE)
  })

  it('never returns negative zero', () => {
    // Clamping a negative offset against a zero limit yields -0 in JS, which
    // would render as "translate(-0px)" and compares unequal to 0 in tests.
    expect(Object.is(clampZoom({ scale: 1, tx: 0, ty: -80 }, box).ty, 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `clampZoom is not exported`.

- [ ] **Step 3: Написать реализацию**

Дописать в `src/lib/zoomMath.ts`:

```ts
export interface ZoomState {
  scale: number
  tx: number
  ty: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 8

/**
 * Clamping a negative value against a zero limit produces -0, which renders
 * as "translate(-0px)" and compares unequal to 0 under Object.is.
 */
function withoutNegativeZero(n: number): number {
  return n === 0 ? 0 : n
}

/**
 * Keeps the zoomed video covering at least its own unzoomed box, so panning
 * can never reveal a black gap at the edge. At 1x there is nothing to pan,
 * so the offset collapses to zero.
 */
export function clampZoom(state: ZoomState, box: Box): ZoomState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale))
  const maxTx = (box.width * (scale - 1)) / 2
  const maxTy = (box.height * (scale - 1)) / 2
  return {
    scale,
    tx: withoutNegativeZero(Math.min(maxTx, Math.max(-maxTx, state.tx))),
    ty: withoutNegativeZero(Math.min(maxTy, Math.max(-maxTy, state.ty))),
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/zoomMath.ts src/lib/zoomMath.test.ts
git commit -m "Clamp zoom scale and pan offset to keep the frame filled"
```

---

### Task 3: Зум относительно точки и панорама

**Files:**
- Modify: `src/lib/zoomMath.ts`
- Modify: `src/lib/zoomMath.test.ts`

**Interfaces:**
- Consumes: `Box`, `ZoomState`, `clampZoom` из Task 2
- Produces: `Point { x: number; y: number }`, `zoomAbout(state: ZoomState, box: Box, anchor: Point, factor: number): ZoomState`, `panBy(state: ZoomState, box: Box, dx: number, dy: number): ZoomState`

Вывод формулы. Экранная позиция точки: `screen = c + (p − c) · s + t`, где `c` — центр прямоугольника. Требуется, чтобы точка под якорем осталась на месте. Из текущего состояния находим её: `p = c + (anchor − c − t) / s`. Подставляем в уравнение для нового состояния и решаем относительно `t′`. Обозначив `d = anchor − c`:

```
t′ = d − (d − t) · s′ / s
```

- [ ] **Step 1: Написать падающий тест**

Дописать в `src/lib/zoomMath.test.ts`:

```ts
import { panBy, zoomAbout } from './zoomMath'

describe('zoomAbout', () => {
  const box = { left: 0, top: 0, width: 400, height: 400 }

  it('keeps the offset at zero when zooming about the centre', () => {
    const zoomed = zoomAbout({ scale: 1, tx: 0, ty: 0 }, box, { x: 200, y: 200 }, 2)
    expect(zoomed).toEqual({ scale: 2, tx: 0, ty: 0 })
  })

  it('shifts the offset so the anchored point stays put', () => {
    const zoomed = zoomAbout({ scale: 1, tx: 0, ty: 0 }, box, { x: 300, y: 200 }, 2)
    expect(zoomed.scale).toBe(2)
    expect(zoomed.tx).toBeCloseTo(-100)
    expect(zoomed.ty).toBeCloseTo(0)
  })

  it('refuses to go past MAX_SCALE', () => {
    const zoomed = zoomAbout({ scale: 6, tx: 0, ty: 0 }, box, { x: 200, y: 200 }, 4)
    expect(zoomed.scale).toBe(MAX_SCALE)
  })

  it('collapses the offset when zooming back out to 1x', () => {
    const zoomed = zoomAbout({ scale: 4, tx: 120, ty: -60 }, box, { x: 200, y: 200 }, 0.1)
    expect(zoomed).toEqual({ scale: MIN_SCALE, tx: 0, ty: 0 })
  })
})

describe('panBy', () => {
  const box = { left: 0, top: 0, width: 400, height: 400 }

  it('adds the delta to the current offset', () => {
    expect(panBy({ scale: 2, tx: 10, ty: 10 }, box, 30, -5)).toEqual({ scale: 2, tx: 40, ty: 5 })
  })

  it('refuses to pan past the clamp', () => {
    expect(panBy({ scale: 2, tx: 190, ty: 0 }, box, 100, 0).tx).toBeCloseTo(200)
  })

  it('does nothing at 1x', () => {
    expect(panBy({ scale: 1, tx: 0, ty: 0 }, box, 50, 50)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `zoomAbout is not exported`.

- [ ] **Step 3: Написать реализацию**

Дописать в `src/lib/zoomMath.ts`:

```ts
export interface Point {
  x: number
  y: number
}

/**
 * Scales by `factor` while holding whatever sits under `anchor` stationary.
 *
 * Screen position of a layout point is `c + (p - c) * s + t`. Solving that
 * for the new offset under the constraint that the anchored point does not
 * move gives `t' = d - (d - t) * s'/s`, where `d = anchor - c`.
 */
export function zoomAbout(state: ZoomState, box: Box, anchor: Point, factor: number): ZoomState {
  const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor))
  const ratio = nextScale / state.scale
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const dx = anchor.x - cx
  const dy = anchor.y - cy
  return clampZoom(
    {
      scale: nextScale,
      tx: dx - (dx - state.tx) * ratio,
      ty: dy - (dy - state.ty) * ratio,
    },
    box
  )
}

export function panBy(state: ZoomState, box: Box, dx: number, dy: number): ZoomState {
  return clampZoom({ scale: state.scale, tx: state.tx + dx, ty: state.ty + dy }, box)
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 16 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/zoomMath.ts src/lib/zoomMath.test.ts
git commit -m "Add anchored zoom and clamped panning"
```

---

### Task 4: Проекция нормализованных координат

**Files:**
- Modify: `src/lib/zoomMath.ts`
- Modify: `src/lib/zoomMath.test.ts`

**Interfaces:**
- Consumes: `Box`, `ZoomState`, `Point`, `zoomAbout` из Task 3
- Produces: `project(nx: number, ny: number, box: Box, state: ZoomState): Point`

Эта функция в PR-A не имеет ни одного потребителя — её единственный клиент появится в PR-C, где оверлей скелета рисуется на отдельном `<canvas>` **вне** трансформа (иначе битмап растянется вместе с видео и линии замылятся). Пишется она здесь, потому что это ровно та же матрица, что и у зума, и разъезд двух её копий был бы неотлаживаемым багом.

Вход — нормализованные координаты MediaPipe (0..1 по ширине и высоте кадра). Выход — пиксели в системе координат контейнера.

- [ ] **Step 1: Написать падающий тест**

Дописать в `src/lib/zoomMath.test.ts`:

```ts
import { project } from './zoomMath'

describe('project', () => {
  const box = { left: 0, top: 0, width: 400, height: 400 }

  it('maps the frame centre to the box centre regardless of zoom', () => {
    expect(project(0.5, 0.5, box, { scale: 1, tx: 0, ty: 0 })).toEqual({ x: 200, y: 200 })
    expect(project(0.5, 0.5, box, { scale: 4, tx: 0, ty: 0 })).toEqual({ x: 200, y: 200 })
  })

  it('pushes the top-left corner off-screen when zoomed', () => {
    expect(project(0, 0, box, { scale: 2, tx: 0, ty: 0 })).toEqual({ x: -200, y: -200 })
  })

  it('accounts for the pan offset', () => {
    expect(project(0, 0, box, { scale: 2, tx: 50, ty: -30 })).toEqual({ x: -150, y: -230 })
  })

  it('agrees with zoomAbout: the landmark under the anchor stays under it', () => {
    // At 1x, the landmark at nx = 0.75 sits at x = 300 — the anchor below.
    const anchor = { x: 300, y: 200 }
    const zoomed = zoomAbout({ scale: 1, tx: 0, ty: 0 }, box, anchor, 2)
    const after = project(0.75, 0.5, box, zoomed)
    expect(after.x).toBeCloseTo(anchor.x)
    expect(after.y).toBeCloseTo(anchor.y)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `project is not exported`.

- [ ] **Step 3: Написать реализацию**

Дописать в `src/lib/zoomMath.ts`:

```ts
/**
 * Normalized frame coordinates (0..1, as MediaPipe reports them) to pixels in
 * the container's coordinate space, with the current zoom applied.
 *
 * The pose overlay canvas deliberately sits outside the CSS transform — a
 * canvas inside it would have its bitmap stretched and the skeleton would go
 * blurry. Instead the points travel through this matrix by hand.
 */
export function project(nx: number, ny: number, box: Box, state: ZoomState): Point {
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const bx = box.left + nx * box.width
  const by = box.top + ny * box.height
  return {
    x: cx + (bx - cx) * state.scale + state.tx,
    y: cy + (by - cy) * state.scale + state.ty,
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 20 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/zoomMath.ts src/lib/zoomMath.test.ts
git commit -m "Add landmark projection shared by zoom and the future pose overlay"
```

---

### Task 5: Композабл `useVideoZoom`

**Files:**
- Create: `src/composables/useVideoZoom.ts`

**Interfaces:**
- Consumes: всё из `src/lib/zoomMath.ts`
- Produces: `useVideoZoom(containerRef: Ref<HTMLElement | null>, videoRef: Ref<HTMLVideoElement | null>)`, возвращающий `{ scale, isZoomed, transformStyle, touchAction, onPointerDown, onPointerMove, onPointerUp, onWheel, zoomIn, zoomOut, reset, project }`

Композабл держит только реактивность и события. Вся арифметика уже протестирована в Task 1–4.

Три решения, которые стоит понимать перед чтением кода:

**`touch-action: pan-y` на единичном масштабе.** При `auto` браузер забирает двупальцевый жест под свой нативный пинч-зум страницы, и приблизить с 1× невозможно. При `none` ломается вертикальный скролл страницы, которым на мобиле достают карточку результата (`App.vue:320`). `pan-y` разрешает вертикальный скролл и запрещает нативный пинч — то есть отдаёт двупальцевый жест нам.

**Панорама одним пальцем работает только при `scale > 1`.** На единице тащить нечего, а перехват жеста опять же убил бы скролл страницы.

**Двойной тап детектируется вручную, а не через `dblclick`.** Pointer Events единообразны для мыши и касания, поэтому одна реализация закрывает оба случая, и её поведение не зависит от того, синтезирует ли конкретный браузер `dblclick` при `touch-action: none`.

**Порог `TAP_SLOP_PX` обязателен, иначе двойной тап на выход из зума не работает.** При `scale > 1` любое `pointermove` — включая дрожание сенсора на неподвижном пальце — попадает в ветку панорамы и ставит `gestureMoved = true`. Ранний выход в `onPointerUp` (`if (!released || pointers.size > 0 || gestureMoved) return`) происходит **до** записи `lastTapAt`, поэтому тап не просто игнорируется, а вообще не регистрируется, и следующему тапу не с чем составить пару. Панорама при этом должна вызываться как обычно с первого же пикселя — порог влияет только на `gestureMoved`. В ветке пинча `gestureMoved` ставится безусловно: два пальца никогда не тап.

- [ ] **Step 1: Написать композабл**

Создать `src/composables/useVideoZoom.ts`:

```ts
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  clampZoom,
  computeVideoBox,
  panBy,
  project as projectPoint,
  zoomAbout,
  MIN_SCALE,
  type Box,
  type Point,
  type ZoomState,
} from '../lib/zoomMath'

const DOUBLE_TAP_SCALE = 3
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 30
// Movement below this counts as a stationary tap, not a drag. Without it,
// touch-sensor jitter sets gestureMoved and the tap is never recorded.
const TAP_SLOP_PX = 5
const WHEEL_SENSITIVITY = 0.002
const KEY_ZOOM_FACTOR = 1.25

export function useVideoZoom(
  containerRef: Ref<HTMLElement | null>,
  videoRef: Ref<HTMLVideoElement | null>
) {
  const state = ref<ZoomState>({ scale: 1, tx: 0, ty: 0 })
  const containerSize = ref({ width: 0, height: 0 })
  const intrinsicSize = ref({ width: 0, height: 0 })

  const box = computed<Box>(() => computeVideoBox(containerSize.value, intrinsicSize.value))
  const scale = computed(() => state.value.scale)
  const isZoomed = computed(() => state.value.scale > MIN_SCALE)

  const transformStyle = computed(() => ({
    transform: `translate(${state.value.tx}px, ${state.value.ty}px) scale(${state.value.scale})`,
  }))

  // pan-y keeps the page scrollable at 1x — on mobile the results card lives
  // below the fold — while still disabling the browser's own pinch-zoom, so
  // our two-finger handler is the one that receives the gesture.
  const touchAction = computed(() => (isZoomed.value ? 'none' : 'pan-y'))

  const pointers = new Map<number, Point>()
  let pinchDistance = 0
  let pinchCentre: Point = { x: 0, y: 0 }
  let gestureMoved = false
  let gestureStart: Point = { x: 0, y: 0 }
  let lastTapAt = 0
  let lastTapPoint: Point = { x: 0, y: 0 }

  function localPoint(e: PointerEvent): Point {
    const el = containerRef.value
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function centreOfBox(): Point {
    return { x: box.value.left + box.value.width / 2, y: box.value.top + box.value.height / 2 }
  }

  function measureContainer() {
    const el = containerRef.value
    if (!el) return
    containerSize.value = { width: el.clientWidth, height: el.clientHeight }
    state.value = clampZoom(state.value, box.value)
  }

  function measureIntrinsic() {
    const el = videoRef.value
    if (!el) return
    intrinsicSize.value = { width: el.videoWidth, height: el.videoHeight }
    state.value = clampZoom(state.value, box.value)
  }

  function onPointerDown(e: PointerEvent) {
    // The reset button lives inside the container; its taps are not gestures.
    if ((e.target as HTMLElement).closest('button')) return
    if (pointers.size === 0) {
      gestureMoved = false
      gestureStart = localPoint(e)
    }
    pointers.set(e.pointerId, localPoint(e))
    containerRef.value?.setPointerCapture(e.pointerId)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Point, Point]
      pinchDistance = distance(a, b)
      pinchCentre = midpoint(a, b)
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return
    const previous = pointers.get(e.pointerId)!
    const current = localPoint(e)
    pointers.set(e.pointerId, current)

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Point, Point]
      const nextDistance = distance(a, b)
      const nextCentre = midpoint(a, b)
      if (pinchDistance > 0) {
        e.preventDefault()
        gestureMoved = true
        const zoomed = zoomAbout(state.value, box.value, pinchCentre, nextDistance / pinchDistance)
        state.value = panBy(
          zoomed,
          box.value,
          nextCentre.x - pinchCentre.x,
          nextCentre.y - pinchCentre.y
        )
      }
      pinchDistance = nextDistance
      pinchCentre = nextCentre
      return
    }

    if (isZoomed.value) {
      e.preventDefault()
      // Pan from the very first pixel, but only call it a gesture once the
      // finger has actually travelled — otherwise sensor jitter during a
      // stationary tap suppresses double-tap detection in onPointerUp.
      if (distance(current, gestureStart) > TAP_SLOP_PX) gestureMoved = true
      state.value = panBy(state.value, box.value, current.x - previous.x, current.y - previous.y)
    }
  }

  function onPointerUp(e: PointerEvent) {
    const released = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDistance = 0
    if (!released || pointers.size > 0 || gestureMoved) return

    const isSecondTap =
      e.timeStamp - lastTapAt < DOUBLE_TAP_MS &&
      distance(released, lastTapPoint) < DOUBLE_TAP_SLOP_PX

    if (isSecondTap) {
      const target = isZoomed.value ? MIN_SCALE : DOUBLE_TAP_SCALE
      state.value = zoomAbout(state.value, box.value, released, target / state.value.scale)
      lastTapAt = 0
      return
    }

    lastTapAt = e.timeStamp
    lastTapPoint = released
  }

  function onWheel(e: WheelEvent) {
    const el = containerRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    state.value = zoomAbout(
      state.value,
      box.value,
      anchor,
      Math.exp(-e.deltaY * WHEEL_SENSITIVITY)
    )
  }

  function zoomIn() {
    state.value = zoomAbout(state.value, box.value, centreOfBox(), KEY_ZOOM_FACTOR)
  }

  function zoomOut() {
    state.value = zoomAbout(state.value, box.value, centreOfBox(), 1 / KEY_ZOOM_FACTOR)
  }

  function reset() {
    state.value = { scale: 1, tx: 0, ty: 0 }
  }

  function project(nx: number, ny: number): Point {
    return projectPoint(nx, ny, box.value, state.value)
  }

  let observer: ResizeObserver | null = null

  watch(
    containerRef,
    (el) => {
      observer?.disconnect()
      observer = null
      if (!el) return
      observer = new ResizeObserver(measureContainer)
      observer.observe(el)
      measureContainer()
    },
    { immediate: true }
  )

  watch(
    videoRef,
    (el, old) => {
      if (old) old.removeEventListener('loadedmetadata', measureIntrinsic)
      if (!el) return
      el.addEventListener('loadedmetadata', measureIntrinsic)
      if (el.videoWidth > 0) measureIntrinsic()
    },
    { immediate: true }
  )

  onUnmounted(() => {
    observer?.disconnect()
    videoRef.value?.removeEventListener('loadedmetadata', measureIntrinsic)
  })

  return {
    scale,
    isZoomed,
    transformStyle,
    touchAction,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    zoomIn,
    zoomOut,
    reset,
    project,
  }
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx vue-tsc -b`
Expected: без ошибок. Если ругается на неиспользуемый импорт — значит что-то из списка импортов не понадобилось; удалить, а не глушить (`noUnusedLocals` включён намеренно).

- [ ] **Step 3: Убедиться, что юнит-тесты не сломались**

Run: `npm test`
Expected: PASS, 20 тестов.

- [ ] **Step 4: Коммит**

```bash
git add src/composables/useVideoZoom.ts
git commit -m "Add useVideoZoom composable with pinch, pan, wheel and double-tap"
```

---

### Task 6: Подключить зум в `VideoPlayer.vue`

**Files:**
- Modify: `src/components/VideoPlayer.vue`

**Interfaces:**
- Consumes: `useVideoZoom` из Task 5
- Produces: `VideoPlayer` с `defineExpose({ zoomIn, zoomOut, resetZoom, project, isZoomed })` и именованным слотом `overlay`

Слот `overlay` в этом PR пуст. Он ставится сейчас, потому что PR-C положит туда `PoseOverlay.vue`, и это должно быть местом внутри контейнера, но **вне** трансформа.

- [ ] **Step 1: Переписать компонент**

Заменить содержимое `src/components/VideoPlayer.vue` целиком:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Minimize2 } from 'lucide-vue-next'
import { useVideoZoom } from '../composables/useVideoZoom'

const props = defineProps<{
  src: string
}>()

const emit = defineEmits<{
  'video-ref': [el: HTMLVideoElement | null]
}>()

const containerRef = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)

const {
  scale,
  isZoomed,
  transformStyle,
  touchAction,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  zoomIn,
  zoomOut,
  reset,
  project,
} = useVideoZoom(containerRef, videoEl)

function setRef(el: any) {
  videoEl.value = el as HTMLVideoElement | null
  emit('video-ref', videoEl.value)
}

// A new clip means new framing — never inherit the previous jump's zoom.
watch(() => props.src, reset)

defineExpose({ zoomIn, zoomOut, resetZoom: reset, project, isZoomed })
</script>

<template>
  <div
    ref="containerRef"
    class="relative flex-1 min-h-[180px] rounded-xl overflow-hidden bg-black flex items-center justify-center"
    :style="{ touchAction }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="onWheel"
  >
    <video
      :ref="setRef"
      :src="src"
      playsinline
      preload="auto"
      class="max-w-full max-h-full block object-contain will-change-transform"
      :style="transformStyle"
    />

    <!-- PR-C mounts the pose overlay here: inside the container, outside the
         transform, so its canvas bitmap is never stretched. -->
    <slot name="overlay" />

    <button
      v-if="isZoomed"
      class="absolute bottom-2 right-2 min-h-11 px-3 flex items-center justify-center gap-1.5
             rounded-lg bg-black/60 backdrop-blur text-xs font-medium text-slate-200
             hover:bg-black/80 transition-colors"
      title="Reset zoom"
      aria-label="Reset zoom"
      @click="reset"
    >
      <Minimize2 class="w-4 h-4" />
      <span>{{ scale.toFixed(1) }}×</span>
    </button>
  </div>
</template>
```

- [ ] **Step 2: Проверить типы и сборку**

Run: `npm run build`
Expected: сборка проходит без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add src/components/VideoPlayer.vue
git commit -m "Wire zoom into VideoPlayer with reset control and overlay slot"
```

---

### Task 7: Клавиши на десктопе и ручная проверка

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `VideoPlayer` с exposed `zoomIn` / `zoomOut` из Task 6
- Produces: ничего (последняя задача PR-A)

- [ ] **Step 1: Добавить ref на плеер**

В `<script setup>` в `src/App.vue`, рядом с остальными `ref`, добавить:

```ts
const videoPlayer = ref<InstanceType<typeof VideoPlayer> | null>(null)
```

- [ ] **Step 2: Расширить обработчик клавиш**

Заменить функцию `onKeydown` в `src/App.vue`:

```ts
function onKeydown(e: KeyboardEvent) {
  if (!isVideoLoaded.value || showShareCard.value) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    stepBackward()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    stepForward()
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    videoPlayer.value?.zoomIn()
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    videoPlayer.value?.zoomOut()
  }
}
```

`=` и `_` перечислены рядом с `+` и `−`, потому что это те же физические клавиши без Shift — иначе зум работал бы только с зажатым Shift.

- [ ] **Step 3: Привязать ref в шаблоне**

В `src/App.vue` заменить строку с плеером:

```html
<VideoPlayer ref="videoPlayer" :src="videoSrc" @video-ref="setVideoRef" />
```

- [ ] **Step 4: Собрать**

Run: `npm run build`
Expected: сборка проходит без ошибок.

- [ ] **Step 5: Ручная проверка в браузере**

Run: `npm run dev`, открыть приложение, загрузить видео прыжка.

Проверить по списку. Пункты 5 и 6 — те, ради которых `touch-action` выставляется динамически; если сломано именно там, причина почти наверняка в нём.

- [ ] Колесо мыши над видео приближает и отдаляет, точка под курсором остаётся на месте
- [ ] Двойной клик приближает до 3×, повторный двойной клик возвращает к 1×
- [ ] При масштабе > 1 перетаскивание мышью двигает кадр
- [ ] Кадр невозможно утащить так, чтобы у края появилась чёрная полоса
- [ ] Клавиши `+` и `−` меняют масштаб
- [ ] Кнопка с текущим масштабом появляется только при зуме и возвращает к 1×
- [ ] Покадровые стрелки `←` / `→` работают при активном зуме, зум не сбрасывается
- [ ] Перемотка таймлайном при активном зуме не сбрасывает зум
- [ ] Загрузка нового видео сбрасывает зум в 1×
- [ ] Портретное видео (типичная съёмка с телефона) зумится корректно, без смещения
- [ ] **Мобильный режим, 1×:** вертикальный свайп по видео скроллит страницу к карточке результата
- [ ] **Мобильный режим:** двупальцевый жест с 1× приближает, а не запускает нативный зум страницы
- [ ] **Мобильный режим, >1×:** один палец двигает кадр, страница при этом не скроллится
- [ ] Изменение размера окна не ломает зум и не оставляет кадр за границами

- [ ] **Step 6: Коммит**

```bash
git add src/App.vue
git commit -m "Add keyboard zoom controls on desktop"
```

---

## Определение готовности

- `npm test` — 20 тестов проходят
- `npm run build` — без ошибок
- Все пункты ручной проверки из Task 7 отмечены
- `src/lib/zoomMath.ts` не импортирует ни Vue, ни ничего из DOM
