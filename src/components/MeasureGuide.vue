<script setup lang="ts">
import { ref } from 'vue'
import {
  ArrowLeft,
  ArrowUpFromLine,
  ArrowDownToLine,
  CircleCheck,
  CircleX,
  ChevronDown,
  Video,
  MoveVertical,
  Smartphone,
} from 'lucide-vue-next'
import correctImg from '../assets/measure-guide/correct.jpg'
import incorrectImg from '../assets/measure-guide/incorrect.jpg'

const emit = defineEmits<{
  back: []
}>()

const faqs = [
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

const openFaq = ref<number | null>(null)
function toggleFaq(i: number) {
  openFaq.value = openFaq.value === i ? null : i
}
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

      <!-- Correct vs incorrect example -->
      <section class="mb-8">
        <h2 class="text-lg font-semibold mb-3">Takeoff / Landing frame</h2>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-green-500/40 bg-green-500/5 overflow-hidden">
            <div class="relative">
              <img
                :src="correctImg"
                alt="Correct: heel lifted, only the toes still touching the ground"
                class="w-full aspect-4/3 object-cover"
              >
              <span
                class="absolute top-2 left-2 flex items-center gap-1 text-xs font-semibold text-green-300
                       bg-surface/90 backdrop-blur rounded-full px-2 py-1"
              >
                <CircleCheck class="w-3.5 h-3.5 shrink-0" />
                Correct
              </span>
            </div>
            <p class="text-xs text-slate-400 p-3">
              Heel lifted, only the toes still down — this is the frame to look for,
              for both takeoff and landing.
            </p>
          </div>

          <div class="rounded-xl border border-red-500/40 bg-red-500/5 overflow-hidden">
            <div class="relative">
              <img
                :src="incorrectImg"
                alt="Incorrect: flat, relaxed stance"
                class="w-full aspect-4/3 object-cover"
              >
              <span
                class="absolute top-2 left-2 flex items-center gap-1 text-xs font-semibold text-red-300
                       bg-surface/90 backdrop-blur rounded-full px-2 py-1"
              >
                <CircleX class="w-3.5 h-3.5 shrink-0" />
                Incorrect
              </span>
            </div>
            <p class="text-xs text-slate-400 p-3">
              Toes are still flat on the ground here — that's still clear ground
              contact, not the edge-of-contact moment you're looking for.
            </p>
          </div>
        </div>
      </section>

      <!-- Takeoff / Landing specifics -->
      <section class="mb-10 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="rounded-xl border border-takeoff/30 bg-takeoff/5 p-4">
          <h3 class="flex items-center gap-2 text-sm font-semibold text-takeoff-light mb-1.5">
            <ArrowUpFromLine class="w-4 h-4 shrink-0" />
            Takeoff
          </h3>
          <p class="text-sm text-slate-300 leading-relaxed">
            Counts when <strong class="text-slate-100">both feet</strong> are off the
            ground — not when the first foot lifts.
          </p>
        </div>
        <div class="rounded-xl border border-landing/30 bg-landing/5 p-4">
          <h3 class="flex items-center gap-2 text-sm font-semibold text-landing-light mb-1.5">
            <ArrowDownToLine class="w-4 h-4 shrink-0" />
            Landing
          </h3>
          <p class="text-sm text-slate-300 leading-relaxed">
            Counts when <strong class="text-slate-100">at least one foot</strong>
            touches back down — no need to wait for both.
          </p>
        </div>
      </section>

      <!-- FAQ -->
      <section class="mb-10">
        <h2 class="text-lg font-semibold mb-3">Common questions</h2>
        <div class="space-y-2">
          <div
            v-for="(item, i) in faqs"
            :key="item.q"
            class="bg-surface-light rounded-xl border border-surface-lighter overflow-hidden"
          >
            <button
              class="w-full flex items-start gap-3 text-left p-3 md:p-4 min-h-11"
              @click="toggleFaq(i)"
            >
              <span class="text-xs font-mono text-brand-light shrink-0 w-5 pt-0.5">Q{{ i + 1 }}</span>
              <span class="flex-1 text-sm font-medium text-slate-200">{{ item.q }}</span>
              <ChevronDown
                class="w-4 h-4 text-slate-500 shrink-0 mt-0.5 transition-transform"
                :class="{ 'rotate-180': openFaq === i }"
              />
            </button>
            <div v-if="openFaq === i" class="pr-3 md:pr-4 pb-3 md:pb-4 pl-11 md:pl-12">
              <p class="text-sm text-slate-400 leading-relaxed">{{ item.a }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Filming tips -->
      <section class="mb-12">
        <h2 class="text-lg font-semibold mb-3">Filming tips</h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div class="rounded-xl border border-surface-lighter bg-surface-light p-3">
            <Video class="w-4 h-4 text-brand-light mb-2" />
            <p class="text-sm text-slate-300 leading-relaxed">
              Feet and floor clearly visible. Side angle shows the gap best,
              front-on works if contact is visible.
            </p>
          </div>
          <div class="rounded-xl border border-surface-lighter bg-surface-light p-3">
            <MoveVertical class="w-4 h-4 text-brand-light mb-2" />
            <p class="text-sm text-slate-300 leading-relaxed">
              Camera at knee-to-waist height — not shooting down from above.
            </p>
          </div>
          <div class="rounded-xl border border-surface-lighter bg-surface-light p-3">
            <Smartphone class="w-4 h-4 text-brand-light mb-2" />
            <p class="text-sm text-slate-300 leading-relaxed">
              Phone still, whole person in frame.
            </p>
          </div>
        </div>
        <div class="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
          <p class="flex items-center gap-2 text-sm font-medium text-green-300 mb-2">
            <span class="text-base">💡</span>
            Use 60 FPS if your phone supports it
          </p>
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
