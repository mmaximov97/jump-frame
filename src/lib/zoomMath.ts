export interface Size {
  width: number
  height: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Reproduces what CSS `object-contain` does: fit the video inside the
 * container preserving aspect ratio, then centre it.
 *
 * Computed rather than measured on purpose — once a transform is applied to
 * the <video>, getBoundingClientRect() reports the zoomed rectangle, and
 * every projection here needs the unzoomed one.
 *
 * Models the CSS this function stands in for: the <video> is `max-w-full
 * max-h-full`, which only ever shrinks a replaced element to fit its
 * container — it never enlarges one that's already smaller. `fit` must stay
 * capped at 1 for the same reason. (Do not add `w-full`/`h-full` to the
 * <video> class list — that would upscale the element in the DOM while this
 * function kept reporting the unscaled box, breaking the correspondence this
 * whole matrix — and the `transform-origin` it assumes — depends on.)
 */
export function computeVideoBox(container: Size, intrinsic: Size): Box {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    return { left: container.width / 2, top: container.height / 2, width: 0, height: 0 }
  }
  const fit = Math.min(1, container.width / intrinsic.width, container.height / intrinsic.height)
  const width = intrinsic.width * fit
  const height = intrinsic.height * fit
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  }
}

export interface ZoomState {
  scale: number
  tx: number
  ty: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 8

/**
 * Clamping a negative value against a zero limit produces -0, which renders
 * as "translate(-0px)" and compares unequal to 0 under Object.is.
 */
function withoutNegativeZero(n: number): number {
  return n === 0 ? 0 : n
}

/**
 * Keeps the zoomed video covering at least its own unzoomed box, so panning
 * can never reveal a black gap at the edge. At 1x there is nothing to pan,
 * so the offset collapses to zero.
 */
export function clampZoom(state: ZoomState, box: Box): ZoomState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale))
  const maxTx = (box.width * (scale - 1)) / 2
  const maxTy = (box.height * (scale - 1)) / 2
  return {
    scale,
    tx: withoutNegativeZero(Math.min(maxTx, Math.max(-maxTx, state.tx))),
    ty: withoutNegativeZero(Math.min(maxTy, Math.max(-maxTy, state.ty))),
  }
}

export interface Point {
  x: number
  y: number
}

/**
 * Scales by `factor` while holding whatever sits under `anchor` stationary.
 *
 * Screen position of a layout point is `c + (p - c) * s + t`. Solving that
 * for the new offset under the constraint that the anchored point does not
 * move gives `t' = d - (d - t) * s'/s`, where `d = anchor - c`.
 */
export function zoomAbout(state: ZoomState, box: Box, anchor: Point, factor: number): ZoomState {
  const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor))
  const ratio = nextScale / state.scale
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const dx = anchor.x - cx
  const dy = anchor.y - cy
  return clampZoom(
    {
      scale: nextScale,
      tx: dx - (dx - state.tx) * ratio,
      ty: dy - (dy - state.ty) * ratio,
    },
    box
  )
}

export function panBy(state: ZoomState, box: Box, dx: number, dy: number): ZoomState {
  return clampZoom({ scale: state.scale, tx: state.tx + dx, ty: state.ty + dy }, box)
}

/**
 * Normalized frame coordinates (0..1, as MediaPipe reports them) to pixels in
 * the container's coordinate space, with the current zoom applied.
 *
 * The pose overlay canvas deliberately sits outside the CSS transform — a
 * canvas inside it would have its bitmap stretched and the skeleton would go
 * blurry. Instead the points travel through this matrix by hand.
 */
export function project(nx: number, ny: number, box: Box, state: ZoomState): Point {
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const bx = box.left + nx * box.width
  const by = box.top + ny * box.height
  return {
    x: cx + (bx - cx) * state.scale + state.tx,
    y: cy + (by - cy) * state.scale + state.ty,
  }
}
