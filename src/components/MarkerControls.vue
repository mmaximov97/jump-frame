<script setup lang="ts">
import { ArrowUpFromLine, ArrowDownToLine, Check } from 'lucide-vue-next'

defineProps<{
  takeoffSet: boolean
  landingSet: boolean
}>()

const emit = defineEmits<{
  'set-takeoff': []
  'set-landing': []
  'goto-takeoff': []
  'goto-landing': []
}>()
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <div class="flex flex-col gap-1">
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
        v-if="takeoffSet"
        class="min-h-11 flex items-center justify-center text-xs text-slate-400 hover:text-slate-200 transition-colors"
        @click="emit('goto-takeoff')"
      >
        Go to frame
      </button>
    </div>

    <div class="flex flex-col gap-1">
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
      <button
        v-if="landingSet"
        class="min-h-11 flex items-center justify-center text-xs text-slate-400 hover:text-slate-200 transition-colors"
        @click="emit('goto-landing')"
      >
        Go to frame
      </button>
    </div>
  </div>
</template>
