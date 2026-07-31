import { ref, type Ref, watch } from 'vue'

const STANDARD_FPS = [24, 25, 30, 50, 60, 120, 240] as const

/**
 * Playback rate used while measuring.
 *
 * `requestVideoFrameCallback` fires once per frame the compositor *presents*,
 * not once per frame the decoder produces. At 1x on a 60 Hz display a 120 fps
 * clip can only present 60 frames a second, so half its frames are dropped and
 * every `mediaTime` delta reads 1/60 s — the clip measures as 60 fps, and a
 * 240 fps clip measures as 60 too.
 *
 * Slowing playback fixes this at the source: at 0.15x even a 240 fps clip
 * presents 36 frames a second, below any display's refresh rate, so no frame
 * is dropped and each delta is the true frame interval.
 */
const DETECT_PLAYBACK_RATE = 0.15

/**
 * Frames to observe. Seven intervals is ample for a median, and keeps the
 * measurement short despite the slow rate: ~1.8 s of real time for a 30 fps
 * clip, ~0.2 s for a 240 fps one.
 */
const SAMPLES_NEEDED = 8

/** Below this the median rests on too little to trust. */
const MIN_INTERVALS = 3

/**
 * Ceiling on a single detection run. A decoder that stalls stops delivering
 * frame callbacks, and without this the run would never settle — leaving
 * `isDetecting` true and blocking every later attempt.
 */
const DETECT_TIMEOUT_MS = 6000

function roundToStandardFps(rawFps: number): number {
  let closest = 60
  let minDiff = Infinity
  for (const std of STANDARD_FPS) {
    const diff = Math.abs(rawFps - std)
    if (diff < minDiff) {
      minDiff = diff
      closest = std
    }
  }
  return closest
}

export function useFpsDetection(
  videoRef: Ref<HTMLVideoElement | null>,
  isVideoLoaded: Ref<boolean>,
  fps: Ref<number>
) {
  const detectedFps = ref<number | null>(null)
  const isDetecting = ref(false)

  const supported = 'requestVideoFrameCallback' in HTMLVideoElement.prototype

  function detect() {
    const video = videoRef.value
    if (!video || isDetecting.value || !supported) return

    isDetecting.value = true
    detectedFps.value = null

    const mediaTimes: number[] = []

    const wasMuted = video.muted
    const wasPlaybackRate = video.playbackRate
    const originalTime = video.currentTime

    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    video.muted = true
    video.playbackRate = DETECT_PLAYBACK_RATE

    /**
     * Ends the run with whatever was collected, and puts the element back the
     * way it was found. Reached three ways — a full sample set, a clip that
     * ended first, or the timeout — so every path restores playbackRate and
     * clears `isDetecting` exactly once.
     */
    function finish() {
      if (settled) return
      settled = true

      if (timeoutId !== null) clearTimeout(timeoutId)
      video!.removeEventListener('ended', finish)

      const intervals: number[] = []
      for (let i = 1; i < mediaTimes.length; i++) {
        const delta = mediaTimes[i]! - mediaTimes[i - 1]!
        if (Number.isFinite(delta) && delta > 0) intervals.push(delta)
      }

      // Too few usable intervals means the samples cannot support an
      // estimate. Leaving `fps` on its current value beats overwriting it
      // with a guess.
      if (intervals.length >= MIN_INTERVALS) {
        intervals.sort((a, b) => a - b)
        const medianInterval = intervals[Math.floor(intervals.length / 2)]!
        const rounded = roundToStandardFps(1 / medianInterval)
        detectedFps.value = rounded
        fps.value = rounded
      }

      video!.pause()
      video!.muted = wasMuted
      video!.playbackRate = wasPlaybackRate
      video!.currentTime = originalTime
      isDetecting.value = false
    }

    function onFrame(_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) {
      if (settled) return

      mediaTimes.push(metadata.mediaTime)

      if (mediaTimes.length >= SAMPLES_NEEDED) {
        finish()
        return
      }

      video!.requestVideoFrameCallback(onFrame)
    }

    timeoutId = setTimeout(finish, DETECT_TIMEOUT_MS)
    video.addEventListener('ended', finish)
    video.requestVideoFrameCallback(onFrame)
    video.play().catch(() => {
      // Autoplay blocked — detection is not possible, so restore and bail
      // rather than leave the element slowed down.
      if (settled) return
      settled = true
      if (timeoutId !== null) clearTimeout(timeoutId)
      video.removeEventListener('ended', finish)
      video.muted = wasMuted
      video.playbackRate = wasPlaybackRate
      isDetecting.value = false
    })
  }

  watch(isVideoLoaded, (loaded) => {
    if (loaded) detect()
  })

  return {
    detectedFps,
    isDetecting,
    supported,
    detect,
  }
}
