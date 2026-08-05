import { onUnmounted, ref, watch, type Ref } from 'vue'
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { planCoarsePass, planFinePass } from '../lib/framePlan'
import { estimateScatter, type LandmarkScatter } from '../lib/landmarkScatter'
import { measureJump, type JumpAnalysis, type Verdict } from '../lib/jumpFromCom'
import { ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, FLOOR_PERCENTILE } from '../lib/flightPhase'
import { STANDING_PERCENTILE } from '../lib/comTrack'
import { rollingMedian, rollingPercentile } from '../lib/stats'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame } from '../lib/poseTypes'

export type DetectionStatus = 'idle' | 'loading' | 'scanning' | 'done' | 'error' | 'cancelled'

const ASSETS = `${import.meta.env.BASE_URL}mediapipe`

/** A foot this far above the clip's floor level counts as airborne. */
const COARSE_AIRBORNE_FRACTION = 0.02

/**
 * Loosens the detector's default 0.5 confidence gate on real footage where
 * MediaPipe otherwise loses the person outright — measured on a clip shot
 * from behind: default confidence found a full pose in 81 of 156 frames;
 * lowering both gates to 0.1 found 104. The gap matters most exactly where
 * detection is worst: in the single hardest ~1 s stretch of that clip, 0.1
 * recovered 19 of 34 frames against 3 at the default.
 *
 * Raising the model tier (lite → full → heavy) does not substitute for this:
 * all three bundle the identical pose_detector.tflite (the stage that decides
 * whether a person is there at all) and differ only in the landmark
 * regressor that runs after a detection succeeds — on that same clip, lite
 * through heavy recovered 81, 83 and 89 of 156, and in the hardest stretch
 * only 3, 2 and 3 of 34. The confidence gate is the lever that actually
 * moves; the model tier is not.
 *
 * A lower gate does admit noisier frames, but nothing downstream trusts a
 * frame just because it was detected: `assess()`'s plausibility checks
 * (stature bounds, fit R², flight-time agreement) exist precisely to catch a
 * bad frame's fallout, and reject or flag the measurement rather than report
 * it as clean.
 */
const DETECTION_CONFIDENCE = {
  minPoseDetectionConfidence: 0.1,
  minPosePresenceConfidence: 0.1,
}

/**
 * How long a single seek may go without a presented frame before it is
 * treated as stuck. `requestVideoFrameCallback` can simply never fire — a
 * seek past the end, or a decode failure that raises no `error` event — and
 * without a timeout that hangs the whole scan with no diagnostic and a
 * cancel button that does nothing about it.
 *
 * This does NOT reliably cover a backgrounded tab: browsers clamp or fully
 * suspend timers (and video decode) for hidden tabs, so this timer can
 * itself fire much later than 5 s, or not until the tab is foregrounded
 * again. It only guards the foregrounded case.
 */
