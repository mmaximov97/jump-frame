<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ArrowLeft, CircleQuestionMark } from 'lucide-vue-next'
import { useVideoPlayer } from './composables/useVideoPlayer'
import { cmToUnit, unitLabel } from './composables/useJumpCalculation'
import { useMeasurement } from './composables/useMeasurement'
import { useJumpHistory } from './composables/useJumpHistory'
import { captureFrameThumbnail } from './composables/captureFrameThumbnail'
import VideoUpload from './components/VideoUpload.vue'
import VideoPlayer from './components/VideoPlayer.vue'
import PoseOverlay from './components/PoseOverlay.vue'
import Timeline from './components/Timeline.vue'
import FrameControls from './components/FrameControls.vue'
import MarkerControls from './components/MarkerControls.vue'
import ResultsCard from './components/ResultsCard.vue'
import HistoryList from './components/HistoryList.vue'
import TheoryPage from './components/TheoryPage.vue'
import MeasureGuide from './components/MeasureGuide.vue'
import ShareCard from './components/ShareCard.vue'

const showTheory = ref(false)
const showGuide = ref(false)
const showShareCard = ref(false)

const desktopQuery = window.matchMedia('(min-width: 768px)')
const isDesktop = ref(desktopQuery.matches)
function onDesktopQueryChange(e: MediaQueryListEvent) {
  isDesktop.value = e.matches
}

const {
  videoRef,
  videoSrc,
  isPlaying,
  currentTime,
  duration,
  isVideoLoaded,
  loadVideo,
  pause,
  togglePlayPause,
  seekTo,
} = useVideoPlayer()

const {
  fps,
  currentFrame,
  startStepForwardHold,
  startStepBackwardHold,
  stopHold,
  stepForward,
  stepBackward,
  takeoffTime,
  landingTime,
  hasValidMarkers,
  setTakeoff,
  setLanding,
  clearMarkers,
  unit,
  takeoffFrame,
  landingFrame,
  flightTimeSeconds,
  jumpHeightCm,
  displayHeight,
  displayError,
  setUnit,
  pose,
  analysis,
  canShowHeight,
  replay,
  hasAnyMarker,
  autoDetectInfo,
} = useMeasurement(videoRef, isVideoLoaded, currentTime, duration, pause)

const resultsAnchor = ref<HTMLElement | null>(null)
const videoPlayer = ref<InstanceType<typeof VideoPlayer> | null>(null)

