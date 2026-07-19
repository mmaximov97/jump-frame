<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  displayHeight: { value: number | null; unit: string }
  displayError: { value: number | null; unit: string }
  flightTime: number | null
  takeoffFrame: number | null
  landingFrame: number | null
  fps: number
  unit: 'metric' | 'imperial'
  jumpHeightCm: number | null
}>()

const emit = defineEmits<{
  'set-unit': [unit: 'metric' | 'imperial']
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
    <div class="flex items-baseline justify-center gap-2 mb-2">
      <p class="text-3xl md:text-5xl font-bold tracking-tight">
        {{ formatHeight(displayHeight.value) }}
        <span
          v-if="displayError.value !== null"
          class="text-base md:text-xl font-normal text-slate-500"
        >{{ formatError(displayError.value) }}</span>
        <span class="text-base md:text-xl font-normal text-slate-400">{{ displayHeight.unit }}</span>
      </p>
    </div>

    <div class="flex justify-center mb-2">
      <div class="inline-flex rounded-lg bg-surface p-0.5 gap-0.5" role="group" aria-label="Units">
        <button
          type="button"
          class="min-w-8 min-h-8 px-2 rounded-md text-xs transition-colors"
          :class="unit === 'metric'
            ? 'bg-surface-lighter text-slate-100 font-bold'
            : 'text-slate-500 hover:text-slate-300 font-normal'"
          @click="emit('set-unit', 'metric')"
        >
          cm
        </button>
        <button
          type="button"
          class="min-w-8 min-h-8 px-2 rounded-md text-xs transition-colors"
          :class="unit === 'imperial'
            ? 'bg-surface-lighter text-slate-100 font-bold'
            : 'text-slate-500 hover:text-slate-300 font-normal'"
          @click="emit('set-unit', 'imperial')"
        >
          in
        </button>
      </div>
    </div>

    <p v-if="factText" class="text-center text-xs text-slate-400 mb-2">
      {{ factText }}
    </p>

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

    <div class="grid grid-cols-3 gap-2 text-center text-xs">
      <div>
        <p class="text-slate-500">Flight</p>
        <p class="font-mono text-slate-300">{{ formatFlightTime(flightTime) }}</p>
      </div>
      <div>
        <p class="text-slate-500">Frames</p>
        <p class="font-mono text-slate-300">{{ takeoffFrame ?? '—' }}→{{ landingFrame ?? '—' }}</p>
      </div>
      <div>
        <p class="text-slate-500">FPS</p>
        <p class="font-mono text-slate-300">{{ fps }}</p>
      </div>
    </div>
  </div>
</template>
