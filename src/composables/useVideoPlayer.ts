import { ref, watch, onUnmounted, type Ref } from 'vue'

export function useVideoPlayer() {
  const videoRef: Ref<HTMLVideoElement | null> = ref(null)
  const videoSrc = ref('')
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const isVideoLoaded = ref(false)

  let blobUrl: string | null = null

  function loadVideo(file: File) {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl)
    }
    blobUrl = URL.createObjectURL(file)
    videoSrc.value = blobUrl
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    isVideoLoaded.value = false
  }

  function play() {
    videoRef.value?.play()
  }

  function pause() {
    videoRef.value?.pause()
  }

  function togglePlayPause() {
    if (isPlaying.value) {
      pause()
    } else {
      play()
    }
  }

  function seekTo(time: number) {
    if (videoRef.value) {
      videoRef.value.currentTime = time
    }
  }

  function onTimeUpdate() {
    currentTime.value = videoRef.value?.currentTime ?? 0
  }

  function onLoadedMetadata() {
    duration.value = videoRef.value?.duration ?? 0
    isVideoLoaded.value = true
  }

  function onPlay() {
    isPlaying.value = true
  }

  function onPause() {
    isPlaying.value = false
  }

  function onEnded() {
    isPlaying.value = false
  }

  function attachListeners(el: HTMLVideoElement) {
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('loadedmetadata', onLoadedMetadata)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
  }

  function detachListeners(el: HTMLVideoElement) {
    el.removeEventListener('timeupdate', onTimeUpdate)
    el.removeEventListener('loadedmetadata', onLoadedMetadata)
    el.removeEventListener('play', onPlay)
    el.removeEventListener('pause', onPause)
    el.removeEventListener('ended', onEnded)
  }

  watch(videoRef, (newEl, oldEl) => {
    if (oldEl) detachListeners(oldEl)
    if (newEl) attachListeners(newEl)
  })

  onUnmounted(() => {
    if (videoRef.value) detachListeners(videoRef.value)
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl)
      blobUrl = null
    }
  })

  return {
    videoRef,
    videoSrc,
    isPlaying,
    currentTime,
    duration,
    isVideoLoaded,
    loadVideo,
    play,
    pause,
    togglePlayPause,
    seekTo,
  }
}
