<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'

const emit = defineEmits<{
  back: []
}>()
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

      <h1 class="text-2xl font-bold tracking-tight mb-1">How It Works</h1>
      <p class="text-sm text-slate-400 mb-8">
        The physics behind flight-time jump measurement
      </p>

      <!-- Diagram -->
      <div class="bg-surface-light rounded-xl border border-surface-lighter p-4 md:p-6 mb-8">
        <svg viewBox="0 0 560 280" class="w-full" aria-label="Jump physics diagram">
          <!-- Ground line -->
          <line x1="40" y1="230" x2="520" y2="230" stroke="#475569" stroke-width="2" stroke-dasharray="6 4" />
          <text x="530" y="234" fill="#64748b" font-size="11" font-family="system-ui">ground</text>

          <!-- Parabolic arc -->
          <path
            d="M 100 230 Q 120 220, 160 140 Q 200 50, 280 30 Q 360 50, 400 140 Q 440 220, 460 230"
            fill="none" stroke="#60a5fa" stroke-width="2.5" stroke-dasharray="8 4"
          />

          <!-- Takeoff position -->
          <circle cx="100" cy="230" r="6" fill="#22c55e" />
          <text x="100" y="255" fill="#4ade80" font-size="12" font-family="system-ui" text-anchor="middle" font-weight="600">Takeoff</text>
          <text x="100" y="270" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">frame T</text>

          <!-- Peak position -->
          <circle cx="280" cy="30" r="5" fill="#60a5fa" opacity="0.6" />
          <line x1="280" y1="36" x2="280" y2="230" stroke="#60a5fa" stroke-width="1" stroke-dasharray="4 3" opacity="0.4" />
          <text x="280" y="20" fill="#94a3b8" font-size="11" font-family="system-ui" text-anchor="middle">peak</text>

          <!-- Landing position -->
          <circle cx="460" cy="230" r="6" fill="#ef4444" />
          <text x="460" y="255" fill="#f87171" font-size="12" font-family="system-ui" text-anchor="middle" font-weight="600">Landing</text>
          <text x="460" y="270" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">frame L</text>

          <!-- Height arrow -->
          <line x1="50" y1="30" x2="50" y2="230" stroke="#e2e8f0" stroke-width="1.5" />
          <polygon points="50,30 46,40 54,40" fill="#e2e8f0" />
          <polygon points="50,230 46,220 54,220" fill="#e2e8f0" />
          <text x="36" y="134" fill="#e2e8f0" font-size="13" font-family="system-ui" text-anchor="middle" font-weight="700" transform="rotate(-90,36,134)">h</text>

          <!-- Flight time arrow -->
          <line x1="100" y1="244" x2="460" y2="244" stroke="#94a3b8" stroke-width="1" />
          <polygon points="100,244 110,240 110,248" fill="#94a3b8" />
          <polygon points="460,244 450,240 450,248" fill="#94a3b8" />
          <text x="280" y="242" fill="#94a3b8" font-size="11" font-family="system-ui" text-anchor="middle">
            <tspan dy="-3">flight time t</tspan>
          </text>

          <!-- Gravity arrow -->
          <line x1="310" y1="50" x2="310" y2="100" stroke="#fbbf24" stroke-width="1.5" />
          <polygon points="310,100 306,90 314,90" fill="#fbbf24" />
          <text x="325" y="80" fill="#fbbf24" font-size="11" font-family="system-ui">g</text>
        </svg>
      </div>

      <!-- Method overview -->
      <section class="mb-8">
        <h2 class="text-lg font-semibold mb-3">Flight-Time Method</h2>
        <p class="text-sm text-slate-300 leading-relaxed mb-3">
          The flight-time method determines jump height by measuring how long the
          jumper is airborne. A longer flight time means a higher jump. This
          approach requires only a camera with a known frame rate — no force
          plates, motion capture, or wearable sensors.
        </p>
        <p class="text-sm text-slate-300 leading-relaxed">
          You mark the <span class="text-takeoff-light font-medium">takeoff frame</span>
          (last frame with ground contact) and the
          <span class="text-landing-light font-medium">landing frame</span>
          (first frame with ground contact on return). The app converts that
          frame difference into a flight time, then applies projectile-motion
          kinematics to compute the height.
        </p>
      </section>

      <!-- Formula derivation -->
      <section class="mb-8">
        <h2 class="text-lg font-semibold mb-3">Deriving the Formula</h2>

        <div class="space-y-4 text-sm text-slate-300 leading-relaxed">
          <div>
            <h3 class="text-slate-200 font-medium mb-1">1. Flight time from video</h3>
            <p>
              The flight time is the duration between takeoff and landing frames,
              divided by the video's frame rate:
            </p>
            <div class="bg-surface rounded-lg px-4 py-3 my-2 font-mono text-center text-slate-200">
              t = (L − T) / FPS
            </div>
            <p class="text-slate-400 text-xs">
              where <span class="font-mono">T</span> = takeoff frame,
              <span class="font-mono">L</span> = landing frame,
              <span class="font-mono">FPS</span> = frames per second
            </p>
          </div>

          <div>
            <h3 class="text-slate-200 font-medium mb-1">2. Symmetry of flight</h3>
            <p>
              In projectile motion (ignoring air resistance), the ascent and
              descent are symmetrical. The time to reach peak height equals half
              the total flight time:
            </p>
            <div class="bg-surface rounded-lg px-4 py-3 my-2 font-mono text-center text-slate-200">
              t<sub>up</sub> = t / 2
            </div>
          </div>

          <div>
            <h3 class="text-slate-200 font-medium mb-1">3. Peak height from kinematics</h3>
            <p>
              At the peak, vertical velocity is zero. Using the kinematic
              equation for displacement under constant acceleration
              (<span class="font-mono">g = 9.81 m/s²</span>):
            </p>
            <div class="bg-surface rounded-lg px-4 py-3 my-2 font-mono text-center text-slate-200">
              h = ½ · g · t<sub>up</sub>²
            </div>
          </div>

          <div>
            <h3 class="text-slate-200 font-medium mb-1">4. Substituting t<sub>up</sub> = t/2</h3>
            <div class="bg-surface rounded-lg px-4 py-3 my-2 font-mono text-center text-slate-200">
              h = ½ · g · (t/2)² = g · t² / 8
            </div>
          </div>

          <div>
            <h3 class="text-slate-200 font-medium mb-1">5. Final formula</h3>
            <div class="bg-brand/10 border border-brand/30 rounded-lg px-4 py-4 my-2 font-mono text-center text-lg text-slate-100">
              h = 9.81 · t² / 8
            </div>
            <p class="text-slate-400 text-xs mt-1">
              Result in metres. Multiply by 100 for cm, or by 39.37 for inches.
            </p>
          </div>
        </div>
      </section>

      <!-- Accuracy notes -->
      <section class="mb-8">
        <h2 class="text-lg font-semibold mb-3">Accuracy &amp; FPS</h2>
        <p class="text-sm text-slate-300 leading-relaxed mb-3">
          The precision of the flight-time method depends directly on the video
          frame rate. Each frame boundary introduces a potential timing error
          of&nbsp;<span class="font-mono text-slate-200">±1/FPS</span> at both
          takeoff and landing.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="text-left text-slate-400 border-b border-surface-lighter">
                <th class="py-2 pr-4 font-medium">FPS</th>
                <th class="py-2 pr-4 font-medium">Frame interval</th>
                <th class="py-2 font-medium">Height error (≈)</th>
              </tr>
            </thead>
            <tbody class="text-slate-300 font-mono">
              <tr class="border-b border-surface-lighter/50">
                <td class="py-2 pr-4">30</td>
                <td class="py-2 pr-4">33.3 ms</td>
                <td class="py-2">± 4–5 cm</td>
              </tr>
              <tr class="border-b border-surface-lighter/50">
                <td class="py-2 pr-4">60</td>
                <td class="py-2 pr-4">16.7 ms</td>
                <td class="py-2">± 2–3 cm</td>
              </tr>
              <tr class="border-b border-surface-lighter/50">
                <td class="py-2 pr-4">120</td>
                <td class="py-2 pr-4">8.3 ms</td>
                <td class="py-2">± 1 cm</td>
              </tr>
              <tr>
                <td class="py-2 pr-4">240</td>
                <td class="py-2 pr-4">4.2 ms</td>
                <td class="py-2">± 0.5 cm</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-slate-500 mt-3">
          For best results, record at 120 FPS or higher with a stable camera
          angle perpendicular to the jump.
        </p>
      </section>

      <!-- Assumptions -->
      <section class="mb-12">
        <h2 class="text-lg font-semibold mb-3">Assumptions</h2>
        <ul class="text-sm text-slate-300 leading-relaxed space-y-2 list-disc list-inside">
          <li>
            Takeoff and landing happen at the <span class="text-slate-200 font-medium">same height</span>
            (feet leave and return to the same surface).
          </li>
          <li>Air resistance is negligible at human jump velocities.</li>
          <li>
            The body's centre of mass follows a parabolic trajectory determined
            solely by gravity.
          </li>
          <li>
            The camera frame rate is constant and matches the selected FPS value.
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
