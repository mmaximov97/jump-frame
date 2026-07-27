import { describe, it, expect } from 'vitest'
import { computeVideoBox, clampZoom, MAX_SCALE, MIN_SCALE } from './zoomMath'

describe('computeVideoBox', () => {
  it('leaves letterbox bars above and below a landscape clip', () => {
    const box = computeVideoBox({ width: 400, height: 300 }, { width: 1920, height: 1080 })
    expect(box.width).toBeCloseTo(400)
    expect(box.height).toBeCloseTo(225)
    expect(box.left).toBeCloseTo(0)
    expect(box.top).toBeCloseTo(37.5)
  })

  it('leaves pillarbox bars left and right of a portrait clip', () => {
    const box = computeVideoBox({ width: 400, height: 300 }, { width: 1080, height: 1920 })
    expect(box.width).toBeCloseTo(168.75)
    expect(box.height).toBeCloseTo(300)
    expect(box.left).toBeCloseTo(115.625)
    expect(box.top).toBeCloseTo(0)
  })

  it('collapses to a zero-size box at the container centre before metadata loads', () => {
    const box = computeVideoBox({ width: 400, height: 300 }, { width: 0, height: 0 })
    expect(box).toEqual({ left: 200, top: 150, width: 0, height: 0 })
  })
})

describe('clampZoom', () => {
  const box = { left: 0, top: 37.5, width: 400, height: 225 }

  it('forces the offset to zero at 1x, where there is nothing to pan', () => {
    expect(clampZoom({ scale: 1, tx: 120, ty: -80 }, box)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('stops the video edge from moving inside the unzoomed box', () => {
    const clamped = clampZoom({ scale: 2, tx: 999, ty: 999 }, box)
    expect(clamped.tx).toBeCloseTo(200)
    expect(clamped.ty).toBeCloseTo(112.5)
  })

  it('clamps symmetrically in the negative direction', () => {
    const clamped = clampZoom({ scale: 2, tx: -999, ty: -999 }, box)
    expect(clamped.tx).toBeCloseTo(-200)
    expect(clamped.ty).toBeCloseTo(-112.5)
  })

  it('leaves an in-range offset untouched', () => {
    expect(clampZoom({ scale: 2, tx: 50, ty: -20 }, box)).toEqual({ scale: 2, tx: 50, ty: -20 })
  })

  it('holds the scale inside its bounds', () => {
    expect(clampZoom({ scale: 0.2, tx: 0, ty: 0 }, box).scale).toBe(MIN_SCALE)
    expect(clampZoom({ scale: 99, tx: 0, ty: 0 }, box).scale).toBe(MAX_SCALE)
  })

  it('never returns negative zero', () => {
    // Clamping a negative offset against a zero limit yields -0 in JS, which
    // would render as "translate(-0px)" and compares unequal to 0 in tests.
    expect(Object.is(clampZoom({ scale: 1, tx: 0, ty: -80 }, box).ty, 0)).toBe(true)
  })
})
