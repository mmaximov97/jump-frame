<script setup lang="ts">
import { ref } from 'vue'
import { Upload } from 'lucide-vue-next'

const emit = defineEmits<{
  'file-selected': [file: File]
}>()

const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function openFilePicker() {
  fileInput.value?.click()
}

function handleFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    emit('file-selected', input.files[0])
  }
}

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('video/')) {
    emit('file-selected', file)
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}
</script>

<template>
  <div
    class="border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors"
    :class="isDragging ? 'border-brand bg-brand/10' : 'border-surface-lighter hover:border-brand/50'"
    @click="openFilePicker"
    @drop.prevent="handleDrop"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
  >
    <Upload class="w-12 h-12 mx-auto mb-4 text-brand" />
    <p class="text-lg font-medium mb-2">Drop your video here or click to browse</p>
    <p class="text-sm text-slate-400">Supports any video format your browser can play</p>
    <p class="text-xs text-slate-500 mt-4">Video stays on your device</p>
    <input
      ref="fileInput"
      type="file"
      accept="video/*"
      class="hidden"
      @change="handleFileInput"
    />
  </div>
</template>
