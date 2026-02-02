# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FrameJump — a client-side web app that measures vertical jump height from video. Users upload a video, mark takeoff and landing frames, and get jump height calculated via flight-time kinematics: `h = g * t² / 8`.

All video processing happens in the browser. No server uploads.

## Tech Stack

- **Framework:** Vue 3 (Composition API)
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Icons:** Lucide-Vue

## Development Commands

Project has not been scaffolded yet. When initialized, expected commands:

```bash
npm install          # install dependencies
npm run dev          # start dev server
npm run build        # production build
npm run lint         # lint (once configured)
```

## Architecture (Planned)

- `VideoPlayer.vue` — wraps native `<video>` tag for playback
- `useFrameStepping` composable — handles `currentTime` manipulation for frame-by-frame navigation (`1/FPS` increments)
- Marker system — stores `takeoffTime` and `landingTime` timestamps
- FPS selector — supports 30, 60, 120, 240 FPS for time-to-frame accuracy
- Calculation engine — reactive computation of jump height from marked frames and FPS
- Results card — displays height in metric (cm) or imperial (inches)

## Key Domain Rules

- Flight time formula: `t = (frame_landing - frame_takeoff) / FPS`
- Jump height formula: `h = (9.81 * t²) / 8`
- Videos must never leave the client — use `URL.createObjectURL()` for local playback
- Frame accuracy depends on video FPS; the app must support manual FPS calibration
