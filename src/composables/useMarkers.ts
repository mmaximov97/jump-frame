import { ref, computed } from 'vue'

export function useMarkers() {
  const takeoffTime = ref<number | null>(null)
  const landingTime = ref<number | null>(null)

  function setTakeoff(time: number) {
    takeoffTime.value = time
    if (landingTime.value !== null && landingTime.value <= time) {
      landingTime.value = null
    }
  }

  function setLanding(time: number) {
    landingTime.value = time
    if (takeoffTime.value !== null && takeoffTime.value >= time) {
      takeoffTime.value = null
    }
  }

  function clearMarkers() {
    takeoffTime.value = null
    landingTime.value = null
  }

  const hasValidMarkers = computed(
    () =>
      takeoffTime.value !== null &&
      landingTime.value !== null &&
      landingTime.value > takeoffTime.value
  )

  return {
    takeoffTime,
    landingTime,
    hasValidMarkers,
    setTakeoff,
    setLanding,
    clearMarkers,
  }
}
