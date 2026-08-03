import { describe, it, expect } from 'vitest'
import { BONES, JOINTS, buildSkeleton, findFrameAt } from './overlayGeometry'
import { LANDMARK_COUNT, type Landmark, type PoseFrame } from './poseTypes'

/** 33 ландмарки, каждая со своими различимыми координатами. */
function fakeLandmarks(): Landmark[] {
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => ({
    x: i / 100,
    y: 1 - i / 100,
  }))
}

describe('BONES', () => {
  it('references only real landmark indices', () => {
    for (const [a, b] of BONES) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(LANDMARK_COUNT)
      expect(b).toBeLessThan(LANDMARK_COUNT)
    }
  })

  it('never repeats a bone, in either direction', () => {
    const seen = new Set<string>()
    for (const [a, b] of BONES) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('never joins a landmark to itself', () => {
    for (const [a, b] of BONES) expect(a).not.toBe(b)
  })
})

describe('JOINTS', () => {
  it('is exactly the set of landmarks the bones touch', () => {
    const fromBones = new Set<number>()
    for (const [a, b] of BONES) {
      fromBones.add(a)
      fromBones.add(b)
    }
    expect([...JOINTS].sort((x, y) => x - y)).toEqual([...fromBones].sort((x, y) => x - y))
  })

  it('has no duplicates', () => {
    expect(new Set(JOINTS).size).toBe(JOINTS.length)
  })
})

describe('buildSkeleton', () => {
  it('places every bone on the landmarks it names', () => {
    const landmarks = fakeLandmarks()
    const skeleton = buildSkeleton(landmarks)!
    expect(skeleton.bones.length).toBe(BONES.length)
    BONES.forEach(([a, b], i) => {
      expect(skeleton.bones[i]!.a).toEqual({ x: landmarks[a]!.x, y: landmarks[a]!.y })
      expect(skeleton.bones[i]!.b).toEqual({ x: landmarks[b]!.x, y: landmarks[b]!.y })
    })
  })

  it('returns the centre of mass alongside the joints', () => {
    const skeleton = buildSkeleton(fakeLandmarks())!
    expect(skeleton.joints.length).toBe(JOINTS.length)
    expect(Number.isFinite(skeleton.com.x)).toBe(true)
    expect(Number.isFinite(skeleton.com.y)).toBe(true)
  })

  it('refuses a frame that is not a full pose', () => {
    expect(buildSkeleton([])).toBeNull()
    expect(buildSkeleton(fakeLandmarks().slice(0, 10))).toBeNull()
  })
})

describe('findFrameAt', () => {
  const frames: PoseFrame[] = [0, 0.1, 0.2, 0.3].map((time) => ({
    time,
    landmarks: fakeLandmarks(),
  }))

  it('returns the nearest frame within the gap', () => {
    expect(findFrameAt(frames, 0.19, 0.02)!.time).toBeCloseTo(0.2, 10)
    expect(findFrameAt(frames, 0.21, 0.02)!.time).toBeCloseTo(0.2, 10)
  })

  it('prefers the earlier frame when it is nearer', () => {
    expect(findFrameAt(frames, 0.12, 0.05)!.time).toBeCloseTo(0.1, 10)
  })

  it('returns null when the nearest frame is further than the gap', () => {
    expect(findFrameAt(frames, 0.15, 0.02)).toBeNull()
    expect(findFrameAt(frames, 5, 0.02)).toBeNull()
  })

  it('handles the ends of the clip', () => {
    expect(findFrameAt(frames, -1, 0.02)).toBeNull()
    expect(findFrameAt(frames, 0, 0.02)!.time).toBe(0)
    expect(findFrameAt(frames, 0.3, 0.02)!.time).toBeCloseTo(0.3, 10)
  })

  it('returns null for an empty clip', () => {
    expect(findFrameAt([], 0, 1)).toBeNull()
  })
})
