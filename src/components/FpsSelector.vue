<script setup lang="ts">
import { ScanSearch } from 'lucide-vue-next'

defineProps<{
  fps: number
  detectedFps: number | null
  isDetecting: boolean
}>()
</script>

<template>
  <div class="flex items-center gap-2 text-sm text-slate-400">
    <ScanSearch class="w-4 h-4" />
    <span v-if="isDetecting" class="animate-pulse">Detecting FPS&hellip;</span>
    <template v-else-if="detectedFps">
      <span>Detected <br><strong class="text-white">{{ detectedFps }} FPS</strong></span>
    </template>
    <span v-else>{{ fps }} FPS</span>
  </div>
</template>
