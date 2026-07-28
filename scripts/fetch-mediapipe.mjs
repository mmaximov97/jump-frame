// Puts MediaPipe's runtime and model where Vite can serve them.
//
// The WASM is COPIED from node_modules rather than downloaded: the runtime and
// the JS bindings must be the same version or initialisation fails, and copying
// from the installed package makes that true by construction instead of by
// remembering to bump two numbers together.
//
// Only the model file is fetched — it does not ship inside the npm package.
import { createWriteStream } from 'node:fs'
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WASM_SRC = join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')
const OUT = join(ROOT, 'public/mediapipe')
const MODEL_NAME = 'pose_landmarker_lite.task'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!(await exists(WASM_SRC))) {
    console.error(
      '[mediapipe] @mediapipe/tasks-vision is not installed — run npm install first.'
    )
    process.exit(1)
  }

  await mkdir(OUT, { recursive: true })

  const wasmOut = join(OUT, 'wasm')
  if (await exists(wasmOut)) {
    console.log('[mediapipe] wasm already present, skipping')
  } else {
    await cp(WASM_SRC, wasmOut, { recursive: true })
    console.log('[mediapipe] copied wasm from node_modules')
  }

  const modelOut = join(OUT, MODEL_NAME)
  if (await exists(modelOut)) {
    console.log('[mediapipe] model already present, skipping')
    return
  }

  console.log(`[mediapipe] downloading ${MODEL_NAME} (~5 MB)`)
  const response = await fetch(MODEL_URL)
  if (!response.ok || !response.body) {
    console.error(`[mediapipe] download failed: ${response.status} ${response.statusText}`)
    process.exit(1)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(modelOut))
  console.log('[mediapipe] model ready')
}

main().catch((error) => {
  console.error('[mediapipe]', error)
  process.exit(1)
})
