<script setup lang="ts">
import { ArrowUpFromLine, ArrowDownToLine, Check } from 'lucide-vue-next'

defineProps<{
  takeoffSet: boolean
  landingSet: boolean
  hasAnyMarker: boolean
}>()

const emit = defineEmits<{
  'set-takeoff': []
  'set-landing': []
  'clear-markers': []
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="grid grid-cols-2 gap-2">
      <button
        class="min-h-14 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 border"
        :class="
          takeoffSet
            ? 'bg-takeoff/25 text-takeoff-light border-takeoff/50'
            : 'bg-takeoff/10 text-takeoff-light border-takeoff/30 hover:bg-takeoff/20'
        "
        @click="emit('set-takeoff')"
      >
        <ArrowUpFromLine class="w-5 h-5 shrink-0" />
        <span>Takeoff</span>
        <Check v-if="takeoffSet" class="w-4 h-4 shrink-0" />
      </button>

      <button
        class="min-h-14 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 border"
        :class="
          landingSet
            ? 'bg-landing/25 text-landing-light border-landing/50'
            : 'bg-landing/10 text-landing-light border-landing/30 hover:bg-landing/20'
        "
        @click="emit('set-landing')"
      >
        <ArrowDownToLine class="w-5 h-5 shrink-0" />
        <span>Landing</span>
        <Check v-if="landingSet" class="w-4 h-4 shrink-0" />
      </button>
    </div>

    <button
      v-if="hasAnyMarker"
      class="min-h-11 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200
             bg-surface-light hover:bg-surface-lighter border border-surface-lighter transition-colors"
      @click="emit('clear-markers')"
    >
      Clear
    </button>
  </div>
</template>
