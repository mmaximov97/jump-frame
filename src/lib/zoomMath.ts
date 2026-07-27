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
 */
export function computeVideoBox(container: Size, intrinsic: Size): Box {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    return { left: container.width / 2, top: container.height / 2, width: 0, height: 0 }
  }
  const fit = Math.min(container.width / intrinsic.width, container.height / intrinsic.height)
  const width = intrinsic.width * fit
  const height = intrinsic.height * fit
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  }
}
