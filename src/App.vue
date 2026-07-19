<script setup lang="ts">
import { ref, computed } from 'vue'
import { useVideoPlayer } from './composables/useVideoPlayer'
import { useFpsDetection } from './composables/useFpsDetection'
import { useFrameStepping } from './composables/useFrameStepping'
import { useMarkers } from './composables/useMarkers'
import { useJumpCalculation } from './composables/useJumpCalculation'
import VideoUpload from './components/VideoUpload.vue'
import VideoPlayer from './components/VideoPlayer.vue'
import FrameControls from './components/FrameControls.vue'
import MarkerControls from './components/MarkerControls.vue'
import ResultsCard from './components/ResultsCard.vue'
import TheoryPage from './components/TheoryPage.vue'

const showTheory = ref(false)

const fps = ref(60)

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
} = useVideoPlayer()

useFpsDetection(videoRef, isVideoLoaded, fps)

const { currentFrame, stepForward, stepBackward } = useFrameStepping(
  videoRef,
  fps,
  currentTime,
  duration,
  pause
)

const {
  takeoffTime,
  landingTime,
  hasValidMarkers,
  setTakeoff,
  setLanding,
  clearMarkers,
} = useMarkers()

const {
  unit,
  takeoffFrame,
  landingFrame,
  flightTimeSeconds,
  jumpHeightCm,
  displayHeight,
  displayError,
  setUnit,
} = useJumpCalculation(takeoffTime, landingTime, fps)

const hasAnyMarker = computed(
  () => takeoffTime.value !== null || landingTime.value !== null
)

function onFileSelected(file: File) {
  clearMarkers()
  loadVideo(file)
}

function setVideoRef(el: HTMLVideoElement | null) {
  videoRef.value = el
}
</script>

<template>
  <!-- Theory page -->
  <TheoryPage v-if="showTheory" @back="showTheory = false" />

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
    </div>
  </div>

  <!-- Player screen — fills viewport -->
  <div v-else class="h-dvh flex flex-col px-3 py-2 md:px-4 md:py-4">
    <header class="flex items-center justify-between mb-2 shrink-0">
      <h1 class="text-sm font-bold tracking-tight md:text-xl">FrameJump</h1>
      <button
        class="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        @click="videoSrc = ''; clearMarkers()"
      >
        &larr; New video
      </button>
    </header>

    <div class="flex-1 min-h-0 flex flex-col md:flex-row gap-3">
      <!-- Video + playback controls -->
      <div class="flex-1 min-h-0 flex flex-col transition-all duration-300 ease-in-out">
        <VideoPlayer :src="videoSrc" @video-ref="setVideoRef" />
        <FrameControls
          v-if="isVideoLoaded"
          :is-playing="isPlaying"
          :current-time="currentTime"
          :current-frame="currentFrame"
          @toggle-play="togglePlayPause"
          @step-forward="stepForward"
          @step-backward="stepBackward"
        />
      </div>

      <!-- Side panel -->
      <div v-if="isVideoLoaded" class="shrink-0 md:w-72 flex flex-col gap-3">
        <MarkerControls
          :takeoff-set="takeoffTime !== null"
          :landing-set="landingTime !== null"
          :has-any-marker="hasAnyMarker"
          @set-takeoff="setTakeoff(currentTime)"
          @set-landing="setLanding(currentTime)"
          @clear-markers="clearMarkers"
        />

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
            @set-unit="setUnit"
          />
        </Transition>
      </div>
    </div>
  </div>
</template>
