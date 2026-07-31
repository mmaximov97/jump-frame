import { computed, onUnmounted, type Ref } from 'vue'

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

  /**
   * Rounds rather than floors, for two reasons.
   *
   * A seek lands `currentTime` a hair *below* the frame boundary it snapped
   * to — a 240 fps clip stepped to frame 5 reports 0.02083, and 0.02083 * 240
   * is 4.9992, which floors to 4. The counter under the video sat one frame
   * behind the frame actually on screen, and stayed behind for every step.
   *
   * It also disagreed with the arithmetic: useJumpCalculation rounds when it
   * turns marker times into frame numbers, so the badge and the "Frames"
   * figure in the results card described the same instant with different
   * numbers.
   */
  const currentFrame = computed(() => Math.round(currentTime.value * fps.value))

  let holdTimeout: ReturnType<typeof setTimeout> | null = null
  let repeatInterval: ReturnType<typeof setInterval> | null = null

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
