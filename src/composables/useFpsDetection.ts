import { ref, type Ref, watch } from 'vue'

const STANDARD_FPS = [24, 25, 30, 50, 60, 120, 240] as const

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
    const SAMPLES_NEEDED = 10

    const wasMuted = video.muted
    const originalTime = video.currentTime

    video.muted = true

    function onFrame(_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) {
      mediaTimes.push(metadata.mediaTime)

      if (mediaTimes.length >= SAMPLES_NEEDED) {
        const deltas: number[] = []
        for (let i = 1; i < mediaTimes.length; i++) {
          const delta = mediaTimes[i]! - mediaTimes[i - 1]!
          if (delta > 0) deltas.push(delta)
        }

        if (deltas.length > 0) {
          deltas.sort((a, b) => a - b)
          const medianDelta = deltas[Math.floor(deltas.length / 2)]!
          const rawFps = 1 / medianDelta
          const rounded = roundToStandardFps(rawFps)
          detectedFps.value = rounded
          fps.value = rounded
        }

        video!.pause()
        video!.muted = wasMuted
        video!.currentTime = originalTime
        isDetecting.value = false
        return
      }

      video!.requestVideoFrameCallback(onFrame)
    }

    video.requestVideoFrameCallback(onFrame)
    video.play().catch(() => {
      // Autoplay blocked — detection not possible
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
