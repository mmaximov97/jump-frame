import { computed, ref, type Ref } from 'vue'
import { useFpsDetection } from './useFpsDetection'
import { useFrameStepping } from './useFrameStepping'
import { useMarkers } from './useMarkers'
import { useJumpCalculation } from './useJumpCalculation'
import { usePoseDetection } from './usePoseDetection'

/**
 * Everything that turns a loaded video into a measurement: frame rate, frame
 * stepping, the two markers, the flight-time arithmetic and the automatic
 * pose pipeline.
 *
 * Split out of App.vue, which had grown to hold the video, the measurement,
 * the history, the draft handling, the share card and the layout at once.
 * The overlay adds one more moving part to that file; without this split the
 * next edit to it would be guesswork.
 *
 * Deliberately NOT in here: video element lifecycle, history and drafts, the
 * share card. Those belong to the results side and move when the results card
 * is reworked.
 */
export function useMeasurement(
  videoRef: Ref<HTMLVideoElement | null>,
  isVideoLoaded: Ref<boolean>,
  currentTime: Ref<number>,
  duration: Ref<number>,
  pause: () => void
) {
  const fps = ref(60)

  useFpsDetection(videoRef, isVideoLoaded, fps)

  const stepping = useFrameStepping(videoRef, fps, currentTime, duration, pause)
  const markers = useMarkers()
  const calculation = useJumpCalculation(markers.takeoffTime, markers.landingTime, fps)
  const pose = usePoseDetection(videoRef, fps)

  const hasAnyMarker = computed(
    () => markers.takeoffTime.value !== null || markers.landingTime.value !== null
  )

  return {
    fps,
    ...stepping,
    ...markers,
    ...calculation,
    pose,
    hasAnyMarker,
  }
}
