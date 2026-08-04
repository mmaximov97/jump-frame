import { describe, it, expect } from 'vitest'
import { BONES, JOINTS, buildSkeleton, findFrameAt, buildFlightGeometry } from './overlayGeometry'
import { LANDMARK_COUNT, type Landmark, type PoseFrame, type VideoSize } from './poseTypes'
import { measureJump } from './jumpFromCom'
import { centreOfMass } from './bodyModel'
import { generateJump } from './testing/syntheticJumper'

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
  const FPS = 60
  const GAP = 1 / FPS
  const COARSE_STRIDE = 6

  function clip(times: number[]): PoseFrame[] {
    return times.map((time) => ({ time, landmarks: fakeLandmarks() }))
  }

  /** What the coarse pass alone leaves behind: every COARSE_STRIDE-th frame. */
  function coarseOnly(seconds: number): number[] {
    const times: number[] = []
    for (let n = 0; (n * COARSE_STRIDE) / FPS < seconds; n++) {
      times.push((n * COARSE_STRIDE) / FPS)
    }
    return times
  }

  /** Coarse across the clip, plus every frame in [from, to) — a real scan. */
  function coarseWithDenseWindow(seconds: number, from: number, to: number): number[] {
    const dense: number[] = []
    for (let n = Math.ceil(from * FPS); n < to * FPS; n++) dense.push(n / FPS)
    return [...new Set([...coarseOnly(seconds), ...dense])].sort((a, b) => a - b)
  }

  const run = clip([0, 1, 2, 3, 4].map((n) => n / FPS))

  it('returns the nearest sample inside a densely sampled run', () => {
    expect(findFrameAt(run, 2 / FPS, GAP)!.time).toBeCloseTo(2 / FPS, 10)
    expect(findFrameAt(run, 2.4 / FPS, GAP)!.time).toBeCloseTo(2 / FPS, 10)
  })

  it('prefers the earlier sample when it is nearer', () => {
    expect(findFrameAt(run, 1.4 / FPS, GAP)!.time).toBeCloseTo(1 / FPS, 10)
  })

  it('draws nothing anywhere on a clip the dense pass never ran on', () => {
    const frames = clip(coarseOnly(10))
    for (let n = 0; n < 10 * FPS; n++) {
      expect(findFrameAt(frames, n / FPS, GAP)).toBeNull()
    }
  })

  it('draws across the dense window and nowhere else', () => {
    const frames = clip(coarseWithDenseWindow(10, 2.6, 3.4))
    const drawn: number[] = []
    for (let n = 0; n < 10 * FPS; n++) {
      if (findFrameAt(frames, n / FPS, GAP)) drawn.push(n / FPS)
    }
    expect(drawn.length).toBeGreaterThan(40)
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(2.6)
    expect(Math.max(...drawn)).toBeLessThan(3.4)
  })

  it('returns null when the nearest sample is further than the gap', () => {
    expect(findFrameAt(run, 10, GAP)).toBeNull()
  })

  it('returns null at the ends of a run, where density cannot be established', () => {
    expect(findFrameAt(run, 0, GAP)).toBeNull()
    expect(findFrameAt(run, 4 / FPS, GAP)).toBeNull()
  })

  it('returns null for an empty clip', () => {
    expect(findFrameAt([], 0, GAP)).toBeNull()
  })
})

describe('buildFlightGeometry', () => {
  const video: VideoSize = { width: 1080, height: 1920 }
  const clip = generateJump({
    jumpHeightM: 0.5,
    scalePxPerM: 600,
    fps: 60,
    videoWidth: video.width,
    videoHeight: video.height,
  })
  const { analysis } = measureJump(clip.frames, video)

  it('has an analysis to work from', () => {
    expect(analysis).not.toBeNull()
  })

  it('recovers the same height the analysis reported', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    const riseCm =
      (((geometry.takeoffY - geometry.apexY) * video.height) / geometry.scalePxPerM) * 100
    expect(riseCm).toBeCloseTo(analysis!.comHeightCm, 6)
  })

  it('puts the apex above the takeoff level', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    // y grows downward, so "above" means a smaller y.
    expect(geometry.apexY).toBeLessThan(geometry.takeoffY)
  })

  it('samples the curve in increasing time order, spanning the flight', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    expect(geometry.curve.length).toBeGreaterThan(10)
    const ys = geometry.curve.map((p) => p.y)
    // The curve dips (y decreases) then rises again — one turning point only.
    const lowest = Math.min(...ys)
    const apexAt = ys.indexOf(lowest)
    expect(apexAt).toBeGreaterThan(0)
    expect(apexAt).toBeLessThan(ys.length - 1)
    // A sampled parabola cannot dip below its own vertex, so the lowest
    // sample sits just above the fitted apex — never below it. The gap is
    // pure discretisation: at CURVE_SAMPLES points across the flight it is
    // well under a tenth of a pixel, but it is not zero, and asserting
    // equality to four decimals would make the sample count answerable to
    // the test rather than to how the curve should look on screen.
    expect(lowest).toBeGreaterThanOrEqual(geometry.apexY)
    expect(lowest).toBeCloseTo(geometry.apexY, 3)
  })

  it('draws a trail spanning takeoff to landing', () => {
    const geometry = buildFlightGeometry(clip.frames, video, analysis!)!
    expect(geometry.trail.length).toBeGreaterThan(5)
    for (const point of geometry.trail) {
      expect(point.x).toBeGreaterThan(0)
      expect(point.x).toBeLessThan(1)
      expect(point.y).toBeGreaterThan(0)
      expect(point.y).toBeLessThan(1)
    }
  })

  it('keeps the trail aligned with the curve when frames are malformed', () => {
    // Blank out a few poses early in the clip. buildComTrack skips them, so
    // sample indices shift — a trail built from `frames` directly would slide
    // out from under the parabola.
    const damaged = clip.frames.map((frame, i) =>
      i % 17 === 0 && i < 20 ? { time: frame.time, landmarks: [] } : frame
    )
    const damagedAnalysis = measureJump(damaged, video).analysis!
    const geometry = buildFlightGeometry(damaged, video, damagedAnalysis)!

    // The height comes from the fit, which comes from the track — it cannot
    // detect a misaligned trail. These assertions can: they check the trail
    // against the same filtered array buildComTrack indexes.
    const usable = damaged.filter((f) => f.landmarks.length === LANDMARK_COUNT)
    expect(geometry.trail.length).toBe(
      damagedAnalysis.landingSampleIndex - damagedAnalysis.takeoffSampleIndex + 1
    )
    geometry.trail.forEach((point, i) => {
      const source = usable[damagedAnalysis.takeoffSampleIndex + i]!
      expect(point.x).toBeCloseTo(centreOfMass(source.landmarks).x, 12)
    })
  })

  it('returns null when the flight window is too short to fit', () => {
    const stub = { ...analysis!, takeoffSampleIndex: 10, landingSampleIndex: 12 }
    expect(buildFlightGeometry(clip.frames, video, stub)).toBeNull()
  })

  it('returns null on a degenerate video size', () => {
    expect(buildFlightGeometry(clip.frames, { width: 0, height: 0 }, analysis!)).toBeNull()
  })

  it('returns null on an empty clip', () => {
    expect(buildFlightGeometry([], video, analysis!)).toBeNull()
  })

  it('ignores frames that are not full poses without throwing', () => {
    const blanked = clip.frames.map((f) => ({
      time: f.time,
      landmarks: f.landmarks.slice(0, LANDMARK_COUNT - 1),
    }))
    expect(buildFlightGeometry(blanked, video, analysis!)).toBeNull()
  })
})
