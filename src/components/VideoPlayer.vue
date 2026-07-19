<script setup lang="ts">
defineProps<{
  src: string
}>()

const emit = defineEmits<{
  'video-ref': [el: HTMLVideoElement | null]
}>()

function setRef(el: any) {
  emit('video-ref', el as HTMLVideoElement | null)
}
</script>

<template>
  <div class="h-[45vh] md:h-auto md:flex-1 md:min-h-0 rounded-xl overflow-hidden bg-black flex items-center justify-center">
    <video
      :ref="setRef"
      :src="src"
      playsinline
      preload="auto"
      class="max-w-full max-h-full block object-contain"
    />
  </div>
</template>
