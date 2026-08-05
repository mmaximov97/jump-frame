import { describe, it, expect } from 'vitest'
import { measureJump } from './jumpFromCom'
import { REAL_CLIP_FRAMES, REAL_CLIP_VIDEO } from './testing/realClipFixture'

describe('measureJump on a real clip with a running approach', () => {
  // No known ground truth for this clip -- it was never re-measured by hand
  // frame-by-frame. This pins that the pipeline no longer refuses to even
  // try (landing-past-end, the bug that motivated this whole plan), not that
  // a specific height is correct.
  it('finds a landing instead of landing-past-end', () => {
    const result = measureJump(REAL_CLIP_FRAMES, REAL_CLIP_VIDEO)
    const isLandingPastEnd = result.verdict.kind === 'unusable'
      && result.verdict.reason === 'short-flight'
      && result.analysis === null
    expect(isLandingPastEnd).toBe(false)
  })

  it('produces a finite analysis when it does resolve a flight', () => {
    const result = measureJump(REAL_CLIP_FRAMES, REAL_CLIP_VIDEO)
    if (result.analysis) {
      expect(Number.isFinite(result.analysis.comHeightCm)).toBe(true)
      expect(Number.isFinite(result.analysis.statureM)).toBe(true)
    }
  })
})
