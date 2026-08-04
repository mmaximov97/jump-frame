import { ref, watch, type Ref } from 'vue'
import type { JumpAnalysis } from '../lib/jumpFromCom'

/**
 * Playback rate for the replay. A flight lasts 0.4–0.6 s; at 1x the loop is
 * over before the eye settles on it, and judging whether the skeleton tracked
 * the body is the entire point of showing it.
 */
const REPLAY_RATE = 0.5

/** Extra time either side, so the takeoff itself is visible, not just the hang. */
const REPLAY_MARGIN_SECONDS = 0.15

export function useFlightReplay(
  videoRef: Ref<HTMLVideoElement | null>,
  analysis: Ref<JumpAnalysis | null>
) {
  const isReplaying = ref(false)

  let rateBeforeReplay = 1
  let from = 0
  let to = 0

  /**
   * The element the listener and the slowed playbackRate were applied to.
   *
   * Held separately from `videoRef` because `watch(videoRef, stop)` fires after
   * the ref has already been reassigned: reading `videoRef.value` inside stop()
   * would clean up the incoming element and leave the outgoing one listening,
   * still at the replay rate.
   */
  let attachedTo: HTMLVideoElement | null = null

  function stop() {
    if (!isReplaying.value) return
    isReplaying.value = false

    const video = attachedTo
    attachedTo = null
    if (!video) return
    video.removeEventListener('timeupdate', onTimeUpdate)
    video.playbackRate = rateBeforeReplay
    video.pause()
  }

  function onTimeUpdate() {
    const video = attachedTo
    if (!video || !isReplaying.value) return
    if (video.currentTime >= to) video.currentTime = from
  }

  function start() {
    const video = videoRef.value
    const result = analysis.value
    if (!video || !result || !(video.duration > 0)) return

    from = Math.max(0, result.takeoffTime - REPLAY_MARGIN_SECONDS)
    to = Math.min(video.duration, result.landingTime + REPLAY_MARGIN_SECONDS)
    if (!(to > from)) return

    if (!isReplaying.value) rateBeforeReplay = video.playbackRate
    isReplaying.value = true

    attachedTo = video
    video.addEventListener('timeupdate', onTimeUpdate)
    video.playbackRate = REPLAY_RATE
    video.currentTime = from
    void video.play().catch(() => {
      // Autoplay blocked. The overlay still works under manual scrubbing, so
      // give up on the loop rather than leaving the element slowed down.
      stop()
    })
  }

  // A new clip, or a re-run of detection, invalidates the window being looped.
  watch(analysis, stop)
  watch(videoRef, stop)

  return { isReplaying, start, stop }
}
