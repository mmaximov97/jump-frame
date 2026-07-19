import { ref, shallowRef } from 'vue'

export type ShareFormat = 'scale' | 'photo' | 'stats'

export interface CandidateFrame {
  frameIndex: number
  canvas: HTMLCanvasElement
}

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1920
const FRAME_OFFSETS = [-3, -2, -1, 0, 1, 2, 3]

const BG_DARK = '#1e1e2e'
const BG_BRAND_DEEP = '#1d3a7a'
const TEXT_LIGHT = '#f8fafc'
const TEXT_MUTED = 'rgba(248, 250, 252, 0.75)'
const BRAND_LIGHT = '#60a5fa'

export function useShareCard() {
  const isLoading = ref(true)
  const loadError = ref(false)
  const candidates = shallowRef<CandidateFrame[]>([])
  const selectedIndex = ref(0)
  const format = ref<ShareFormat>('scale')

  const canShareFiles = (() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
    try {
      const probe = new File([''], 'probe.png', { type: 'image/png' })
      return navigator.canShare({ files: [probe] })
    } catch {
      return false
    }
  })()

  async function extractFrames(videoSrc: string, takeoffFrame: number, landingFrame: number, fps: number) {
    isLoading.value = true
    loadError.value = false
    candidates.value = []

    try {
      const video = document.createElement('video')
      video.src = videoSrc
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'

      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('Could not load video for frame extraction')), { once: true })
      })

      const peakFrame = takeoffFrame + Math.round((landingFrame - takeoffFrame) / 2)
      const maxFrame = Math.max(0, Math.floor(video.duration * fps) - 1)
      const clampedPeak = Math.min(maxFrame, Math.max(0, peakFrame))

      const seen = new Set<number>()
      const frames: CandidateFrame[] = []

      for (const offset of FRAME_OFFSETS) {
        const frameIndex = Math.min(maxFrame, Math.max(0, peakFrame + offset))
        if (seen.has(frameIndex)) continue
        seen.add(frameIndex)

        const time = Math.min(frameIndex / fps, Math.max(0, video.duration - 0.001))
        await new Promise<void>((resolve) => {
          video.addEventListener('seeked', () => resolve(), { once: true })
          video.currentTime = time
        })

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D context unavailable')
        ctx.drawImage(video, 0, 0)

        frames.push({ frameIndex, canvas })
      }

      if (frames.length === 0) throw new Error('No frames extracted')

      candidates.value = frames
      const peakIdx = frames.findIndex((f) => f.frameIndex === clampedPeak)
      selectedIndex.value = peakIdx >= 0 ? peakIdx : Math.floor(frames.length / 2)
    } catch {
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number
  ) {
    const scale = Math.max(dWidth / source.width, dHeight / source.height)
    const w = source.width * scale
    const h = source.height * scale
    ctx.drawImage(source, dx + (dWidth - w) / 2, dy + (dHeight - h) / 2, w, h)
  }

  function renderCard(
    ctx: CanvasRenderingContext2D,
    frame: CandidateFrame,
    fmt: ShareFormat,
    heightLabel: string,
    flightLabel: string,
    dateLabel: string
  ) {
    ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'

    if (fmt === 'stats') {
      const bg = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
      bg.addColorStop(0, BG_DARK)
      bg.addColorStop(1, BG_BRAND_DEEP)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

      ctx.fillStyle = TEXT_LIGHT
      ctx.font = '700 240px system-ui, -apple-system, sans-serif'
      ctx.fillText(heightLabel, CARD_WIDTH / 2, 800)

      ctx.font = '500 52px system-ui, sans-serif'
      ctx.fillStyle = TEXT_MUTED
      ctx.fillText(`Flight time · ${flightLabel}`, CARD_WIDTH / 2, 930)
      ctx.fillText(dateLabel, CARD_WIDTH / 2, 1010)

      ctx.font = '700 44px system-ui, sans-serif'
      ctx.fillStyle = TEXT_MUTED
      ctx.fillText('FrameJump', CARD_WIDTH / 2, CARD_HEIGHT - 120)
      return
    }

    drawCoverImage(ctx, frame.canvas, 0, 0, CARD_WIDTH, CARD_HEIGHT)

    const gradH = 640
    const shade = ctx.createLinearGradient(0, CARD_HEIGHT - gradH, 0, CARD_HEIGHT)
    shade.addColorStop(0, 'rgba(10, 10, 18, 0)')
    shade.addColorStop(1, 'rgba(10, 10, 18, 0.88)')
    ctx.fillStyle = shade
    ctx.fillRect(0, CARD_HEIGHT - gradH, CARD_WIDTH, gradH)

    ctx.fillStyle = TEXT_MUTED
    ctx.font = '700 40px system-ui, sans-serif'
    ctx.fillText('FrameJump', CARD_WIDTH / 2, CARD_HEIGHT - 90)

    if (fmt === 'photo') {
      ctx.fillStyle = TEXT_LIGHT
      ctx.font = '700 150px system-ui, sans-serif'
      ctx.fillText(heightLabel, CARD_WIDTH / 2, CARD_HEIGHT - 210)
      return
    }

    // Scale format — decorative vertical bar, not tied to real-world scale.
    const barX = CARD_WIDTH - 170
    const barBottom = CARD_HEIGHT - 280
    const barTop = CARD_HEIGHT * 0.3

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)'
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(barX, barBottom)
    ctx.lineTo(barX, barTop)
    ctx.stroke()

    const tickCount = 6
    for (let i = 0; i <= tickCount; i++) {
      const y = barBottom - (i / tickCount) * (barBottom - barTop)
      const tickWidth = i % 3 === 0 ? 36 : 20
      ctx.beginPath()
      ctx.moveTo(barX - tickWidth / 2, y)
      ctx.lineTo(barX + tickWidth / 2, y)
      ctx.stroke()
    }

    ctx.fillStyle = BRAND_LIGHT
    ctx.beginPath()
    ctx.arc(barX, barTop, 16, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = TEXT_LIGHT
    ctx.font = '700 92px system-ui, sans-serif'
    ctx.fillText(heightLabel, barX, barTop - 46)
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function shareOrDownload(canvas: HTMLCanvasElement, filename: string) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not export image')

    if (canShareFiles) {
      const file = new File([blob], filename, { type: 'image/png' })
      try {
        await navigator.share({ files: [file], title: 'FrameJump' })
        return
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        // Real share failure (not a user cancel) — fall back to a download so the result isn't lost.
        downloadBlob(blob, filename)
        return
      }
    }

    downloadBlob(blob, filename)
  }

  return {
    CARD_WIDTH,
    CARD_HEIGHT,
    isLoading,
    loadError,
    candidates,
    selectedIndex,
    format,
    canShareFiles,
    extractFrames,
    renderCard,
    shareOrDownload,
  }
}
