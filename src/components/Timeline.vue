<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowUpFromLine, ArrowDownToLine } from 'lucide-vue-next'

const props = defineProps<{
  duration: number
  currentTime: number
  takeoffTime: number | null
  landingTime: number | null
  videoEl: HTMLVideoElement | null
}>()

const emit = defineEmits<{
  'drag-start': []
  seek: [time: number]
}>()

const trackRef = ref<HTMLDivElement | null>(null)
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)

const isDragging = ref(false)
const previewTime = ref(0)

let activePointerId: number | null = null
let lastClientX = 0
let lastMoveAt = 0
let sensitivity = 1

const FAST_VELOCITY = 0.6 // px/ms — full-speed scrubbing
const SLOW_VELOCITY = 0.05 // px/ms — finest precision
const MIN_SENSITIVITY = 0.08
const MAX_SENSITIVITY = 1

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function velocityToSensitivity(v: number) {
  if (v >= FAST_VELOCITY) return MAX_SENSITIVITY
  if (v <= SLOW_VELOCITY) return MIN_SENSITIVITY
  const t = (v - SLOW_VELOCITY) / (FAST_VELOCITY - SLOW_VELOCITY)
  return MIN_SENSITIVITY + t * (MAX_SENSITIVITY - MIN_SENSITIVITY)
}

const displayTime = computed(() => (isDragging.value ? previewTime.value : props.currentTime))

function timeToPercent(time: number) {
  if (props.duration <= 0) return 0
  return clamp((time / props.duration) * 100, 0, 100)
}

const playheadPercent = computed(() => timeToPercent(displayTime.value))
const takeoffPercent = computed(() =>
  props.takeoffTime !== null ? timeToPercent(props.takeoffTime) : null
)
const landingPercent = computed(() =>
  props.landingTime !== null ? timeToPercent(props.landingTime) : null
)
const bubblePercent = computed(() => clamp(playheadPercent.value, 8, 92))

function formatTime(t: number): string {
  const minutes = Math.floor(t / 60)
  const seconds = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function drawPreviewFrame() {
  const canvas = previewCanvasRef.value
  const video = props.videoEl
  if (!canvas || !video || video.videoWidth === 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const vw = video.videoWidth
  const vh = video.videoHeight
  const size = Math.min(vw, vh)
  const sx = (vw - size) / 2
  const sy = (vh - size) / 2
  ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height)
}

function xToTime(clientX: number): number {
  const rect = trackRef.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return 0
  const x = clamp(clientX - rect.left, 0, rect.width)
  return (x / rect.width) * props.duration
}

function beginDrag(clientX: number, pointerId: number, target: HTMLElement) {
  isDragging.value = true
  activePointerId = pointerId
  lastClientX = clientX
  lastMoveAt = performance.now()
  sensitivity = MAX_SENSITIVITY
  previewTime.value = clamp(xToTime(clientX), 0, props.duration)
  target.setPointerCapture(pointerId)
  emit('drag-start')
  emit('seek', previewTime.value)
  requestAnimationFrame(drawPreviewFrame)
}

function onTrackPointerDown(e: PointerEvent) {
  beginDrag(e.clientX, e.pointerId, e.currentTarget as HTMLElement)
}

function onTrackPointerMove(e: PointerEvent) {
  if (!isDragging.value || e.pointerId !== activePointerId) return

  const now = performance.now()
  const dx = e.clientX - lastClientX
  const dt = now - lastMoveAt
  const velocity = dt > 0 ? Math.abs(dx) / dt : FAST_VELOCITY
  const targetSensitivity = velocityToSensitivity(velocity)
  sensitivity = sensitivity + (targetSensitivity - sensitivity) * 0.3

  const rect = trackRef.value?.getBoundingClientRect()
  if (rect && rect.width > 0 && props.duration > 0) {
    const baseTimePerPixel = props.duration / rect.width
    const deltaTime = dx * baseTimePerPixel * sensitivity
    previewTime.value = clamp(previewTime.value + deltaTime, 0, props.duration)
    emit('seek', previewTime.value)
    requestAnimationFrame(drawPreviewFrame)
  }

  lastClientX = e.clientX
  lastMoveAt = now
}

function endDrag() {
  isDragging.value = false
  activePointerId = null
}

function onTrackPointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return
  endDrag()
}

function onMarkerPointerDown(time: number, e: PointerEvent) {
  e.stopPropagation()
  emit('drag-start')
  emit('seek', time)
}
</script>

<template>
  <div class="relative pt-14 shrink-0">
    <div
      v-if="isDragging"
      class="absolute -top-1 flex flex-col items-center -translate-x-1/2"
      :style="{ left: bubblePercent + '%' }"
    >
      <canvas
        ref="previewCanvasRef"
        width="128"
        height="128"
        class="w-16 h-16 rounded-lg border-2 border-brand bg-surface-light shadow-lg"
      />
      <span class="mt-1 text-[10px] font-mono text-slate-300 bg-surface-light/90 px-1.5 py-0.5 rounded">
        {{ formatTime(displayTime) }}
      </span>
    </div>

    <div
      ref="trackRef"
      class="relative h-11 flex items-center touch-none select-none cursor-pointer"
      @pointerdown="onTrackPointerDown"
      @pointermove="onTrackPointerMove"
      @pointerup="onTrackPointerUp"
      @pointercancel="onTrackPointerUp"
    >
      <div class="absolute inset-x-0 h-1.5 rounded-full bg-surface-lighter top-1/2 -translate-y-1/2" />
      <div
        class="absolute h-1.5 rounded-full bg-brand/70 top-1/2 -translate-y-1/2"
        :style="{ width: playheadPercent + '%' }"
      />

      <button
        v-if="takeoffPercent !== null"
        class="absolute w-5 h-5 -translate-x-1/2 rounded-full bg-takeoff border-2 border-surface
               flex items-center justify-center shadow"
        title="Go to takeoff"
        :style="{ left: takeoffPercent + '%' }"
        @pointerdown="onMarkerPointerDown(takeoffTime!, $event)"
      >
        <ArrowUpFromLine class="w-3 h-3 text-white" />
      </button>

      <button
        v-if="landingPercent !== null"
        class="absolute w-5 h-5 -translate-x-1/2 rounded-full bg-landing border-2 border-surface
               flex items-center justify-center shadow"
        title="Go to landing"
        :style="{ left: landingPercent + '%' }"
        @pointerdown="onMarkerPointerDown(landingTime!, $event)"
      >
        <ArrowDownToLine class="w-3 h-3 text-white" />
      </button>

      <div
        class="absolute w-4 h-4 -translate-x-1/2 rounded-full bg-white border-2 border-brand shadow pointer-events-none"
        :style="{ left: playheadPercent + '%' }"
      />
    </div>
  </div>
</template>
