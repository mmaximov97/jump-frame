<script setup lang="ts">
import { computed } from 'vue'
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  isPlaying: boolean
  currentTime: number
  currentFrame: number
}>()

const emit = defineEmits<{
  'toggle-play': []
  'step-forward-hold': []
  'step-backward-hold': []
  'step-stop': []
}>()

const timeDisplay = computed(() => {
  const t = props.currentTime
  const minutes = Math.floor(t / 60)
  const seconds = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
})
</script>

<template>
  <div class="shrink-0 flex flex-col items-center gap-1.5 py-1.5">
    <div class="w-full flex items-stretch gap-2">
      <button
        class="flex-1 min-h-14 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5
               bg-surface-light hover:bg-surface-lighter"
        title="Step backward (hold to repeat)"
        @pointerdown="emit('step-backward-hold')"
        @pointerup="emit('step-stop')"
        @pointerleave="emit('step-stop')"
        @pointercancel="emit('step-stop')"
      >
        <ChevronLeft class="w-4 h-4 shrink-0" />
        <span>Back</span>
      </button>
      <button
        class="w-14 h-14 shrink-0 rounded-lg bg-brand hover:bg-brand-light transition-colors text-white
               flex items-center justify-center"
        :title="isPlaying ? 'Pause' : 'Play'"
        @click="emit('toggle-play')"
      >
        <Pause v-if="isPlaying" class="w-5 h-5" />
        <Play v-else class="w-5 h-5" />
      </button>
      <button
        class="flex-1 min-h-14 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5
               bg-surface-light hover:bg-surface-lighter"
        title="Step forward (hold to repeat)"
        @pointerdown="emit('step-forward-hold')"
        @pointerup="emit('step-stop')"
        @pointerleave="emit('step-stop')"
        @pointercancel="emit('step-stop')"
      >
        <span>Next</span>
        <ChevronRight class="w-4 h-4 shrink-0" />
      </button>
    </div>

    <div class="text-xs font-mono text-slate-400">
      <span>{{ timeDisplay }}</span>
      <span class="mx-1.5 text-surface-lighter">|</span>
      <span>F{{ currentFrame }}</span>
    </div>
  </div>
</template>
