import { computed, ref, watch, type Ref } from 'vue'
import { useFpsDetection } from './useFpsDetection'
import { useFrameStepping } from './useFrameStepping'
import { useMarkers } from './useMarkers'
import { useJumpCalculation } from './useJumpCalculation'
import { usePoseDetection } from './usePoseDetection'
import { useFlightReplay } from './useFlightReplay'
import { sameFrame } from '../lib/frameTiming'

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

  const analysis = computed(() => pose.result.value?.analysis ?? null)

  /**
   * The verdict decides whether a height may be drawn at all. A stature outside
   * the plausible band means the metric scale is wrong by a factor of k², so the
   * com path is still right in pixels while the centimetres are not — the
   * overlay draws the trajectory and omits the height segment.
   */
  const canShowHeight = computed(() => {
    const verdict = pose.result.value?.verdict
    return verdict !== undefined && verdict.kind !== 'unusable'
  })

  const replay = useFlightReplay(videoRef, analysis)

  // Start the loop as soon as a usable measurement lands, not on every result:
  // an unusable verdict has no flight window worth looping.
  watch(analysis, (result) => {
    if (result && canShowHeight.value) replay.start()
  })

  // Auto-detect gives a starting point but never overrides a mark the person
  // placed themselves — only fills in whichever side is still empty.
  watch(analysis, (result) => {
    if (!result) return
    if (markers.takeoffTime.value === null) markers.setTakeoff(result.takeoffTime)
    if (markers.landingTime.value === null) markers.setLanding(result.landingTime)
  })

  // Non-null only while the current marks are still the exact frames this
  // analysis was measured on. If either mark has since been dragged, the
  // pipeline's numbers would describe a jump that isn't the one being
  // measured anymore, so they disappear rather than go stale.
  const autoDetectInfo = computed(() => {
    const result = pose.result.value
    const a = result?.analysis
    const takeoff = markers.takeoffTime.value
    const landing = markers.landingTime.value
    if (!a || !result || takeoff === null || landing === null) return null
    if (!sameFrame(takeoff, a.takeoffTime, fps.value)) return null
    if (!sameFrame(landing, a.landingTime, fps.value)) return null
    return {
      analysis: a,
      verdict: result.verdict,
      scatter: pose.scatter.value,
      framesParsed: pose.frames.value.length,
    }
  })

  const hasAnyMarker = computed(
    () => markers.takeoffTime.value !== null || markers.landingTime.value !== null
  )

  return {
    fps,
    ...stepping,
    ...markers,
    ...calculation,
    pose,
    analysis,
    canShowHeight,
    replay,
    hasAnyMarker,
    autoDetectInfo,
  }
}
