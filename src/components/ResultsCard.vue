<script setup lang="ts">
import { computed } from 'vue'
import { Share2, Trophy } from 'lucide-vue-next'
import type { JumpAnalysis, Verdict } from '../lib/jumpFromCom'
import type { LandmarkScatter } from '../lib/landmarkScatter'

const props = defineProps<{
  displayHeight: { value: number | null; unit: string }
  displayError: { value: number | null; unit: string }
  flightTime: number | null
  takeoffFrame: number | null
  landingFrame: number | null
  fps: number
  unit: 'metric' | 'imperial'
  jumpHeightCm: number | null
  newRecordDelta: { value: number; unit: string } | null
  autoDetect: {
    analysis: JumpAnalysis
    verdict: Verdict
    scatter: LandmarkScatter | null
    framesParsed: number
  } | null
}>()

const emit = defineEmits<{
  'set-unit': [unit: 'metric' | 'imperial']
  'share': []
}>()

function formatHeight(value: number | null): string {
  if (value === null) return '—'
  return value.toFixed(1)
}

function formatFlightTime(t: number | null): string {
  if (t === null) return '—'
  return t.toFixed(3) + ' s'
}

function formatError(value: number | null): string {
  if (value === null) return ''
  return '± ' + value.toFixed(1)
}

function formatDelta(value: number): string {
  return '+' + value.toFixed(1)
}

// Flight time above this is physically implausible for a normal jump —
// almost always slow-motion footage or a mis-marked takeoff/landing frame.
const SLOWMO_THRESHOLD_SECONDS = 0.9

const isImplausible = computed(
  () => props.flightTime !== null && props.flightTime > SLOWMO_THRESHOLD_SECONDS
)

const FACT_TIERS: { min: number; max: number; text: string }[] = [
  { min: 25, max: 45, text: "Solid liftoff! That's a totally respectable adult vertical jump. Keep stacking reps!" },
  { min: 45, max: 65, text: "Nice hops! You're jumping above average for an adult vertical — respect." },
  { min: 65, max: 99, text: "NBA-average air (~71 cm) — you're jumping with the pros!" },
]

const factText = computed(() => {
  if (isImplausible.value || props.jumpHeightCm === null) return null
  const h = props.jumpHeightCm
  return FACT_TIERS.find((t) => h >= t.min && h < t.max)?.text ?? null
})
</script>

<template>
  <div class="relative bg-surface-light rounded-xl p-3 md:p-5 border border-surface-lighter">
    <div
      v-if="newRecordDelta"
      class="flex items-center justify-center gap-1.5 mb-2 py-1.5 rounded-lg
             bg-record/15 border border-record/40 text-record-light text-xs md:text-sm font-medium"
    >
      <Trophy class="w-4 h-4 shrink-0" />
      <span>New record! {{ formatDelta(newRecordDelta.value) }} {{ newRecordDelta.unit }} to your previous best</span>
    </div>

    <!-- 1. Result — the hero metric -->
    <div class="flex items-baseline justify-center gap-2 mb-1">
      <p class="text-3xl md:text-5xl font-bold tracking-tight">
        {{ formatHeight(displayHeight.value) }}
        <span
          v-if="displayError.value !== null"
          class="text-base md:text-xl font-normal text-slate-500"
        >{{ formatError(displayError.value) }}</span>
        <span class="text-base md:text-xl font-normal text-slate-400">{{ displayHeight.unit }}</span>
      </p>
    </div>

    <!-- 2. Flight time — second most important metric, no label (the "s" already reads as time) -->
    <p class="text-center text-lg md:text-xl font-semibold text-slate-300 mb-2">
      {{ formatFlightTime(flightTime) }}
    </p>

    <!-- Auto-detect's own estimate, shown as an independent cross-check -->
    <p v-if="autoDetect" class="text-center text-xs text-slate-500 mb-2">
      центр масс: {{ formatHeight(autoDetect.analysis.comHeightCm) }} см
    </p>

    <!-- 3. Fun fact — boxed callout, distinct from plain-text warnings below -->
    <div v-if="factText" class="flex justify-center mb-2">
      <p class="inline-block px-3 py-1.5 rounded-lg border border-brand/30 bg-brand/10 text-xs text-slate-200 text-center">
        {{ factText }}
      </p>
    </div>

    <p v-if="isImplausible" class="text-center text-xs text-amber-400 mb-2">
      🌙 Wow, are you jumping on the Moon? {{ formatHeight(displayHeight.value) }}{{ displayHeight.unit }}
      beats every record on Earth — double-check your takeoff/landing frames, or re-film if this was
      slow-mo. (How to measure correctly →)
    </p>

    <p
      v-if="fps <= 30"
      class="text-center text-xs text-orange-400/80 mb-2"
    >
      ⚠ Low FPS ({{ fps }}) — accuracy is rough. Use 120+ FPS video for reliable results.
    </p>

    <p
      v-if="autoDetect && 'message' in autoDetect.verdict"
      class="text-center text-xs mb-2"
      :class="autoDetect.verdict.kind === 'unusable' ? 'text-rose-400' : 'text-amber-400'"
    >
      ⚠ {{ autoDetect.verdict.message }}
    </p>

    <!-- 4. Secondary data — de-emphasized, smallest tier -->
    <div class="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-surface-lighter/60">
      <div>
        <p class="text-slate-500">Frames</p>
        <p class="font-mono text-slate-300">{{ takeoffFrame ?? '—' }}→{{ landingFrame ?? '—' }}</p>
      </div>
      <div>
        <p class="text-slate-500">FPS</p>
        <p class="font-mono text-slate-300">{{ fps }}</p>
      </div>
      <div class="flex items-center justify-center">
        <div class="inline-flex rounded-md bg-surface p-0.5 gap-0.5" role="group" aria-label="Units">
          <button
            type="button"
            class="min-w-8 min-h-8 px-1.5 rounded text-[11px] transition-colors"
            :class="unit === 'metric'
              ? 'bg-surface-lighter text-slate-100 font-bold'
              : 'text-slate-500 hover:text-slate-300 font-normal'"
            @click="emit('set-unit', 'metric')"
          >
            cm
          </button>
          <button
            type="button"
            class="min-w-8 min-h-8 px-1.5 rounded text-[11px] transition-colors"
            :class="unit === 'imperial'
              ? 'bg-surface-lighter text-slate-100 font-bold'
              : 'text-slate-500 hover:text-slate-300 font-normal'"
            @click="emit('set-unit', 'imperial')"
          >
            in
          </button>
        </div>
      </div>
    </div>

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

    <!-- 5. Share -->
    <button
      class="w-full min-h-11 mt-3 rounded-lg font-medium flex items-center justify-center gap-2
             bg-brand text-white hover:bg-brand-light transition-colors"
      @click="emit('share')"
    >
      <Share2 class="w-4 h-4" />
      <span>Share</span>
    </button>
  </div>
</template>
