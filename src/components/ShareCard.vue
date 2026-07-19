<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { ArrowLeft, ChevronLeft, ChevronRight, Share2, Download, Loader2 } from 'lucide-vue-next'
import { useShareCard, type ShareFormat } from '../composables/useShareCard'

const props = defineProps<{
  videoSrc: string
  takeoffFrame: number
  landingFrame: number
  fps: number
  displayHeight: { value: number | null; unit: string }
  flightTime: number | null
}>()

const emit = defineEmits<{
  back: []
}>()

const {
  CARD_WIDTH,
  CARD_HEIGHT,
  isLoading,
  loadError,
  candidates,
  selectedIndex,
  format,
  canShareFiles,
  extractFrames,
  renderCard,
  shareOrDownload,
} = useShareCard()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isGenerating = ref(false)

const heightLabel = computed(() => {
  if (props.displayHeight.value === null) return '—'
  return `${props.displayHeight.value.toFixed(0)} ${props.displayHeight.unit}`
})

const flightLabel = computed(() => (props.flightTime !== null ? `${props.flightTime.toFixed(3)} s` : '—'))

const dateLabel = computed(() =>
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
)

const formats: { key: ShareFormat; label: string }[] = [
  { key: 'scale', label: 'Scale' },
  { key: 'photo', label: 'Photo' },
  { key: 'stats', label: 'Stats' },
]

function draw() {
  const canvas = canvasRef.value
  const frame = candidates.value[selectedIndex.value]
  if (!canvas || !frame) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  renderCard(ctx, frame, format.value, heightLabel.value, flightLabel.value, dateLabel.value)
}

watch([selectedIndex, format, candidates], () => nextTick(draw))

onMounted(async () => {
  await extractFrames(props.videoSrc, props.takeoffFrame, props.landingFrame, props.fps)
  await nextTick()
  draw()
})

function goPrev() {
  if (selectedIndex.value > 0) selectedIndex.value--
}

function goNext() {
  if (selectedIndex.value < candidates.value.length - 1) selectedIndex.value++
}

let touchStartX = 0

function onPointerDown(e: PointerEvent) {
  touchStartX = e.clientX
}

function onPointerUp(e: PointerEvent) {
  const delta = e.clientX - touchStartX
  if (Math.abs(delta) < 40) return
  if (delta > 0) goPrev()
  else goNext()
}

const exportError = ref(false)

async function handleAction() {
  const canvas = canvasRef.value
  if (!canvas) return
  isGenerating.value = true
  exportError.value = false
  try {
    const value = props.displayHeight.value !== null ? Math.round(props.displayHeight.value) : 'jump'
    await shareOrDownload(canvas, `framejump-${value}${props.displayHeight.unit}.png`)
  } catch {
    exportError.value = true
  } finally {
    isGenerating.value = false
  }
}

function retryExtraction() {
  extractFrames(props.videoSrc, props.takeoffFrame, props.landingFrame, props.fps).then(() => {
    nextTick(draw)
  })
}
</script>

<template>
  <div class="min-h-screen px-4 py-6 md:py-10">
    <div class="max-w-md mx-auto">
      <button
        class="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-6"
        @click="emit('back')"
      >
        <ArrowLeft class="w-4 h-4" />
        Back
      </button>

      <h1 class="text-2xl font-bold tracking-tight mb-6 text-center">Share your jump</h1>

      <!-- Preview -->
      <div class="flex items-center justify-center gap-2 mb-3">
        <button
          class="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-slate-400
                 hover:text-slate-100 hover:bg-surface-light transition-colors disabled:opacity-30 disabled:pointer-events-none"
          :disabled="isLoading || !!loadError || selectedIndex <= 0"
          aria-label="Previous frame"
          @click="goPrev"
        >
          <ChevronLeft class="w-6 h-6" />
        </button>

        <div
          class="relative w-full max-w-[320px] rounded-xl overflow-hidden bg-surface-light border border-surface-lighter select-none"
          style="aspect-ratio: 9 / 16"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
        >
          <canvas
            ref="canvasRef"
            :width="CARD_WIDTH"
            :height="CARD_HEIGHT"
            class="w-full h-full object-cover"
            :class="{ 'opacity-0': isLoading || loadError }"
          />

          <div v-if="isLoading" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
            <Loader2 class="w-6 h-6 animate-spin" />
            <p class="text-xs">Preparing frames…</p>
          </div>

          <div v-else-if="loadError" class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
            <p class="text-sm text-slate-300">Couldn't generate the image.</p>
            <button
              class="min-h-11 px-4 rounded-lg text-sm font-medium bg-surface-lighter hover:bg-surface-lighter/80 transition-colors"
              @click="retryExtraction"
            >
              Try again
            </button>
          </div>
        </div>

        <button
          class="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-slate-400
                 hover:text-slate-100 hover:bg-surface-light transition-colors disabled:opacity-30 disabled:pointer-events-none"
          :disabled="isLoading || !!loadError || selectedIndex >= candidates.length - 1"
          aria-label="Next frame"
          @click="goNext"
        >
          <ChevronRight class="w-6 h-6" />
        </button>
      </div>

      <!-- Frame position dots -->
      <div v-if="!isLoading && !loadError" class="flex items-center justify-center gap-1.5 mb-6">
        <span
          v-for="(c, i) in candidates"
          :key="c.frameIndex"
          class="w-1.5 h-1.5 rounded-full transition-colors"
          :class="i === selectedIndex ? 'bg-brand-light' : 'bg-surface-lighter'"
        />
      </div>
      <div v-else class="h-6 mb-6" />

      <!-- Format picker -->
      <div class="grid grid-cols-3 gap-2 mb-6">
        <button
          v-for="f in formats"
          :key="f.key"
          class="min-h-11 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none"
          :class="format === f.key
            ? 'bg-brand text-white border-brand'
            : 'bg-surface-light text-slate-400 border-surface-lighter hover:text-slate-200'"
          :disabled="isLoading || !!loadError"
          @click="format = f.key"
        >
          {{ f.label }}
        </button>
      </div>

      <!-- Action -->
      <button
        class="w-full min-h-11 rounded-lg font-medium flex items-center justify-center gap-2
               bg-brand/15 text-brand-light border border-brand/40 hover:bg-brand/25 transition-colors
               disabled:opacity-40 disabled:pointer-events-none"
        :disabled="isLoading || !!loadError || isGenerating"
        @click="handleAction"
      >
        <Loader2 v-if="isGenerating" class="w-4 h-4 animate-spin" />
        <template v-else>
          <Share2 v-if="canShareFiles" class="w-4 h-4" />
          <Download v-else class="w-4 h-4" />
        </template>
        <span>{{ isGenerating ? 'Preparing…' : (canShareFiles ? 'Share' : 'Download') }}</span>
      </button>
    </div>
  </div>
</template>
