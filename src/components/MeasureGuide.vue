<script setup lang="ts">
import { ArrowLeft, ArrowUpFromLine, ArrowDownToLine, CircleCheck, CircleX } from 'lucide-vue-next'

const emit = defineEmits<{
  back: []
}>()

interface FrameExample {
  correct: boolean
  footLift: number
  caption: string
}

const takeoffExamples: FrameExample[] = [
  { correct: true, footLift: 0, caption: 'Last frame where toes are still touching the ground' },
  { correct: false, footLift: 22, caption: 'Too late — feet have already left the ground' },
]

const landingExamples: FrameExample[] = [
  { correct: true, footLift: 0, caption: 'First frame where toes touch the ground again' },
  { correct: false, footLift: 22, caption: "Too early — feet haven't landed yet" },
]

const faqs = [
  {
    q: 'One of my feet leaves the ground before the other — which frame is takeoff?',
    a: "Use the frame where both feet are off the ground. Don't count the first foot that lifts — wait until neither foot is touching.",
  },
  {
    q: 'What if one foot lands before the other?',
    a: 'Landing works the opposite way: use the frame where the first foot touches back down. No need to wait for both feet to settle.',
  },
  {
    q: 'Does the crouch before the jump count as takeoff?',
    a: "No. The dip or arm swing before jumping isn't takeoff — only the moment the feet actually leave the ground counts.",
  },
  {
    q: 'A few frames in a row look identical, or the image is blurry — how do I pick?',
    a: "There's no perfect answer here — pick your best guess, but be equally strict for takeoff and landing. Consistency matters more than nailing one exact frame. Filming at 60 FPS or higher makes this much less of an issue.",
  },
  {
    q: 'I land on my toes — does that throw off the result?',
    a: "It can nudge the number slightly higher than your real jump height — that's a known quirk of this measurement method, not something you're doing wrong.",
  },
]
</script>

