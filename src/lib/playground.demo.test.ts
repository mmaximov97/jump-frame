/**
 * A hand-run playground for the centre-of-mass pipeline.
 *
 * Run it with `npm run demo`. It is deliberately excluded from `npm test`
 * (see `test.exclude` in vite.config.ts) because it asserts nothing — it
 * prints. Its job is to let a human see what the maths does on jumps whose
 * true height is known exactly, which is the only way to look at this code
 * before PR-C gives it a user interface.
 *
 * Edit the SCENARIOS arrays below and re-run. Every option of `generateJump`
 * is fair game: jumpHeightM, fps, scalePxPerM, statureM, tuckM, noiseSigma,
 * timeScale, takeoffPhase, seed.
 */
import { it } from 'vitest'
import { measureJump } from './jumpFromCom'
import { generateJump, type JumpOptions } from './testing/syntheticJumper'
import { LANDMARK_COUNT, type PoseFrame } from './poseTypes'

const VIDEO = { width: 720, height: 1280 }

/** The reference clip: a 50 cm jump, 60 fps, 400 px per metre, no noise. */
const BASE: JumpOptions = {
  jumpHeightM: 0.5,
  scalePxPerM: 400,
  fps: 60,
  videoWidth: VIDEO.width,
  videoHeight: VIDEO.height,
}

// ─── edit me ────────────────────────────────────────────────────────────────

const ACCURACY: Array<[string, JumpOptions]> = [
  ['20 см, 60 fps', { ...BASE, jumpHeightM: 0.2 }],
  ['50 см, 60 fps', { ...BASE }],
  ['90 см, 60 fps', { ...BASE, jumpHeightM: 0.9 }],
  ['50 см, 30 fps', { ...BASE, fps: 30 }],
  ['50 см, 120 fps', { ...BASE, fps: 120 }],
  ['50 см, 240 fps', { ...BASE, fps: 240 }],
]

const REALISM: Array<[string, JumpOptions]> = [
  ['поджатие ног 0.25 м', { ...BASE, tuckM: 0.25 }],
  ['шум разметки σ=0.005', { ...BASE, noiseSigma: 0.005, seed: 2 }],
  ['шум разметки σ=0.01', { ...BASE, noiseSigma: 0.01, seed: 2 }],
  ['низкий человек, 1.55 м', { ...BASE, statureM: 1.55 }],
  ['высокий человек, 2.05 м', { ...BASE, statureM: 2.05 }],
]

const FAILURES: Array<[string, JumpOptions]> = [
  ['замедление ×2 (120→60)', { ...BASE, timeScale: 2 }],
  ['замедление ×8 (240→30)', { ...BASE, timeScale: 8 }],
  ['прыжок 3 см, 24 fps, шум', { ...BASE, jumpHeightM: 0.03, fps: 24, noiseSigma: 0.008 }],
]

// ────────────────────────────────────────────────────────────────────────────

const COLS = [34, 12, 12, 10, 11, 16] as const
const HEAD = ['сценарий', 'истина', 'измерено', 'Δ', 'вердикт', 'причина']

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + ' ' : s.padEnd(n)
}

function num(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '—'
}

function line(cells: string[]): string {
  return '  ' + cells.map((c, i) => pad(c, COLS[i] ?? 12)).join('')
}

function report(label: string, options: JumpOptions): void {
  const clip = generateJump(options)
  const { analysis, verdict } = measureJump(clip.frames, VIDEO)
  const truthCm = clip.truth.jumpHeightM * 100
  // Under slow motion the generated height is not what a correct pipeline
  // should report — the clip's own timebase is wrong — so no delta is shown.
  const comparable = (options.timeScale ?? 1) === 1

  const measured = analysis ? num(analysis.comHeightCm) + ' см' : '—'
  const delta = analysis && comparable
    ? (analysis.comHeightCm - truthCm >= 0 ? '+' : '') + num(analysis.comHeightCm - truthCm)
    : '—'

  console.log(line([
    label,
    comparable ? num(truthCm) + ' см' : '—',
    measured,
    delta,
    verdict.kind,
    'reason' in verdict ? verdict.reason : '',
  ]) + (analysis ? `рост ${num(analysis.statureM)} м, масштаб ${num(analysis.scalePxPerM, 1)} px/м` : ''))
}

function section(title: string, rows: Array<[string, JumpOptions]>): void {
  console.log(`\n══ ${title} ══\n`)
  console.log(line(HEAD))
  for (const [label, options] of rows) report(label, options)
}

it('playground', () => {
  section('Точность: конвейер против известной высоты', ACCURACY)
  section('Ближе к жизни', REALISM)
  section('Отказы, которые обязаны распознаваться', FAILURES)

  console.log('\n══ Вход, на котором пайплайн не должен падать ══\n')
  console.log(line(HEAD))

  const still: PoseFrame[] = Array.from({ length: 40 }, (_, i) => ({
    time: i / 60,
    landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5 })),
  }))
  const noPose: PoseFrame[] = Array.from({ length: 40 }, (_, i) => ({
    time: i / 60,
    landmarks: [],
  }))
  for (const [label, frames] of [
    ['человек стоит, не прыгает', still],
    ['MediaPipe не нашёл позу', noPose],
    ['пустой клип', [] as PoseFrame[]],
  ] as const) {
    const { verdict } = measureJump(frames, VIDEO)
    console.log(line([label, '—', '—', '—', verdict.kind, 'reason' in verdict ? verdict.reason : '']))
  }

  console.log('\n══ Что увидит пользователь ══\n')
  for (const [label, options] of [
    ['обычный прыжок', BASE],
    ['слабый трекинг', { ...BASE, noiseSigma: 0.02, seed: 9 }],
    ['замедленная съёмка', { ...BASE, timeScale: 4 }],
  ] as Array<[string, JumpOptions]>) {
    const { analysis, verdict } = measureJump(generateJump(options).frames, VIDEO)
    const shown = verdict.kind === 'unusable'
      ? '(число не показывается)'
      : num(verdict.heightCm) + ' см'
    console.log(`  ${pad(label, 24)}${pad(shown, 28)}${'message' in verdict ? '«' + verdict.message + '»' : ''}`)
    if (analysis) {
      console.log(`  ${pad('', 24)}R² ${num(analysis.rSquared, 4)}, кадров в полёте ${analysis.flightFrames}`)
    }
  }
  console.log('')
})
