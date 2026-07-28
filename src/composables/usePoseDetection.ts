import { ref, type Ref } from 'vue'
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { planCoarsePass, planFinePass } from '../lib/framePlan'
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../lib/poseTypes'

export type DetectionStatus = 'idle' | 'loading' | 'scanning' | 'done' | 'error' | 'cancelled'

const ASSETS = `${import.meta.env.BASE_URL}mediapipe`

/** A foot this far above the clip's floor level counts as airborne. */
const COARSE_AIRBORNE_FRACTION = 0.02

/**
 * `fps` is only used to schedule which instants to sample. The measurement
 * itself never sees it: every frame is stamped with the `mediaTime` the
 * browser reports, so a wrong FPS costs a few redundant seeks, not accuracy.
 */
export function usePoseDetection(
  videoRef: Ref<HTMLVideoElement | null>,
  fps: Ref<number>
) {
  const status = ref<DetectionStatus>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)
  const result = ref<{ analysis: JumpAnalysis | null; verdict: Verdict } | null>(null)
  const scatter = ref<LandmarkScatter | null>(null)
  const frames = ref<PoseFrame[]>([])

  let landmarker: PoseLandmarker | null = null
  let abort: AbortController | null = null

  async function loadModel(): Promise<PoseLandmarker> {
    if (landmarker) return landmarker
    const vision = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`)
    const baseOptions = { modelAssetPath: `${ASSETS}/pose_landmarker_lite.task` }
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      })
    } catch {
      // Some browsers and older GPUs reject the WebGL delegate. CPU is slower
      // but always available, and the arithmetic is identical either way.
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      })
    }
    return landmarker
  }

  /**
   * Seeks, waits for the frame to actually be presented, and returns its true
   * presentation time. `seeked` alone only says the position moved — the new
   * picture may not be painted yet, and detecting then reads the old one.
   */
  function seekAndShow(video: HTMLVideoElement, time: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let settled = false
      const onError = () => {
        if (settled) return
        settled = true
        reject(new Error(`seek failed at ${time.toFixed(3)}s`))
      }
      video.addEventListener('error', onError, { once: true })
      video.requestVideoFrameCallback((_now, metadata) => {
        if (settled) return
        settled = true
        video.removeEventListener('error', onError)
        resolve(metadata.mediaTime)
      })
      video.currentTime = time
    })
  }

  function toPoseFrame(time: number, detection: PoseLandmarkerResult): PoseFrame | null {
    const pose = detection.landmarks[0]
    if (!pose || pose.length !== LANDMARK_COUNT) return null
    const landmarks: Landmark[] = pose.map((p) => ({ x: p.x, y: p.y }))
    return { time, landmarks }
  }

  async function scan(
    video: HTMLVideoElement, detector: PoseLandmarker, times: number[],
    signal: AbortSignal, onProgress: (done: number) => void
  ): Promise<PoseFrame[]> {
    const collected: PoseFrame[] = []
    for (let i = 0; i < times.length; i++) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError')
      const mediaTime = await seekAndShow(video, times[i]!)
      const frame = toPoseFrame(mediaTime, detector.detect(video))
      if (frame) collected.push(frame)
      onProgress(i + 1)
    }
    return collected
  }

  /**
   * Which coarse samples had a foot clear of the clip's floor level.
   *
   * A deliberately crude cousin of `findFlightPhase` — it only has to say
   * roughly where to look closer, so it skips the sub-frame work entirely.
   */
  function airborneIndices(coarse: PoseFrame[]): number[] {
    if (coarse.length === 0) return []
    const footY = coarse.map((f) =>
      Math.max(
        f.landmarks[LM.LEFT_HEEL]!.y, f.landmarks[LM.RIGHT_HEEL]!.y,
        f.landmarks[LM.LEFT_FOOT_INDEX]!.y, f.landmarks[LM.RIGHT_FOOT_INDEX]!.y
      )
    )
    const sorted = [...footY].sort((a, b) => a - b)
    const floor = sorted[Math.min(sorted.length - 1, Math.round(0.9 * (sorted.length - 1)))]!
    const noseY = coarse.map((f) => f.landmarks[LM.NOSE]!.y)
    const stature = Math.max(...footY.map((y, i) => y - noseY[i]!))
    const threshold = COARSE_AIRBORNE_FRACTION * stature
    const indices: number[] = []
    for (let i = 0; i < footY.length; i++) {
      if (floor - footY[i]! > threshold) indices.push(i)
    }
    return indices
  }

  /**
   * Two seeks can land on the same decoded frame — the fine pass schedules at
   * the nominal frame period, which drifts from the real one. Duplicated
   * timestamps would feed the same sample to the fit twice, quietly weighting
   * it double.
   */
  function dedupeByTime(collected: PoseFrame[]): PoseFrame[] {
    const seen = new Set<number>()
    const unique: PoseFrame[] = []
    for (const frame of collected) {
      const key = Math.round(frame.time * 1e6)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(frame)
    }
    return unique
  }

  async function run(): Promise<void> {
    const video = videoRef.value
    if (!video || !(video.duration > 0)) {
      error.value = 'Видео не готово'
      status.value = 'error'
      return
    }
    if (!('requestVideoFrameCallback' in video)) {
      error.value = 'Браузер не поддерживает покадровое чтение видео'
      status.value = 'error'
      return
    }

    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal

    error.value = null
    result.value = null
    scatter.value = null
    frames.value = []
    progress.value = 0
    status.value = 'loading'

    const wasPaused = video.paused
    const originalTime = video.currentTime

    try {
      const detector = await loadModel()
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError')

      video.pause()
      status.value = 'scanning'

      const rate = fps.value > 0 ? fps.value : 60
      const coarseTimes = planCoarsePass(video.duration, rate)
      const coarse = await scan(video, detector, coarseTimes, signal, (done) => {
        progress.value = (done / coarseTimes.length) * 0.5
      })

      const fineTimes = planFinePass(coarseTimes, airborneIndices(coarse), video.duration, rate)
      const fine = fineTimes.length === 0
        ? []
        : await scan(video, detector, fineTimes, signal, (done) => {
            progress.value = 0.5 + (done / fineTimes.length) * 0.5
          })

      const all = dedupeByTime([...coarse, ...fine].sort((a, b) => a.time - b.time))
      frames.value = all
      scatter.value = estimateScatter(all)
      result.value = measureJump(all, { width: video.videoWidth, height: video.videoHeight })
      progress.value = 1
      status.value = 'done'
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        status.value = 'cancelled'
      } else {
        error.value = caught instanceof Error ? caught.message : String(caught)
        status.value = 'error'
      }
    } finally {
      video.currentTime = originalTime
      if (!wasPaused) void video.play()
    }
  }

  function cancel(): void {
    abort?.abort()
  }

  return { status, progress, error, result, scatter, frames, run, cancel }
}