<template>
  <div class="min-h-screen px-4 py-6 md:py-10">
    <div class="max-w-2xl mx-auto">
      <button
        class="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-6"
        @click="emit('back')"
      >
        <ArrowLeft class="w-4 h-4" />
        Back
      </button>

      <h1 class="text-2xl font-bold tracking-tight mb-1">How to Measure Correctly</h1>
      <p class="text-sm text-slate-400 mb-8">
        Get the right frame — get the right result
      </p>

      <!-- Takeoff frame examples -->
      <section class="mb-10">
        <h2 class="flex items-center gap-2 text-lg font-semibold mb-3 text-takeoff-light">
          <ArrowUpFromLine class="w-4 h-4" />
          Takeoff frame
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            v-for="ex in takeoffExamples"
            :key="ex.caption"
            class="rounded-xl border p-3"
            :class="ex.correct ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'"
          >
            <svg viewBox="0 0 200 110" class="w-full h-24 sm:h-28" aria-hidden="true">
              <line x1="15" y1="88" x2="185" y2="88" stroke="#475569" stroke-width="2" stroke-dasharray="5 4" />
              <path
                :transform="`translate(70, ${62 - ex.footLift})`"
                d="M0 26 Q -4 8 14 4 Q 34 0 44 10 Q 50 18 40 24 Q 24 28 0 26 Z"
                fill="#475569" opacity="0.5"
              />
              <path
                :transform="`translate(90, ${62 - ex.footLift})`"
                d="M0 26 Q -4 8 14 4 Q 34 0 44 10 Q 50 18 40 24 Q 24 28 0 26 Z"
                :fill="ex.correct ? '#4ade80' : '#f87171'"
              />
              <circle v-if="ex.correct" cx="112" cy="88" r="3" fill="#4ade80" />
              <line
                v-else
                x1="112" y1="88" x2="112" :y2="88 - ex.footLift"
                stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3 2"
              />
            </svg>
            <p
              class="flex items-center gap-1.5 text-xs font-semibold mt-2"
              :class="ex.correct ? 'text-green-400' : 'text-red-400'"
            >
              <CircleCheck v-if="ex.correct" class="w-3.5 h-3.5 shrink-0" />
              <CircleX v-else class="w-3.5 h-3.5 shrink-0" />
              {{ ex.correct ? 'Correct' : 'Incorrect' }}
            </p>
            <p class="text-xs text-slate-400 mt-1">{{ ex.caption }}</p>
          </div>
        </div>
      </section>

      <!-- Landing frame examples -->
      <section class="mb-10">
        <h2 class="flex items-center gap-2 text-lg font-semibold mb-3 text-landing-light">
          <ArrowDownToLine class="w-4 h-4" />
          Landing frame
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            v-for="ex in landingExamples"
            :key="ex.caption"
            class="rounded-xl border p-3"
            :class="ex.correct ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'"
          >
            <svg viewBox="0 0 200 110" class="w-full h-24 sm:h-28" aria-hidden="true">
              <line x1="15" y1="88" x2="185" y2="88" stroke="#475569" stroke-width="2" stroke-dasharray="5 4" />
              <path
                :transform="`translate(70, ${62 - ex.footLift})`"
                d="M0 26 Q -4 8 14 4 Q 34 0 44 10 Q 50 18 40 24 Q 24 28 0 26 Z"
                fill="#475569" opacity="0.5"
              />
              <path
                :transform="`translate(90, ${62 - ex.footLift})`"
                d="M0 26 Q -4 8 14 4 Q 34 0 44 10 Q 50 18 40 24 Q 24 28 0 26 Z"
                :fill="ex.correct ? '#4ade80' : '#f87171'"
              />
              <circle v-if="ex.correct" cx="112" cy="88" r="3" fill="#4ade80" />
              <line
                v-else
                x1="112" y1="88" x2="112" :y2="88 - ex.footLift"
                stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3 2"
              />
            </svg>
            <p
              class="flex items-center gap-1.5 text-xs font-semibold mt-2"
              :class="ex.correct ? 'text-green-400' : 'text-red-400'"
            >
              <CircleCheck v-if="ex.correct" class="w-3.5 h-3.5 shrink-0" />
              <CircleX v-else class="w-3.5 h-3.5 shrink-0" />
              {{ ex.correct ? 'Correct' : 'Incorrect' }}
            </p>
            <p class="text-xs text-slate-400 mt-1">{{ ex.caption }}</p>
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section class="mb-10">
        <h2 class="text-lg font-semibold mb-3">Common questions</h2>
        <div class="space-y-3">
          <div
            v-for="item in faqs"
            :key="item.q"
            class="bg-surface-light rounded-xl border border-surface-lighter p-3 md:p-4"
          >
            <p class="text-sm font-medium text-slate-200 mb-1">{{ item.q }}</p>
            <p class="text-sm text-slate-400 leading-relaxed">{{ item.a }}</p>
          </div>
        </div>
      </section>

      <!-- Filming tips -->
      <section class="mb-12">
        <h2 class="text-lg font-semibold mb-3">Filming tips</h2>
        <ul class="text-sm text-slate-300 leading-relaxed space-y-2 list-disc list-inside mb-4">
          <li>
            The main thing is that your feet and the floor are clearly visible in
            frame — that's what tells you the exact moment of takeoff and landing.
            A side angle usually shows the toe-to-floor gap best, but front-on
            works too as long as foot contact is visible.
          </li>
          <li>Keep the camera roughly at knee-to-waist height, not shooting down from above.</li>
          <li>Keep the phone still and the whole person in frame.</li>
        </ul>
        <div class="bg-surface-light rounded-xl border border-surface-lighter p-4">
          <p class="text-sm font-medium text-slate-200 mb-2">Use 60 FPS if your phone supports it</p>
          <p class="text-sm text-slate-400 leading-relaxed">
            A missed frame at 30 FPS can shift the result by about ±4–5 cm. At 60 FPS,
            that shrinks to about ±2 cm. Slow-motion (120/240 FPS) is even more precise —
            but slow-mo footage often breaks when shared over WhatsApp and similar apps,
            so a plain 60 FPS video is usually the safer bet.
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
