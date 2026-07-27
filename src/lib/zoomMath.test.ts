import { describe, it, expect } from 'vitest'
import { computeVideoBox } from './zoomMath'

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
