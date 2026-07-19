const THUMB_WIDTH = 160
const SEEK_TIMEOUT_MS = 1000

// Grabs a downscaled JPEG snapshot of the video at `targetTime`, then
// restores playback position — used to store one small preview frame per
// jump in history without ever persisting the video itself.
export function captureFrameThumbnail(
  video: HTMLVideoElement,
  targetTime: number
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!video || !isFinite(targetTime) || !video.videoWidth || !video.videoHeight) {
      resolve(null)
      return
    }

    const originalTime = video.currentTime
    let settled = false

    function finish(dataUrl: string | null) {
      if (settled) return
      settled = true
      video.removeEventListener('seeked', onSeeked)
      clearTimeout(timeoutId)
      video.currentTime = originalTime
      resolve(dataUrl)
    }

    function grabFrame(): string | null {
      try {
        const width = THUMB_WIDTH
        const height = Math.round(video.videoHeight * (width / video.videoWidth))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(video, 0, 0, width, height)
        return canvas.toDataURL('image/jpeg', 0.6)
      } catch {
        return null
      }
    }

    function onSeeked() {
      finish(grabFrame())
    }

    const timeoutId = setTimeout(() => finish(null), SEEK_TIMEOUT_MS)

    if (Math.abs(video.currentTime - targetTime) < 1e-3) {
      finish(grabFrame())
      return
    }

    video.addEventListener('seeked', onSeeked)
    video.currentTime = targetTime
  })
}
