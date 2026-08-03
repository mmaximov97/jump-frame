<script setup lang="ts">
import { provide, ref, watch } from 'vue'
import { Minimize2 } from 'lucide-vue-next'
import { useVideoZoom } from '../composables/useVideoZoom'
import { ZOOM_CONTEXT } from '../composables/zoomContext'

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
  onPointerCancel,
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

provide(ZOOM_CONTEXT, { project })

// zoomIn/zoomOut stay exposed: App.vue drives them from its keyboard handler,
// which is a parent reaching into its own direct child. Only `project` moved
// to provide/inject, because its consumer is a sibling mounted in the slot.
defineExpose({ zoomIn, zoomOut, resetZoom: reset, isZoomed })
</script>

<template>
  <div
    ref="containerRef"
    class="relative flex-1 min-h-[180px] rounded-xl overflow-hidden bg-black flex items-center justify-center"
    :style="{ touchAction }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
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
      :aria-label="`Reset zoom (currently ${scale.toFixed(2)}×)`"
      @click="reset"
    >
      <Minimize2 class="w-4 h-4" />
      <span>{{ scale.toFixed(2) }}×</span>
    </button>
  </div>
</template>
