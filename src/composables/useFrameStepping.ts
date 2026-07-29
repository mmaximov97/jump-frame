import { computed, onUnmounted, type Ref } from 'vue'
import { frameAtTime, timeAtFrame } from '../lib/frameTiming'

const HOLD_DELAY_MS = 300
const REPEAT_INTERVAL_MS = 100

export function useFrameStepping(
  videoRef: Ref<HTMLVideoElement | null>,
  fps: Ref<number>,
  currentTime: Ref<number>,
  duration: Ref<number>,
  pause: () => void
) {
  const frameTime = computed(() => 1 / fps.value)
  const currentFrame = computed(() => frameAtTime(currentTime.value, fps.value))

  let holdTimeout: ReturnType<typeof setTimeout> | null = null
  let repeatInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Steps by frame number rather than by adding `1 / fps` to whatever
   * `currentTime` reads. The video element returns a seek a hair short of
   * where it was sent, so adding an offset to that read-back accumulates
   * the shortfall and eventually lands twice on the same frame.
   * Re-deriving the frame each time keeps every step on the grid.
   */
  function stepTo(frame: number) {
    if (!videoRef.value) return
    pause()
    const target = timeAtFrame(frame, fps.value)
    videoRef.value.currentTime = Math.min(Math.max(target, 0), duration.value)
  }

  function stepForward() {
    if (!videoRef.value) return
    stepTo(frameAtTime(videoRef.value.currentTime, fps.value) + 1)
  }

  function stepBackward() {
    if (!videoRef.value) return
    stepTo(frameAtTime(videoRef.value.currentTime, fps.value) - 1)
  }

  function stopHold() {
    if (holdTimeout !== null) {
      clearTimeout(holdTimeout)
      holdTimeout = null
    }
    if (repeatInterval !== null) {
      clearInterval(repeatInterval)
      repeatInterval = null
    }
  }

  function startHold(step: () => void) {
    stopHold()
    step()
    holdTimeout = setTimeout(() => {
      repeatInterval = setInterval(step, REPEAT_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  function startStepForwardHold() {
    startHold(stepForward)
  }

  function startStepBackwardHold() {
    startHold(stepBackward)
  }

  onUnmounted(stopHold)

  return {
    frameTime,
    currentFrame,
    stepForward,
    stepBackward,
    startStepForwardHold,
    startStepBackwardHold,
    stopHold,
  }
}
