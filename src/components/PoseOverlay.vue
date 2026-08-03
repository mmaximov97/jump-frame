<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch } from 'vue'
import { ZOOM_CONTEXT } from '../composables/zoomContext'
import { buildFlightGeometry, buildSkeleton, findFrameAt } from '../lib/overlayGeometry'
import type { JumpAnalysis } from '../lib/jumpFromCom'
import type { PoseFrame, VideoSize } from '../lib/poseTypes'

const props = defineProps<{
  frames: PoseFrame[]
  analysis: JumpAnalysis | null
  videoSize: VideoSize
  videoEl: HTMLVideoElement | null
  fps: number
  /** False when the verdict says the metric scale cannot be trusted. */
  showHeight: boolean
}>()

const zoom = inject(ZOOM_CONTEXT, null)

/**
 * Playback time, tracked precisely enough to keep the skeleton on the body.
 *
 * `timeupdate` fires about four times a second, so driving the overlay from it
 * leaves the skeleton hundreds of milliseconds behind during playback. While
 * the video plays this follows `requestVideoFrameCallback` and reads the
 * `mediaTime` of the frame actually presented; while it is paused, seeking and
 * frame stepping come through the `seeked`/`timeupdate` path below.
 */
const time = ref(0)

let rafHandle: number | null = null
let rvfcHandle: number | null = null

/**
 * The element the callbacks below were registered against.
 *
 * Tracked separately from `props.videoEl` because by the time the watcher
 * tears the old element down, the prop already points at the new one — and
 * cancelling a frame callback on the wrong element leaves the old one firing
 * into a component that has moved on.
 */
let followed: HTMLVideoElement | null = null

function readCurrentTime() {
  const video = props.videoEl
  // Paused only. While playing, follow() supplies the mediaTime of the frame
  // actually presented; timeupdate fires about four times a second and would
  // coarsen it straight back, which is what the rVFC path exists to avoid.
  if (video && video.paused) time.value = video.currentTime
}

function stopFollowing() {
  if (rvfcHandle !== null && followed && typeof followed.cancelVideoFrameCallback === 'function') {
    followed.cancelVideoFrameCallback(rvfcHandle)
  }
  if (rafHandle !== null) cancelAnimationFrame(rafHandle)
  rvfcHandle = null
  rafHandle = null
  followed = null
}

function follow() {
  const video = props.videoEl
  if (!video) return
  followed = video

  // Feature-detected with `typeof` rather than `in`: lib.dom declares
  // requestVideoFrameCallback as a required property of HTMLVideoElement, so
  // an `in` check narrows the fallback branch to `never` — the types insist a
  // browser without the method cannot exist. Firefox and older Safari say
  // otherwise, which is what the requestAnimationFrame branch below is for.
  if (typeof video.requestVideoFrameCallback === 'function') {
    rvfcHandle = video.requestVideoFrameCallback((_now, metadata) => {
      time.value = metadata.mediaTime
      if (!video.paused) follow()
    })
    return
  }

  // No rVFC: fall back to animation frames and currentTime. Sync is coarser,
  // the skeleton still tracks.
  rafHandle = requestAnimationFrame(() => {
    time.value = video.currentTime
    if (!video.paused) follow()
  })
}

watch(
  () => props.videoEl,
  (video, previous) => {
    stopFollowing()
    if (previous) {
      previous.removeEventListener('play', follow)
      previous.removeEventListener('pause', stopFollowing)
      previous.removeEventListener('seeked', readCurrentTime)
      previous.removeEventListener('timeupdate', readCurrentTime)
    }
    if (!video) return
    video.addEventListener('play', follow)
    video.addEventListener('pause', stopFollowing)
    video.addEventListener('seeked', readCurrentTime)
    video.addEventListener('timeupdate', readCurrentTime)
    readCurrentTime()
    if (!video.paused) follow()
  },
  { immediate: true }
)

onUnmounted(() => {
  stopFollowing()
  const video = props.videoEl
  if (!video) return
  video.removeEventListener('play', follow)
  video.removeEventListener('pause', stopFollowing)
  video.removeEventListener('seeked', readCurrentTime)
  video.removeEventListener('timeupdate', readCurrentTime)
})

/**
 * The pose to draw, or null. The one-frame gap is what confines the skeleton
 * to the dense pass: the coarse pass samples every sixth frame, so outside the
 * flight window nothing is ever this close.
 */
