import { ref, type Ref, watch } from 'vue'
import { estimateFps, type FrameSample } from '../lib/fpsEstimate'

/**
 * How many `requestVideoFrameCallback` observations to collect. Twenty
 * costs about a third of a second of muted playback at 60 fps and leaves
 * the median plenty of intervals to discard stragglers from.
 */
const SAMPLES_NEEDED = 20

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

    const samples: FrameSample[] = []

    const wasMuted = video.muted
    const originalTime = video.currentTime

    video.muted = true

    /**
     * Ends the run with whatever was collected. Called both on a full
     * sample set and on `ended`, so a clip too short to reach
     * SAMPLES_NEEDED settles instead of leaving `isDetecting` stuck true
     * and blocking every later call.
     */
    function finish() {
      video!.removeEventListener('ended', finish)

      // A null estimate means the samples were unusable; leaving `fps` on
      // its default beats overwriting it with a guess.
      const estimated = estimateFps(samples)
      if (estimated !== null) {
        detectedFps.value = estimated
        fps.value = estimated
      }

      video!.pause()
      video!.muted = wasMuted
      video!.currentTime = originalTime
      isDetecting.value = false
    }

    function onFrame(_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) {
      samples.push({
        mediaTime: metadata.mediaTime,
        presentedFrames: metadata.presentedFrames,
      })

      if (samples.length >= SAMPLES_NEEDED) {
        finish()
        return
      }

      video!.requestVideoFrameCallback(onFrame)
    }

    video.addEventListener('ended', finish)
    video.requestVideoFrameCallback(onFrame)
    video.play().catch(() => {
      // Autoplay blocked — detection not possible
      video.removeEventListener('ended', finish)
      video.muted = wasMuted
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
