import { ref, type Ref } from 'vue'
import JSZip from 'jszip'

export interface BodyDetectionLandmark {
  x: number
  y: number
  score: number
}

export interface BodyDetectionFrame {
  time: number
  landmarks: BodyDetectionLandmark[]
}

export type ServerDetectionStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

/**
 * Plumbing-only: packages frames extracted directly from the video element
 * into a zip and uploads them to ai-lab's body_detection job type, then polls
 * for the result. Captures its own canvas snapshots rather than reusing
 * usePoseDetection.ts's scan() output, deliberately -- this composable proves
 * the server pipe works in isolation, independent of the existing MediaPipe
 * pipeline's own frame-sampling choices. Wiring the two together (sharing one
 * frame-extraction pass, feeding the result into measureJump) is explicitly
 * out of scope -- see docs/2026-08-05-server-body-detection-plumbing-design.md
 * section 7.
 */
export function useServerBodyDetection(
  videoRef: Ref<HTMLVideoElement | null>,
  baseUrl: string,
  apiKey: string,
) {
  const status = ref<ServerDetectionStatus>('idle')
  const result = ref<{ frames: BodyDetectionFrame[] } | null>(null)
  const error = ref<string | null>(null)

  const POLL_INTERVAL_MS = 1500
  const POLL_TIMEOUT_MS = 120_000
  // Every frame, at the video's own frame rate -- matches the "extract every
  // frame" choice usePoseDetection.ts's planFullPass already made for the
  // MediaPipe pipeline this composable is deliberately independent of, kept
  // consistent so a side-by-side comparison isn't confounded by different
  // sampling rates.
  const SAMPLE_STEP_SECONDS = 1 / 30

  async function extractFrames(video: HTMLVideoElement): Promise<{ time: number; blob: Blob }[]> {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    const frames: { time: number; blob: Blob }[] = []
    const duration = video.duration
    for (let t = 0; t < duration; t += SAMPLE_STEP_SECONDS) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = t
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob) frames.push({ time: t, blob })
    }
    return frames
  }

  async function packageZip(frames: { time: number; blob: Blob }[]): Promise<Blob> {
    const zip = new JSZip()
    const manifest = frames.map((f, index) => ({ index, time: f.time }))
    zip.file('manifest.json', JSON.stringify(manifest))
    frames.forEach((f, index) => {
      zip.file(`frame_${String(index).padStart(4, '0')}.jpg`, f.blob)
    })
    return zip.generateAsync({ type: 'blob' })
  }

  async function pollJob(jobId: string): Promise<{ frames: BodyDetectionFrame[] }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`Job status check failed: HTTP ${res.status}`)
      const job = await res.json() as { status: string; result?: { frames: BodyDetectionFrame[] }; error?: string }
      if (job.status === 'succeeded' && job.result) return job.result
      if (job.status === 'failed') throw new Error(job.error ?? 'Body-detection job failed')
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error('Timed out waiting for body-detection job to complete')
  }

  async function run(): Promise<void> {
    const video = videoRef.value
    if (!video) {
      error.value = 'No video loaded'
      status.value = 'error'
      return
    }

    error.value = null
    result.value = null

    try {
      status.value = 'uploading'
      const frames = await extractFrames(video)
      const zipBlob = await packageZip(frames)

      const form = new FormData()
      form.append('file', zipBlob, 'frames.zip')

      const uploadRes = await fetch(`${baseUrl}/v1/vision/body-detection/async`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      })
      if (!uploadRes.ok) throw new Error(`Upload failed: HTTP ${uploadRes.status}`)
      const job = await uploadRes.json() as { id: string }

      status.value = 'processing'
      result.value = await pollJob(job.id)
      status.value = 'done'
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      status.value = 'error'
    }
  }

  return { status, result, error, run }
}
