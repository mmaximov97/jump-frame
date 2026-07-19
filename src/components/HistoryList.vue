<script setup lang="ts">
import { ref, computed } from 'vue'
import { Trophy, TriangleAlert, Star } from 'lucide-vue-next'
import { cmToUnit, unitLabel, type DisplayUnit } from '../composables/useJumpCalculation'
import type { JumpHistoryEntry } from '../composables/useJumpHistory'

const props = defineProps<{
  entries: JumpHistoryEntry[]
  personalRecord: JumpHistoryEntry | null
  unit: DisplayUnit
}>()

const emit = defineEmits<{
  'delete-entry': [id: string]
  'clear-all': []
}>()

const VISIBLE_COUNT = 5

const expandedId = ref<string | null>(null)
const showAll = ref(false)
const confirmingClear = ref(false)

const visibleEntries = computed(() =>
  showAll.value ? props.entries : props.entries.slice(0, VISIBLE_COUNT)
)

function formatHeight(cm: number): string {
  return cmToUnit(cm, props.unit).toFixed(1)
}

function formatTime(seconds: number): string {
  return seconds.toFixed(3) + ' s'
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (isSameDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function handleDelete(id: string) {
  if (expandedId.value === id) expandedId.value = null
  emit('delete-entry', id)
}

function confirmClearAll() {
  confirmingClear.value = false
  showAll.value = false
  expandedId.value = null
  emit('clear-all')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="personalRecord" class="flex items-center gap-2 px-1">
      <Trophy class="w-5 h-5 text-record shrink-0" />
      <p class="text-sm">
        <span class="text-slate-400">Personal best</span>
        <span class="font-semibold text-record ml-1"
          >{{ formatHeight(personalRecord.heightCm) }} {{ unitLabel(unit) }}</span
        >
        <span class="text-slate-500 ml-1">&middot; {{ formatDate(personalRecord.savedAt) }}</span>
      </p>
    </div>

    <div>
      <p class="text-xs text-slate-500 px-1 mb-1">History ({{ entries.length }})</p>
      <div
        class="flex flex-col rounded-xl border border-surface-lighter overflow-hidden divide-y divide-surface-lighter"
      >
        <div v-for="entry in visibleEntries" :key="entry.id">
          <button
            class="w-full min-h-11 px-3 py-2 flex items-center gap-2 text-sm text-left
                   bg-surface-light hover:bg-surface-lighter transition-colors"
            @click="toggleExpand(entry.id)"
          >
            <span
              class="font-mono font-medium tabular-nums shrink-0"
              :class="entry.id === personalRecord?.id ? 'text-record' : 'text-slate-200'"
              >{{ formatHeight(entry.heightCm) }} {{ unitLabel(unit) }}</span
            >
            <Star v-if="entry.id === personalRecord?.id" class="w-3.5 h-3.5 text-record shrink-0" />
            <TriangleAlert
              v-if="entry.slowMoWarning"
              class="w-3.5 h-3.5 text-orange-400/80 shrink-0"
            />
            <span class="font-mono text-slate-500 text-xs shrink-0">{{
              formatTime(entry.flightTimeSeconds)
            }}</span>
            <span class="ml-auto text-slate-500 text-xs shrink-0">{{
              formatDate(entry.savedAt)
            }}</span>
          </button>

          <div
            v-if="expandedId === entry.id"
            class="px-3 py-3 bg-surface flex items-center gap-3 border-t border-surface-lighter"
          >
            <img
              v-if="entry.thumbnail"
              :src="entry.thumbnail"
              alt=""
              class="w-20 h-12 rounded-md object-cover shrink-0 bg-surface-lighter"
            />
            <div v-else class="w-20 h-12 rounded-md bg-surface-lighter shrink-0" />
            <div class="flex-1 min-w-0 text-xs text-slate-400 space-y-0.5">
              <p>{{ formatHeight(entry.heightCm) }} {{ unitLabel(unit) }} &middot; {{ formatTime(entry.flightTimeSeconds) }}</p>
              <p>{{ entry.fps }} FPS &middot; {{ formatDateTime(entry.savedAt) }}</p>
            </div>
            <button
              class="min-h-11 min-w-11 px-3 rounded-lg text-xs font-medium text-red-400 hover:text-red-300
                     bg-surface-light hover:bg-surface-lighter border border-surface-lighter transition-colors shrink-0"
              @click="handleDelete(entry.id)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="!showAll && entries.length > VISIBLE_COUNT"
        class="mt-1 min-h-11 px-1 flex items-center text-xs text-slate-500 hover:text-brand-light transition-colors"
        @click="showAll = true"
      >
        Show all {{ entries.length }} &rarr;
      </button>
    </div>

    <div class="px-1">
      <button
        v-if="!confirmingClear"
        class="min-h-11 flex items-center text-xs text-slate-500 hover:text-slate-300 transition-colors"
        @click="confirmingClear = true"
      >
        Clear history
      </button>
      <div v-else class="flex items-center gap-1 text-xs text-slate-400">
        <span class="px-1">Clear all history?</span>
        <button
          class="min-h-11 px-2 flex items-center text-red-400 hover:text-red-300 font-medium"
          @click="confirmClearAll"
        >
          Yes
        </button>
        <button
          class="min-h-11 px-2 flex items-center text-slate-500 hover:text-slate-300"
          @click="confirmingClear = false"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
