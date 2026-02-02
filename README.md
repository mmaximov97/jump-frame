# FrameJump

**Measure your vertical jump height using nothing but your phone's camera.**

FrameJump is a client-side web app that calculates vertical jump height through frame-by-frame video analysis. No uploads, no expensive hardware — just physics and your browser.

---

## How It Works

1. **Record** your jump from the side with any camera.
2. **Upload** the video into the app (it stays on your device).
3. **Mark** the exact takeoff and landing frames.
4. **Get** your jump height instantly.

---

## The Physics

Jump height is derived from flight time using constant gravitational acceleration:

$$h = \frac{g \cdot t^2}{8}$$

| Variable | Meaning |
|----------|---------|
| $h$ | Vertical height (meters) |
| $g$ | Gravity ($\approx 9.81$ m/s²) |
| $t$ | Total flight time (seconds) |

Flight time is calculated from the frame data:

$$t = \frac{Frame_{landing} - Frame_{takeoff}}{FPS}$$

---

## Accuracy by Frame Rate

Higher FPS means more precise results. Here's what to expect:

| FPS | Time per Frame | Error Margin (at 60 cm jump) |
|-----|---------------|-------------------------------|
| 30 | ~33.3 ms | +/- 3.5 cm |
| 60 | ~16.6 ms | +/- 1.8 cm |
| 120 | ~8.3 ms | +/- 0.9 cm |
| 240 | ~4.1 ms | +/- 0.4 cm |

> **Tip:** Most modern phones can record at 120 or 240 FPS in slow-motion mode.

---

## Key Features

- **Zero-Upload Privacy** — Videos are processed locally via `URL.createObjectURL()`. Nothing leaves your device.
- **Frame-Accurate Navigation** — Step forward or backward one frame at a time.
- **Auto FPS Detection** — Automatically detects video frame rate via `requestVideoFrameCallback`, with 60 FPS default fallback.
- **Mobile-First Design** — Large touch targets built for the court or the gym.
- **Metric & Imperial** — Toggle between centimeters and inches.

---

## Tips for Best Results

- **Film from the side.** A lateral view makes it easy to see exactly when the toes leave the ground.
- **Use a tripod.** A stable camera makes frame identification much easier.
- **Land naturally.** Keep the same leg extension on landing as on takeoff for the most accurate center-of-mass measurement.

---

## Tech Stack

| | |
|---|---|
| Framework | Vue 3 (Composition API) |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| Icons | Lucide-Vue |

---

## Development

```bash
npm install          # install dependencies
npm run dev          # start dev server
npm run build        # type-check + production build
npm run preview      # preview production build
```