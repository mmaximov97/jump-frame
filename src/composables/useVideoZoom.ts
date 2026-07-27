import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  clampZoom,
  computeVideoBox,
  panBy,
  project as projectPoint,
  zoomAbout,
  MIN_SCALE,
  type Box,
  type Point,
  type ZoomState,
} from '../lib/zoomMath'

const DOUBLE_TAP_SCALE = 3
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 30
const TAP_SLOP_PX = 5
const WHEEL_SENSITIVITY = 0.002
const KEY_ZOOM_FACTOR = 1.25

export function useVideoZoom(
  containerRef: Ref<HTMLElement | null>,
  videoRef: Ref<HTMLVideoElement | null>
) {
  const state = ref<ZoomState>({ scale: 1, tx: 0, ty: 0 })
  const containerSize = ref({ width: 0, height: 0 })
  const intrinsicSize = ref({ width: 0, height: 0 })

  const box = computed<Box>(() => computeVideoBox(containerSize.value, intrinsicSize.value))
  const scale = computed(() => state.value.scale)
  const isZoomed = computed(() => state.value.scale > MIN_SCALE)

  const transformStyle = computed(() => ({
    transform: `translate(${state.value.tx}px, ${state.value.ty}px) scale(${state.value.scale})`,
  }))

  // pan-y keeps the page scrollable at 1x — on mobile the results card lives
  // below the fold — while still disabling the browser's own pinch-zoom, so
  // our two-finger handler is the one that receives the gesture.
  const touchAction = computed(() => (isZoomed.value ? 'none' : 'pan-y'))

  const pointers = new Map<number, Point>()
  let pinchDistance = 0
  let pinchCentre: Point = { x: 0, y: 0 }
  let gestureMoved = false
  let gestureStart: Point = { x: 0, y: 0 }
  let lastTapAt = 0
  let lastTapPoint: Point = { x: 0, y: 0 }

  function localPoint(e: PointerEvent): Point {
    const el = containerRef.value
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function centreOfBox(): Point {
    return { x: box.value.left + box.value.width / 2, y: box.value.top + box.value.height / 2 }
  }

  function measureContainer() {
    const el = containerRef.value
    if (!el) return
    containerSize.value = { width: el.clientWidth, height: el.clientHeight }
    state.value = clampZoom(state.value, box.value)
  }

  function measureIntrinsic() {
    const el = videoRef.value
    if (!el) return
    intrinsicSize.value = { width: el.videoWidth, height: el.videoHeight }
    state.value = clampZoom(state.value, box.value)
  }

  function onPointerDown(e: PointerEvent) {
    // The reset button lives inside the container; its taps are not gestures.
    if ((e.target as HTMLElement).closest('button')) return
    if (pointers.size === 0) {
      gestureMoved = false
      gestureStart = localPoint(e)
    }
    pointers.set(e.pointerId, localPoint(e))
    containerRef.value?.setPointerCapture(e.pointerId)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Point, Point]
      pinchDistance = distance(a, b)
      pinchCentre = midpoint(a, b)
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return
    const previous = pointers.get(e.pointerId)!
    const current = localPoint(e)
    pointers.set(e.pointerId, current)

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Point, Point]
      const nextDistance = distance(a, b)
      const nextCentre = midpoint(a, b)
      if (pinchDistance > 0) {
        e.preventDefault()
        gestureMoved = true
        const zoomed = zoomAbout(state.value, box.value, pinchCentre, nextDistance / pinchDistance)
        state.value = panBy(
          zoomed,
          box.value,
          nextCentre.x - pinchCentre.x,
          nextCentre.y - pinchCentre.y
        )
      }
      pinchDistance = nextDistance
      pinchCentre = nextCentre
      return
    }

    if (distance(current, gestureStart) > TAP_SLOP_PX) gestureMoved = true
    if (isZoomed.value) {
      e.preventDefault()
      state.value = panBy(state.value, box.value, current.x - previous.x, current.y - previous.y)
    }
  }

  function onPointerUp(e: PointerEvent) {
    const released = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDistance = 0
    if (!released || pointers.size > 0 || gestureMoved) return

    const isSecondTap =
      e.timeStamp - lastTapAt < DOUBLE_TAP_MS &&
      distance(released, lastTapPoint) < DOUBLE_TAP_SLOP_PX

    if (isSecondTap) {
      const target = isZoomed.value ? MIN_SCALE : DOUBLE_TAP_SCALE
      state.value = zoomAbout(state.value, box.value, released, target / state.value.scale)
      lastTapAt = 0
      return
    }

    lastTapAt = e.timeStamp
    lastTapPoint = released
  }

  // The browser sends pointercancel when it aborts a gesture out from under
  // us — most notably when a touch-scroll takeover kicks in. That is by
  // definition not a completed tap, so mark it moved before running the same
  // cleanup as onPointerUp. This also covers a stationary two-finger
  // touch-and-release with zero intervening pointermove, which would
  // otherwise fall through to tap detection.
  function onPointerCancel(e: PointerEvent) {
    gestureMoved = true
    onPointerUp(e)
  }

  function onWheel(e: WheelEvent) {
    const el = containerRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    state.value = zoomAbout(
      state.value,
      box.value,
      anchor,
      Math.exp(-e.deltaY * WHEEL_SENSITIVITY)
    )
  }

  function zoomIn() {
    state.value = zoomAbout(state.value, box.value, centreOfBox(), KEY_ZOOM_FACTOR)
  }

  function zoomOut() {
    state.value = zoomAbout(state.value, box.value, centreOfBox(), 1 / KEY_ZOOM_FACTOR)
  }

  function reset() {
    state.value = { scale: 1, tx: 0, ty: 0 }
  }

  function project(nx: number, ny: number): Point {
    return projectPoint(nx, ny, box.value, state.value)
  }

  let observer: ResizeObserver | null = null

  watch(
    containerRef,
    (el) => {
      observer?.disconnect()
      observer = null
      if (!el) return
      observer = new ResizeObserver(measureContainer)
      observer.observe(el)
      measureContainer()
    },
    { immediate: true }
  )

  watch(
    videoRef,
    (el, old) => {
      if (old) old.removeEventListener('loadedmetadata', measureIntrinsic)
      if (!el) return
      el.addEventListener('loadedmetadata', measureIntrinsic)
      if (el.videoWidth > 0) measureIntrinsic()
    },
    { immediate: true }
  )

  onUnmounted(() => {
    observer?.disconnect()
    videoRef.value?.removeEventListener('loadedmetadata', measureIntrinsic)
  })

  return {
    scale,
    isZoomed,
    transformStyle,
    touchAction,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onWheel,
    zoomIn,
    zoomOut,
    reset,
    project,
  }
}
