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
}>()

const VISIBLE_COUNT = 5

const expandedId = ref<string | null>(null)
const showAll = ref(false)
// Only the record entry confirms before deleting — losing your best jump
// is the one deletion here worth a modal, not just a second tap.
const pendingDeleteEntry = ref<JumpHistoryEntry | null>(null)

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

function requestDelete(entry: JumpHistoryEntry) {
  if (entry.id === props.personalRecord?.id) {
    pendingDeleteEntry.value = entry
    return
  }
  emit('delete-entry', entry.id)
  expandedId.value = null
}

function confirmDeleteRecord() {
  if (!pendingDeleteEntry.value) return
  emit('delete-entry', pendingDeleteEntry.value.id)
  if (expandedId.value === pendingDeleteEntry.value.id) expandedId.value = null
  pendingDeleteEntry.value = null
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="personalRecord" class="rounded-xl border border-record/30 bg-record/10 px-4 py-4">
      <p class="text-[11px] font-medium tracking-wide uppercase text-record-light/70 mb-1">
        Personal best
      </p>
      <p class="flex items-baseline gap-2">
        <Trophy class="w-5 h-5 text-record shrink-0 translate-y-0.5" />
        <span class="text-3xl font-bold text-record-light"
          >{{ formatHeight(personalRecord.heightCm) }} {{ unitLabel(unit) }}</span
        >
        <span class="text-xs text-slate-400">&middot; {{ formatDate(personalRecord.savedAt) }}</span>
      </p>
    </div>

    <div>
      <p class="text-xs text-slate-500 px-1 mb-2">History ({{ entries.length }})</p>
      <div
        class="flex flex-col rounded-xl border border-surface-lighter overflow-hidden divide-y divide-surface-lighter"
      >
        <div v-for="entry in visibleEntries" :key="entry.id">
          <button
            class="w-full min-h-11 px-3 py-3 flex items-center text-left
                   bg-surface-light hover:bg-surface-lighter transition-colors"
            @click="toggleExpand(entry.id)"
          >
            <div class="flex-1 min-w-0">
              <span class="flex items-center gap-1.5">
                <span class="text-sm font-semibold text-slate-100"
                  >{{ formatHeight(entry.heightCm) }} {{ unitLabel(unit) }}</span
                >
                <Star v-if="entry.id === personalRecord?.id" class="w-3 h-3 text-record shrink-0" />
                <TriangleAlert
                  v-if="entry.slowMoWarning"
                  class="w-3 h-3 text-orange-400/80 shrink-0"
                />
              </span>
              <p class="text-xs text-slate-500 mt-1">
                Flight <span class="font-mono">{{ formatTime(entry.flightTimeSeconds) }}</span>
              </p>
            </div>
            <span class="text-xs text-slate-500 shrink-0">{{ formatDate(entry.savedAt) }}</span>
          </button>

          <div
            v-if="expandedId === entry.id"
            class="px-4 py-6 bg-surface border-t border-surface-lighter flex flex-col items-center gap-3"
          >
            <div class="w-56 aspect-[3/4] rounded-lg overflow-hidden bg-surface-lighter shrink-0">
              <img
                v-if="entry.thumbnail"
                :src="entry.thumbnail"
                alt=""
                class="w-full h-full object-cover"
              />
            </div>
            <div class="text-center">
              <p class="text-base font-semibold text-slate-100">
                {{ formatHeight(entry.heightCm) }} {{ unitLabel(unit) }}
              </p>
              <p class="text-xs text-slate-500 mt-1">
                Flight {{ formatTime(entry.flightTimeSeconds) }} &middot; {{ entry.fps }} FPS
              </p>
              <p class="text-xs text-slate-500">{{ formatDateTime(entry.savedAt) }}</p>
            </div>

            <button
              class="px-2 py-3.5 -my-3.5 flex items-center text-xs text-slate-500 hover:text-red-400 transition-colors"
              @click="requestDelete(entry)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="!showAll && entries.length > VISIBLE_COUNT"
        class="mt-2 min-h-11 px-1 flex items-center text-xs text-slate-500 hover:text-brand-light transition-colors"
        @click="showAll = true"
      >
        Show all {{ entries.length }} &rarr;
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="pendingDeleteEntry"
      class="fixed inset-0 z-50 flex items-center justify-center px-6 bg-black/60"
      @click.self="pendingDeleteEntry = null"
    >
      <div class="w-full max-w-xs rounded-xl bg-surface-light border border-surface-lighter shadow-xl p-5">
        <div class="flex items-center gap-2 mb-2">
          <Trophy class="w-5 h-5 text-record shrink-0" />
          <p class="font-semibold text-record-light">This is your personal record</p>
        </div>
        <p class="text-sm text-slate-400 mb-5">
          Delete the {{ formatHeight(pendingDeleteEntry.heightCm) }} {{ unitLabel(unit) }} jump from
          {{ formatDate(pendingDeleteEntry.savedAt) }}? This can't be undone.
        </p>
        <div class="flex gap-2">
          <button
            class="flex-1 min-h-11 rounded-lg text-sm font-medium text-slate-300
                   bg-surface-lighter hover:bg-surface-lighter/80 transition-colors"
            @click="pendingDeleteEntry = null"
          >
            Cancel
          </button>
          <button
            class="flex-1 min-h-11 rounded-lg text-sm font-medium text-white
                   bg-red-500/90 hover:bg-red-500 transition-colors"
            @click="confirmDeleteRecord"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
