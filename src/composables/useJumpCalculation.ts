import { computed, ref, type Ref } from 'vue'
import { frameAtTime } from '../lib/frameTiming'

export type DisplayUnit = 'metric' | 'imperial'

export function cmToUnit(cm: number, unit: DisplayUnit): number {
  return unit === 'metric' ? cm : cm * 0.393701
}

export function unitLabel(unit: DisplayUnit): string {
  return unit === 'metric' ? 'cm' : 'in'
}

export function useJumpCalculation(
  takeoffTime: Ref<number | null>,
  landingTime: Ref<number | null>,
  fps: Ref<number>
) {
  const unit = ref<'metric' | 'imperial'>('metric')

  // Same conversion the frame counter under the video uses. When these two
  // disagreed, the frame the user marked was not the frame that was
  // measured with.
  const takeoffFrame = computed(() =>
    takeoffTime.value !== null ? frameAtTime(takeoffTime.value, fps.value) : null
  )

  const landingFrame = computed(() =>
    landingTime.value !== null ? frameAtTime(landingTime.value, fps.value) : null
  )

  const flightTimeSeconds = computed(() => {
    if (takeoffFrame.value === null || landingFrame.value === null) return null
    return (landingFrame.value - takeoffFrame.value) / fps.value
  })

  const jumpHeightMeters = computed(() => {
    if (flightTimeSeconds.value === null) return null
    const t = flightTimeSeconds.value
    return (9.81 * t * t) / 8
  })

  const jumpHeightCm = computed(() =>
    jumpHeightMeters.value !== null ? jumpHeightMeters.value * 100 : null
  )

  const jumpHeightInches = computed(() =>
    jumpHeightMeters.value !== null ? jumpHeightMeters.value * 39.3701 : null
  )

  // Error margin from frame quantization: each marker ±0.5 frame,
  // worst-case flight time error ±1 frame = ±1/FPS seconds.
  // Δh = (h_upper − h_lower) / 2 = g·t / (4·FPS)
  const errorMarginMeters = computed(() => {
    if (flightTimeSeconds.value === null) return null
    return (9.81 * flightTimeSeconds.value) / (4 * fps.value)
  })

  const errorMarginCm = computed(() =>
    errorMarginMeters.value !== null ? errorMarginMeters.value * 100 : null
  )

  const errorMarginInches = computed(() =>
    errorMarginMeters.value !== null ? errorMarginMeters.value * 39.3701 : null
  )

  const displayError = computed(() => {
    if (unit.value === 'metric') {
      return { value: errorMarginCm.value, unit: 'cm' }
    }
    return { value: errorMarginInches.value, unit: 'in' }
  })

  function setUnit(target: 'metric' | 'imperial') {
    unit.value = target
  }

  const displayHeight = computed(() => {
    if (unit.value === 'metric') {
      return {
        value: jumpHeightCm.value,
        unit: 'cm',
      }
    }
    return {
      value: jumpHeightInches.value,
      unit: 'in',
    }
  })

  return {
    unit,
    takeoffFrame,
    landingFrame,
    flightTimeSeconds,
    jumpHeightMeters,
    jumpHeightCm,
    jumpHeightInches,
    setUnit,
    displayHeight,
    displayError,
  }
}
