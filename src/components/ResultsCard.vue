<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{
  displayHeight: { value: number | null; unit: string }
  displayError: { value: number | null; unit: string }
  flightTime: number | null
  takeoffFrame: number | null
  landingFrame: number | null
  fps: number
  unit: 'metric' | 'imperial'
}>()

const emit = defineEmits<{
  'toggle-unit': []
  'close': []
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
</script>

<template>
  <div class="relative bg-surface-light rounded-xl p-3 md:p-5 border border-surface-lighter">
    <button
      class="absolute top-2 right-2 p-1 rounded text-slate-500 hover:text-slate-300
             hover:bg-surface-lighter transition-colors"
      title="Hide results"
      @click="emit('close')"
    >
      <X class="w-3.5 h-3.5" />
    </button>
    <div class="flex items-baseline justify-center gap-2 mb-2">
      <p class="text-3xl md:text-5xl font-bold tracking-tight">
        {{ formatHeight(displayHeight.value) }}
        <span
          v-if="displayError.value !== null"
          class="text-base md:text-xl font-normal text-slate-500"
        >{{ formatError(displayError.value) }}</span>
        <span class="text-base md:text-xl font-normal text-slate-400">{{ displayHeight.unit }}</span>
      </p>
      <button
        class="ml-2 px-2 py-0.5 rounded text-xs font-medium
               bg-surface-lighter hover:bg-surface-lighter/80 transition-colors text-slate-400"
        @click="emit('toggle-unit')"
      >
        → {{ unit === 'metric' ? 'in' : 'cm' }}
      </button>
    </div>
    <p
      v-if="flightTime !== null && flightTime > 1"
      class="text-center text-xs text-amber-400 mb-2"
    >
      🌙 Wow — are you jumping on the Moon? That's over 1 s of flight time!
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