watch(hasValidMarkers, (valid) => {
  if (!valid) return
  nextTick(() => {
    resultsAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
})

const history = useJumpHistory()

// Mirrors the "is this jump implausibly slow-motion" threshold ResultsCard
// already uses for its own Moon-jump warning, so the ⚠ in history means
// the same thing as the ⚠ the user saw at measurement time.
const SLOW_MO_WARNING_SECONDS = 1

const newRecordDelta = computed(() => {
  const current = jumpHeightCm.value
  const previous = history.previousBestHeightCm.value
  if (current === null || previous === null || current <= previous) return null
  return { value: cmToUnit(current - previous, unit.value), unit: unitLabel(unit.value) }
})

async function saveDraft(heightCm: number, flightTime: number) {
  const tf = takeoffFrame.value
  const lf = landingFrame.value
  const currentFps = fps.value
  let thumbnail: string | null = null
  if (videoRef.value && tf !== null && lf !== null && currentFps > 0) {
    const midpointTime = (tf + lf) / 2 / currentFps
    thumbnail = await captureFrameThumbnail(videoRef.value, midpointTime)
  }
  history.upsertDraft({
    heightCm,
    flightTimeSeconds: flightTime,
    fps: currentFps,
    thumbnail,
    slowMoWarning: flightTime > SLOW_MO_WARNING_SECONDS,
  })
}

watch(
  () =>
    hasValidMarkers.value
      ? { heightCm: jumpHeightCm.value, flightTime: flightTimeSeconds.value }
      : null,
  (result) => {
    if (!result || result.heightCm === null || result.flightTime === null) return
    saveDraft(result.heightCm, result.flightTime)
  }
)

function onFileSelected(file: File) {
  history.finalizeDraft()
  clearMarkers()
  loadVideo(file)
}

function startNewVideo() {
  replay.stop()
  history.finalizeDraft()
  // usePoseDetection aborts a scan of the outgoing video on its own (it
  // watches videoRef), but it deliberately never moves `status` off
  // 'loading'/'scanning' by itself on a video swap — only a fresh run() or
  // an explicit cancel() does that. Without this, clearing videoSrc mid-scan
  // would leave the progress bar spinning forever.
  pose.cancel()
  videoSrc.value = ''
  clearMarkers()
}

function setVideoRef(el: HTMLVideoElement | null) {
  videoRef.value = el
}

function openGuide() {
  pause()
  showGuide.value = true
}

function openShareCard() {
  pause()
  showShareCard.value = true
}

function onTimelineSeek(time: number) {
  replay.stop()
  seekTo(time)
}

function onKeydown(e: KeyboardEvent) {
  if (!isVideoLoaded.value || showShareCard.value) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    replay.stop()
    stepBackward()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    replay.stop()
    stepForward()
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    videoPlayer.value?.zoomIn()
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    videoPlayer.value?.zoomOut()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  desktopQuery.addEventListener('change', onDesktopQueryChange)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  desktopQuery.removeEventListener('change', onDesktopQueryChange)
})
</script>

<template>
  <!-- Share card -->
  <ShareCard
    v-if="showShareCard && takeoffFrame !== null && landingFrame !== null"
    :video-src="videoSrc"
    :takeoff-frame="takeoffFrame"
    :landing-frame="landingFrame"
    :fps="fps"
    :display-height="displayHeight"
    :flight-time="flightTimeSeconds"
    :jump-height-cm="jumpHeightCm"
    @back="showShareCard = false"
  />

  <!-- Measure guide -->
  <MeasureGuide v-else-if="showGuide" @back="showGuide = false" />

  <!-- Theory page -->
  <TheoryPage v-else-if="showTheory" @back="showTheory = false" />

  <!-- Upload screen -->
  <div v-else-if="!videoSrc" class="min-h-screen px-4 py-6 md:py-10">
    <div class="max-w-4xl mx-auto">
      <header class="mb-8 text-center">
        <h1 class="text-2xl font-bold tracking-tight">FrameJump</h1>
        <p class="text-sm text-slate-400 mt-1">Measure vertical jump height from video</p>
      </header>
      <VideoUpload @file-selected="onFileSelected" />
      <p class="text-center mt-6">
        <button
          class="text-sm text-slate-500 hover:text-brand-light transition-colors"
          @click="showTheory = true"
        >
          How does it work? &rarr;
        </button>
      </p>

      <div v-if="history.entries.value.length > 0" class="mt-12 pt-6 border-t border-surface-lighter">
        <HistoryList
          :entries="history.entries.value"
          :personal-record="history.personalRecord.value"
          :unit="unit"
          @delete-entry="history.deleteEntry"
        />
      </div>
    </div>
  </div>

  <!-- Player screen -->
  <div v-else class="flex flex-col">
    <!-- Above the fold: video, timeline, playback controls, Takeoff/Landing — always fits one screen -->
    <div class="h-dvh flex flex-col px-3 pt-2 pb-4 md:px-4 md:py-4">
      <header class="flex items-center justify-between mb-2 shrink-0">
        <div class="flex items-center gap-1 -ml-2">
          <button
            class="w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
            title="New video"
            aria-label="New video"
            @click="startNewVideo"
          >
            <ArrowLeft class="w-4 h-4" />
          </button>
          <h1 class="text-sm font-bold tracking-tight md:text-xl">FrameJump</h1>
        </div>
        <button
          class="flex items-center gap-1 min-h-11 px-2 -mr-2 rounded-lg text-xs text-slate-500 hover:text-brand-light transition-colors md:text-sm"
          @click="openGuide"
        >
          <CircleQuestionMark class="w-3.5 h-3.5 shrink-0" />
          <span>How to measure</span>
        </button>
      </header>

      <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-3">
        <!-- Video + playback controls -->
        <div class="flex-1 min-h-0 flex flex-col">
          <VideoPlayer ref="videoPlayer" :src="videoSrc" @video-ref="setVideoRef">
            <template #overlay>
              <PoseOverlay
                :frames="pose.frames.value"
                :analysis="analysis"
                :video-size="{ width: videoRef?.videoWidth ?? 0, height: videoRef?.videoHeight ?? 0 }"
                :video-el="videoRef"
                :fps="fps"
                :show-height="canShowHeight"
              />
            </template>
          </VideoPlayer>
          <Timeline
            v-if="isVideoLoaded"
            :duration="duration"
            :current-time="currentTime"
            :takeoff-time="takeoffTime"
            :landing-time="landingTime"
            :video-el="videoRef"
            @drag-start="replay.stop(); pause()"
            @seek="onTimelineSeek"
          />
          <FrameControls
            v-if="isVideoLoaded"
            :is-playing="isPlaying"
            :current-time="currentTime"
            :current-frame="currentFrame"
            @toggle-play="replay.stop(); togglePlayPause()"
            @step-forward-hold="replay.stop(); startStepForwardHold()"
            @step-backward-hold="replay.stop(); startStepBackwardHold()"
            @step-stop="stopHold"
          />
        </div>

        <!-- Side panel -->
        <div v-if="isVideoLoaded" class="shrink-0 md:w-72 flex flex-col gap-3">
          <MarkerControls
            :takeoff-set="takeoffTime !== null"
            :landing-set="landingTime !== null"
            :has-any-marker="hasAnyMarker"
            :show-clear="isDesktop"
            @set-takeoff="replay.stop(); setTakeoff(currentTime)"
            @set-landing="replay.stop(); setLanding(currentTime)"
            @clear-markers="replay.stop(); clearMarkers()"
          />

          <div class="rounded-xl border border-surface-lighter bg-surface-light p-3 text-xs">
            <button
              v-if="pose.status.value !== 'scanning' && pose.status.value !== 'loading'"
              class="w-full min-h-11 rounded-lg bg-brand text-sm font-medium text-white
                     hover:brightness-110 transition"
              @click="pose.run()"
            >
              Найти прыжок автоматически
            </button>

            <div v-else class="space-y-2">
              <p class="text-slate-400">
                {{ pose.status.value === 'loading' ? 'Загружаем модель (~8 МБ)…' : 'Разбираем кадры…' }}
              </p>
              <div class="h-1.5 rounded-full bg-surface-lighter overflow-hidden">
                <div class="h-full bg-brand transition-all"
                     :style="{ width: (pose.progress.value * 100).toFixed(0) + '%' }" />
              </div>
              <button class="w-full min-h-11 rounded-lg border border-surface-lighter text-slate-400"
                      @click="pose.cancel()">
                Отмена
              </button>
            </div>

            <p v-if="pose.error.value" class="mt-2 text-rose-400">{{ pose.error.value }}</p>
            <p v-if="pose.status.value === 'cancelled'" class="mt-2 text-slate-500">Отменено</p>

            <p
              v-if="pose.result.value && !pose.result.value.analysis && 'message' in pose.result.value.verdict"
              class="mt-2 text-slate-400"
            >
              {{ pose.result.value.verdict.message }}
            </p>
          </div>

          <!-- Desktop: result stays beside the video, no separate scroll section -->
          <div v-if="isDesktop" ref="resultsAnchor">
            <Transition name="results">
              <ResultsCard
                v-if="hasValidMarkers"
                :display-height="displayHeight"
                :display-error="displayError"
                :flight-time="flightTimeSeconds"
                :takeoff-frame="takeoffFrame"
                :landing-frame="landingFrame"
                :fps="fps"
                :unit="unit"
                :jump-height-cm="jumpHeightCm"
                :new-record-delta="newRecordDelta"
                :auto-detect="autoDetectInfo"
                @set-unit="setUnit"
                @share="openShareCard"
              />
            </Transition>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile: Clear + result live below the fold, reached by scrolling -->
    <div v-if="!isDesktop && isVideoLoaded" class="px-3 pb-6 flex flex-col gap-3">
      <button
        v-if="hasAnyMarker"
        class="min-h-11 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200
               bg-surface-light hover:bg-surface-lighter border border-surface-lighter transition-colors"
        @click="replay.stop(); clearMarkers()"
      >
        Clear
      </button>

      <div ref="resultsAnchor">
        <Transition name="results">
          <ResultsCard
            v-if="hasValidMarkers"
            :display-height="displayHeight"
            :display-error="displayError"
            :flight-time="flightTimeSeconds"
            :takeoff-frame="takeoffFrame"
            :landing-frame="landingFrame"
            :fps="fps"
            :unit="unit"
            :jump-height-cm="jumpHeightCm"
            :new-record-delta="newRecordDelta"
            :auto-detect="autoDetectInfo"
            @set-unit="setUnit"
            @share="openShareCard"
          />
        </Transition>
      </div>
    </div>
  </div>
</template>
