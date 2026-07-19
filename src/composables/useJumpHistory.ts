import { ref, computed } from 'vue'

const STORAGE_KEY = 'framejump:history'
const MAX_ENTRIES = 50

export interface JumpHistoryEntry {
  id: string
  heightCm: number
  flightTimeSeconds: number
  fps: number
  savedAt: number
  thumbnail: string | null
  slowMoWarning: boolean
}

function loadEntries(): JumpHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveEntries(entries: JumpHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage unavailable, disabled, or full — fail silently.
    // The measurement itself still works; it just won't be remembered.
  }
}

export function useJumpHistory() {
  const entries = ref<JumpHistoryEntry[]>(loadEntries())
  const draftId = ref<string | null>(null)

  const sortedEntries = computed(() =>
    [...entries.value].sort((a, b) => b.savedAt - a.savedAt)
  )

  const personalRecord = computed<JumpHistoryEntry | null>(() =>
    entries.value.reduce<JumpHistoryEntry | null>(
      (best, e) => (!best || e.heightCm > best.heightCm ? e : best),
      null
    )
  )

  // Best height excluding the entry currently being drafted — used to
  // decide whether *this* jump beats what came before it.
  const previousBestHeightCm = computed<number | null>(() =>
    entries.value.reduce<number | null>(
      (best, e) =>
        e.id !== draftId.value && (best === null || e.heightCm > best) ? e.heightCm : best,
      null
    )
  )

  function persist() {
    saveEntries(entries.value)
  }

  function prune() {
    if (entries.value.length <= MAX_ENTRIES) return
    const record = personalRecord.value
    const kept = [...entries.value].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_ENTRIES)
    if (record && !kept.some((e) => e.id === record.id)) {
      kept.push(record)
    }
    entries.value = kept
  }

  function upsertDraft(data: {
    heightCm: number
    flightTimeSeconds: number
    fps: number
    thumbnail: string | null
    slowMoWarning: boolean
  }) {
    if (draftId.value === null) {
      draftId.value = crypto.randomUUID()
    }
    const id = draftId.value
    const existingIndex = entries.value.findIndex((e) => e.id === id)
    const savedAt = existingIndex >= 0 ? entries.value[existingIndex]!.savedAt : Date.now()
    const entry: JumpHistoryEntry = { id, savedAt, ...data }
    if (existingIndex >= 0) {
      entries.value.splice(existingIndex, 1, entry)
    } else {
      entries.value.push(entry)
    }
    prune()
    persist()
  }

  // Locks in the current draft as a permanent entry — the next marker
  // change (on a newly loaded video) starts a fresh draft instead of
  // overwriting this one.
  function finalizeDraft() {
    draftId.value = null
  }

  function deleteEntry(id: string) {
    entries.value = entries.value.filter((e) => e.id !== id)
    persist()
  }

  function clearAll() {
    entries.value = []
    persist()
  }

  return {
    entries: sortedEntries,
    personalRecord,
    previousBestHeightCm,
    upsertDraft,
    finalizeDraft,
    deleteEntry,
    clearAll,
  }
}