const pose = computed(() => {
  const rate = props.fps > 0 ? props.fps : 60
  return findFrameAt(props.frames, time.value, 1 / rate)
})

const skeleton = computed(() => {
  const frame = pose.value
  return frame ? buildSkeleton(frame.landmarks) : null
})

const flight = computed(() => {
  if (!props.analysis) return null
  return buildFlightGeometry(props.frames, props.videoSize, props.analysis)
})

/** Container pixels for a normalized point. */
function at(x: number, y: number) {
  return zoom ? zoom.project(x, y) : { x: 0, y: 0 }
}

const bones = computed(() =>
  (skeleton.value?.bones ?? []).map((bone) => {
    const a = at(bone.a.x, bone.a.y)
    const b = at(bone.b.x, bone.b.y)
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  })
)

const joints = computed(() => (skeleton.value?.joints ?? []).map((j) => at(j.x, j.y)))

const com = computed(() => {
  const point = skeleton.value?.com
  return point ? at(point.x, point.y) : null
})

const trail = computed(() => (flight.value?.trail ?? []).map((p) => at(p.x, p.y)))

const curvePath = computed(() => {
  const points = flight.value?.curve ?? []
  if (points.length < 2) return ''
  return points
    .map((p, i) => {
      const screen = at(p.x, p.y)
      return `${i === 0 ? 'M' : 'L'}${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`
    })
    .join(' ')
})

/**
 * Takeoff level and the height segment, in container pixels.
 *
 * The segment sits at a fixed inset from the right rather than at the apex's
 * own x, where it would be drawn straight through the athlete's body.
 */
const HEIGHT_SEGMENT_X = 0.88

const levels = computed(() => {
  const geometry = flight.value
  if (!geometry) return null
  const takeoff = at(0, geometry.takeoffY)
  const takeoffRight = at(1, geometry.takeoffY)
  const segmentTop = at(HEIGHT_SEGMENT_X, geometry.apexY)
  const segmentBottom = at(HEIGHT_SEGMENT_X, geometry.takeoffY)
  return {
    floorX1: takeoff.x,
    floorX2: takeoffRight.x,
    floorY: takeoff.y,
    segX: segmentTop.x,
    segY1: segmentTop.y,
    segY2: segmentBottom.y,
  }
})
</script>

<template>
  <svg
    class="absolute inset-0 w-full h-full pointer-events-none"
    aria-hidden="true"
  >
    <!-- Takeoff level, drawn under everything else -->
    <line
      v-if="levels && showHeight"
      :x1="levels.floorX1" :y1="levels.floorY"
      :x2="levels.floorX2" :y2="levels.floorY"
      stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"
    />

    <!-- Fitted parabola -->
    <path
      v-if="curvePath"
      :d="curvePath"
      fill="none" stroke="#fbbf24" stroke-width="2"
      stroke-dasharray="5 6" opacity="0.7"
    />

    <!-- Measured com positions -->
    <circle
      v-for="(point, i) in trail" :key="`t${i}`"
      :cx="point.x" :cy="point.y" r="2.5"
      fill="#fbbf24" opacity="0.45"
    />

    <!-- Height segment -->
    <g v-if="levels && showHeight" stroke="#4ade80" stroke-width="2">
      <line :x1="levels.segX" :y1="levels.segY1" :x2="levels.segX" :y2="levels.segY2" />
      <line :x1="levels.segX - 6" :y1="levels.segY1" :x2="levels.segX + 6" :y2="levels.segY1" />
      <line :x1="levels.segX - 6" :y1="levels.segY2" :x2="levels.segX + 6" :y2="levels.segY2" />
    </g>

    <!-- Skeleton -->
    <line
      v-for="(bone, i) in bones" :key="`b${i}`"
      :x1="bone.x1" :y1="bone.y1" :x2="bone.x2" :y2="bone.y2"
      stroke="#38bdf8" stroke-width="3" stroke-linecap="round" opacity="0.95"
    />
    <circle
      v-for="(joint, i) in joints" :key="`j${i}`"
      :cx="joint.x" :cy="joint.y" r="3.2"
      fill="#e0f2fe"
    />

    <!-- Centre of mass, on top -->
    <g v-if="com">
      <circle :cx="com.x" :cy="com.y" r="9" fill="#fbbf24" opacity="0.25" />
      <circle :cx="com.x" :cy="com.y" r="4.5" fill="#fbbf24" />
    </g>
  </svg>
</template>
