import { describe, expect, it } from 'vitest'
import { frameAtTime, timeAtFrame } from './frameTiming'

/**
 * The real rate of the clip this bug was reported on: ffprobe gives 239
 * frames across 358709/90000 s, i.e. avg_frame_rate 21510000/358709. It is
 * tagged 60 fps, and 59.965 is what "60 fps" actually means in a container.
 */
const REAL_RATE = 21510000 / 358709
const REAL_FRAME_COUNT = 239

describe('frameAtTime', () => {
  it('snaps a seek that read back a hair short of its own boundary', () => {
    // Chrome returns 57.99996 frames after being asked for frame 58.
    const asReadBack = 57.99996 / 60

    // Guard: the plain floor this replaced really does answer 57 here.
    expect(Math.floor(asReadBack * 60)).toBe(57)

    expect(frameAtTime(asReadBack, 60)).toBe(58)
  })

  it('leaves a genuine mid-frame position on the frame it is inside', () => {
    expect(frameAtTime(60.5 / 60, 60)).toBe(60)
    expect(frameAtTime(60.9 / 60, 60)).toBe(60)
  })

  it('snaps up only within the tolerance, not across the whole frame', () => {
    // 0.0005 frames short of the boundary is a read-back artefact: snap up.
    expect(frameAtTime(60.9995 / 60, 60)).toBe(61)
    // 0.01 frames short is a real position inside frame 60: leave it there.
    expect(frameAtTime(60.99 / 60, 60)).toBe(60)
  })

  it('reports frame 0 at the start of the clip', () => {
    expect(frameAtTime(0, 60)).toBe(0)
  })

  it('returns 0 rather than NaN or a negative frame for unusable input', () => {
    expect(frameAtTime(NaN, 60)).toBe(0)
    expect(frameAtTime(1, 0)).toBe(0)
    expect(frameAtTime(1, NaN)).toBe(0)
    expect(frameAtTime(-1, 60)).toBe(0)
  })
})

describe('timeAtFrame', () => {
  it('round-trips every frame of a stepped run', () => {
    // The property the frame counter depends on: stepping frame by frame
    // must produce every number once, with no repeat and no skip.
    const seen: number[] = []
    for (let k = 0; k < 240; k++) seen.push(frameAtTime(timeAtFrame(k, 60), 60))
    expect(seen).toEqual(Array.from({ length: 240 }, (_, k) => k))
  })

  it('lands inside the real frame, not the one before it', () => {
    // Guard: the leading edge k/fps falls short of where frame k actually
    // begins, which is the whole reason timeAtFrame aims at the midpoint.
    expect(60 / 60).toBeLessThan(60 / REAL_RATE)

    for (let k = 0; k < REAL_FRAME_COUNT; k++) {
      const t = timeAtFrame(k, 60)
      expect(t).toBeGreaterThanOrEqual(k / REAL_RATE)
      expect(t).toBeLessThan((k + 1) / REAL_RATE)
    }
  })

  it('returns 0 rather than NaN for unusable input', () => {
    expect(timeAtFrame(0, 0)).toBe(0)
    expect(timeAtFrame(NaN, 60)).toBe(0)
    expect(timeAtFrame(5, NaN)).toBe(0)
  })
})
