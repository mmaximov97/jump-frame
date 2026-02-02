import { computed, type Ref } from 'vue'

export function useFrameStepping(
  videoRef: Ref<HTMLVideoElement | null>,
  fps: Ref<number>,
  currentTime: Ref<number>,
  duration: Ref<number>,
  pause: () => void
) {
  const frameTime = computed(() => 1 / fps.value)
  const currentFrame = computed(() => Math.floor(currentTime.value * fps.value))

  function stepForward() {
    if (!videoRef.value) return
    pause()
    const next = videoRef.value.currentTime + frameTime.value
    videoRef.value.currentTime = Math.min(next, duration.value)
  }

  function stepBackward() {
    if (!videoRef.value) return
    pause()
    const prev = videoRef.value.currentTime - frameTime.value
    videoRef.value.currentTime = Math.max(prev, 0)
  }

  return {
    frameTime,
    currentFrame,
    stepForward,
    stepBackward,
  }
}
