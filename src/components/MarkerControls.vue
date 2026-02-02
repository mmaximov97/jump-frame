<script setup lang="ts">
defineProps<{
  takeoffFrame: number | null
  landingFrame: number | null
  hasAnyMarker: boolean
}>()

const emit = defineEmits<{
  'set-takeoff': []
  'set-landing': []
  'clear-markers': []
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <button
      class="px-2.5 py-1.5 rounded-lg font-medium transition-colors text-xs
             bg-takeoff/15 text-takeoff-light border border-takeoff/30 hover:bg-takeoff/25"
      @click="emit('set-takeoff')"
    >
      Takeoff
      <span v-if="takeoffFrame !== null" class="ml-1 opacity-75">#{{ takeoffFrame }}</span>
    </button>
    <button
      class="px-2.5 py-1.5 rounded-lg font-medium transition-colors text-xs
             bg-landing/15 text-landing-light border border-landing/30 hover:bg-landing/25"
      @click="emit('set-landing')"
    >
      Landing
      <span v-if="landingFrame !== null" class="ml-1 opacity-75">#{{ landingFrame }}</span>
    </button>
    <button
      v-if="hasAnyMarker"
      class="px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200
             bg-surface-light hover:bg-surface-lighter transition-colors"
      @click="emit('clear-markers')"
    >
      Clear
    </button>
  </div>
</template>