const SEEK_TIMEOUT_MS = 5000

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
  // The in-flight load, memoised separately from the finished model: two
  // overlapping run() calls before the first load finishes must share one
  // `createFromOptions` call, not each start their own and leak the loser.
  let loadingModel: Promise<PoseLandmarker> | null = null
  let abort: AbortController | null = null
  // Set once, on unmount. Distinct from `abort`: a plain cancel() re-uses the
  // same run's controller (just aborted), but disposal must permanently shut
  // the whole composable down — no run started before or after it may ever
  // touch `status`/`result`/etc. again.
  let disposed = false
  // The video's position/play state from the moment the composable was last
  // idle, captured once per idle→busy transition rather than once per run —
  // see `run()`'s comment at the capture site for why.
  let savedVideoState: { time: number; wasPaused: boolean } | null = null

  /**
   * Creates a fresh `PoseLandmarker`, falling back from GPU to CPU delegate.
   * Closes it again, unused, if the composable was disposed while this was
   * in flight — `onUnmounted` only runs once, so nothing else ever would.
   */
  async function createLandmarker(): Promise<PoseLandmarker> {
    const vision = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`)
    const baseOptions = { modelAssetPath: `${ASSETS}/pose_landmarker_lite.task` }
    let created: PoseLandmarker
    try {
      created = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
        ...DETECTION_CONFIDENCE,
      })
    } catch {
      // Some browsers and older GPUs reject the WebGL delegate. CPU is slower
      // but always available, and the arithmetic is identical either way.
      created = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
        ...DETECTION_CONFIDENCE,
      })
    }
    if (disposed) {
      created.close()
      throw new DOMException('cancelled', 'AbortError')
    }
    landmarker = created
    return landmarker
  }

  /**
   * Loads the model once and caches it for the composable's lifetime.
   * Memoises the in-flight *promise*, not just the finished result — without
   * that, two overlapping run() calls each start their own
   * `createFromOptions` before the first resolves, and only one of the two
   * resulting instances ever gets referenced again, leaking the other's WASM
   * heap and GPU context for the page's lifetime. Cleared again once the
   * load settles, success or failure, so a rejected load does not poison
   * every later attempt.
   */
  async function loadModel(): Promise<PoseLandmarker> {
    if (landmarker) return landmarker
    if (!loadingModel) {
      loadingModel = createLandmarker().finally(() => {
        loadingModel = null
      })
    }
    return loadingModel
  }

  /**
   * Seeks, waits for the frame to actually be presented, and returns its true
   * presentation time. `seeked` alone only says the position moved — the new
   * picture may not be painted yet, and detecting then reads the old one.
   *
   * Settles three ways: the frame is presented, `signal` aborts, or
   * `SEEK_TIMEOUT_MS` elapses with neither. Listeners and the timer are torn
   * down on every exit path so a settled call never fires twice.
   */
  function seekAndShow(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<number> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('cancelled', 'AbortError'))
        return
      }

      let settled = false
      let rvfcHandle: number | null = null

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        video.removeEventListener('error', onError)
        signal.removeEventListener('abort', onAbort)
        clearTimeout(timeoutId)
        if (rvfcHandle !== null) video.cancelVideoFrameCallback(rvfcHandle)
        fn()
      }
      const onError = () => finish(() => reject(new Error(`seek failed at ${time.toFixed(3)}s`)))
      const onAbort = () => finish(() => reject(new DOMException('cancelled', 'AbortError')))
      const timeoutId = setTimeout(() => {
        finish(() => reject(new Error(`video stopped responding while seeking to ${time.toFixed(3)}s (timed out after ${SEEK_TIMEOUT_MS}ms)`)))
      }, SEEK_TIMEOUT_MS)

      video.addEventListener('error', onError, { once: true })
      signal.addEventListener('abort', onAbort, { once: true })
      rvfcHandle = video.requestVideoFrameCallback((_now, metadata) => {
        finish(() => resolve(metadata.mediaTime))
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
    signal: AbortSignal, isCurrent: () => boolean, onProgress: (done: number) => void
  ): Promise<PoseFrame[]> {
    const collected: PoseFrame[] = []
    for (let i = 0; i < times.length; i++) {
      if (signal.aborted || !isCurrent()) throw new DOMException('cancelled', 'AbortError')
      const mediaTime = await seekAndShow(video, times[i]!, signal)
      // Re-check right here, not just at the top of the loop: the await
      // above is exactly the window where a supersede, a disposal (which
      // closes the detector), or a video swap can land.
      if (signal.aborted || !isCurrent()) throw new DOMException('cancelled', 'AbortError')
      const frame = toPoseFrame(mediaTime, detector.detect(video))
      if (frame) collected.push(frame)
      if (isCurrent()) onProgress(i + 1)
    }
    return collected
  }

  /**
   * Same displacement test the pixel-space version below uses, applied once
   * with a given floor/stature source. Shared so the global and rolling
   * passes below can only differ in what floor/stature they read, never in
   * how a sample gets classified from them.
   */
  function classify(
    footY: number[], floor: (i: number) => number, stature: (i: number) => number
  ): number[] {
    const indices: number[] = []
    for (let i = 0; i < footY.length; i++) {
      const s = stature(i)
      if (!(s > 0)) continue
      if (floor(i) - footY[i]! > COARSE_AIRBORNE_FRACTION * s) indices.push(i)
    }
    return indices
  }

  /**
   * Which coarse samples had a foot clear of the clip's floor level.
   *
   * A deliberately crude cousin of `findFlightPhase` — it only has to say
   * roughly where to look closer, so it skips the sub-frame work entirely.
   *
   * Global floor/stature first, exactly as before this fallback existed.
   * Rolling is tried only if the global pass finds nothing, or finds a
   * stretch that runs to the very last coarse sample without coming back
   * down — the same failure shape flightPhase.ts's own rolling fallback
   * exists for (see its docstring): the athlete's distance to the camera
   * changed during the clip, so the whole-clip floor no longer describes
   * "standing" anywhere past where it was measured. See the
   * running-approach-jump design doc.
   */
  function airborneIndices(coarse: PoseFrame[]): number[] {
    if (coarse.length === 0) return []
    const footY = coarse.map((f) =>
      Math.max(
        f.landmarks[LM.LEFT_HEEL]!.y, f.landmarks[LM.RIGHT_HEEL]!.y,
        f.landmarks[LM.LEFT_FOOT_INDEX]!.y, f.landmarks[LM.RIGHT_FOOT_INDEX]!.y
      )
    )
    const noseY = coarse.map((f) => f.landmarks[LM.NOSE]!.y)
    const spans = footY.map((y, i) => y - noseY[i]!)

    const sorted = [...footY].sort((a, b) => a - b)
    const globalFloor = sorted[Math.min(sorted.length - 1, Math.round(FLOOR_PERCENTILE * (sorted.length - 1)))]!
    // Deliberately a different statistic than the rolling pass below
    // (max vs. a percentile) -- this composable is a coarse heuristic for
    // where to sample densely, not the final measurement (see
    // findFlightPhase for that), and changing this to match would be a
    // behavior change, not a naming cleanup.
    const globalStature = Math.max(...spans)
    // A degenerate detection (nose at or below foot level in every frame)
    // sends the threshold to zero or negative, which then reads nearly every
    // sample as airborne — measured: 50 of 50 fine-pass seeks, roughly six
    // times the detector calls, before the pipeline downstream correctly
    // refuses the result anyway. Refuse to flag anything here instead, on
    // either pass — a nose reading at or below the foot is not something a
    // rolling window fixes.
    if (!(globalStature > 0)) return []

    const globalIndices = classify(footY, () => globalFloor, () => globalStature)
    if (globalIndices.length > 0 && globalIndices[globalIndices.length - 1]! < footY.length - 1) {
      return globalIndices
    }

    const times = coarse.map((f) => f.time)
    const rollingFloor = rollingMedian(times, footY, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS)
    const rollingStature = rollingPercentile(times, spans, ROLLING_WINDOW_SECONDS, MIN_ROLLING_POINTS, STANDING_PERCENTILE)
    const rollingIndices = classify(
      footY,
      (i) => rollingFloor[i] ?? globalFloor,
      (i) => rollingStature[i] ?? globalStature
    )
    return rollingIndices.length > 0 ? rollingIndices : globalIndices
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
    if (disposed) return

    const video = videoRef.value

    abort?.abort()
    const myAbort = new AbortController()
    abort = myAbort
    const signal = myAbort.signal
    // True only while this call is the composable's current run: not
    // superseded by a later run(), not disposed, and still pointed at the
    // same video element it started with. Every write to shared state must
    // go through this — otherwise a stale run's completion can clobber a
    // newer run's status, move the video out from under a newer run's own
    // seeking, or publish a result for a clip the caller has already
    // replaced.
    const isCurrent = () => !disposed && abort === myAbort && videoRef.value === video

    if (!video || !(Number.isFinite(video.duration) && video.duration > 0)) {
      // `duration` reads `Infinity` for a freshly recorded MediaRecorder
      // WebM in Chrome until the file has been seeked to the end at least
      // once. `planCoarsePass`'s loop would never terminate against that,
      // and — being synchronous — that hang is unreachable by cancel(), the
      // abort signal, or the seek timeout. Refuse it outright.
      if (isCurrent()) {
        error.value = 'Видео не готово'
        status.value = 'error'
      }
      return
    }
    if (!('requestVideoFrameCallback' in video)) {
      if (isCurrent()) {
        error.value = 'Браузер не поддерживает покадровое чтение видео'
        status.value = 'error'
      }
      return
    }

    error.value = null
    result.value = null
    scatter.value = null
    frames.value = []
    progress.value = 0
    status.value = 'loading'

    // Captured once per idle→busy transition, not once per run(): a second
    // run() that supersedes a first must restore the position the user was
    // actually at before either run touched the video, not the first run's
    // already-paused, already-seeked position. Cleared again in `finally`,
    // by whichever run is current when the chain finally ends — and by the
    // videoRef watcher below if the video itself changes mid-chain.
    if (savedVideoState === null) {
      savedVideoState = { time: video.currentTime, wasPaused: video.paused }
    }

    try {
      const detector = await loadModel()
      if (!isCurrent()) return
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError')

      video.pause()
      status.value = 'scanning'

      const rate = fps.value > 0 ? fps.value : 60
      const coarseTimes = planCoarsePass(video.duration, rate)
      const coarse = await scan(video, detector, coarseTimes, signal, isCurrent, (done) => {
        progress.value = (done / coarseTimes.length) * 0.5
      })

      const fineTimes = planFinePass(coarseTimes, airborneIndices(coarse), video.duration, rate)
      const fine = fineTimes.length === 0
        ? []
        : await scan(video, detector, fineTimes, signal, isCurrent, (done) => {
            progress.value = 0.5 + (done / fineTimes.length) * 0.5
          })

      if (!isCurrent()) return

      const all = dedupeByTime([...coarse, ...fine].sort((a, b) => a.time - b.time))
      frames.value = all
      scatter.value = estimateScatter(all)
      result.value = measureJump(all, { width: video.videoWidth, height: video.videoHeight })
      progress.value = 1
      status.value = 'done'
    } catch (caught) {
      if (!isCurrent()) return
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        status.value = 'cancelled'
      } else {
        error.value = caught instanceof Error ? caught.message : String(caught)
        status.value = 'error'
      }
    } finally {
      if (isCurrent()) {
        const saved = savedVideoState
        savedVideoState = null
        if (saved) {
          video.currentTime = saved.time
          if (!saved.wasPaused) {
            video.play().catch(() => {
              // Autoplay can be refused outside a user gesture
              // (NotAllowedError). There's nothing more to do about it here.
            })
          }
        }
      }
    }
  }

  /**
   * Moves a live run to a terminal status without waiting for that run's own
   * completion to notice the abort. Two callers need this, for two different
   * reasons:
   *
   * - `cancel()`: the abort signal cannot interrupt a model download already
   *   in flight (the MediaPipe loader takes no signal), so without this,
   *   cancelling during 'loading' would leave the status on 'loading' until
   *   the download finishes on its own.
   * - the `videoRef` watcher below: a run whose video just changed can no
   *   longer satisfy its own `isCurrent()` check (`videoRef.value === video`
   *   is now false), so that run's `catch`/`finally` bail out silently and
   *   never write a terminal status at all — not "eventually", never. Without
   *   this, swapping the video mid-scan (any route: `startNewVideo`, but also
   *   any other view that unmounts the video element, e.g. the guide or share
   *   screens) leaves `status` stuck on 'loading'/'scanning' forever, with a
   *   progress bar and Cancel button that no longer do anything.
   *
   * Guarded on the *current* `status` (not e.g. "is `abort` non-null and not
   * yet aborted") specifically so calling this after a run has already
   * finished naturally (`status` is `'done'`/`'error'`, `abort` still points
   * at that now-inert, never-aborted controller) can't retroactively relabel
   * a legitimate result as `'cancelled'` — and so the watcher firing for an
   * unrelated reason (e.g. the very first video load, going from `null` to
   * an element, with `status` still `'idle'`) is a no-op.
   */
  function finalizeAbortedRun(): void {
    if (!disposed && (status.value === 'loading' || status.value === 'scanning')) {
      status.value = 'cancelled'
    }
  }

  function cancel(): void {
    finalizeAbortedRun()
    abort?.abort()
  }

  // A different (or cleared) video element means whatever run is in flight
  // is scanning a clip the caller has already discarded. Finalize the status
  // (see finalizeAbortedRun's docstring — this is the case it exists for)
  // and abort immediately — the abort signal unblocks a wedged seek in the
  // same tick — rather than letting the loop grind through its remaining,
  // now-pointless samples. Also drop any saved restore state: it belongs to
  // the old video, and the next run() (on whatever video is current now)
  // must capture its own.
  watch(videoRef, () => {
    finalizeAbortedRun()
    abort?.abort()
    savedVideoState = null
  }, { flush: 'sync' })

  onUnmounted(() => {
    disposed = true
    abort?.abort()
    landmarker?.close()
    landmarker = null
  })

  return { status, progress, error, result, scatter, frames, run, cancel }
}
