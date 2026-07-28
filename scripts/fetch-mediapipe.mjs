// Puts MediaPipe's runtime and model where Vite can serve them.
//
// The WASM is COPIED from node_modules rather than downloaded: the runtime and
// the JS bindings must be the same version or initialisation fails, and copying
// from the installed package makes that true by construction instead of by
// remembering to bump two numbers together.
//
// Only the model file is fetched — it does not ship inside the npm package.
//
// Both the copy and the download write to a `<name>.part` sibling first and
// only rename onto the final path once the write has fully completed. A
// rename within one filesystem is atomic, so the destination either holds a
// complete artefact or nothing at all.
//
// This matters because the idempotence check below is a bare `exists()` — it
// cannot tell a truncated file, or a half-populated wasm directory, from a
// complete one. Without the rename, a run interrupted by a killed process or
// a dropped connection leaves a corrupt artefact sitting exactly at the path
// the next run checks. That next run — and every run after it — sees
// `exists()` return true and reports "already present, skipping" forever;
// the corruption never self-heals. Worse, the script still exits 0, so CI
// treats it as success, and the failure only surfaces much later, in the
// browser, at MediaPipe initialisation — far from its actual cause. Any
// `.part` left behind by an earlier crash is removed before starting, so a
// previous failure can't poison the next run either.
import { createWriteStream } from 'node:fs'
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises'
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
const DOWNLOAD_TIMEOUT_MS = 30_000

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
  const wasmPart = `${wasmOut}.part`
  // A stale .part here means a previous run was interrupted mid-copy — clear
  // it so it can't be mistaken for progress and can't block a fresh copy.
  await rm(wasmPart, { recursive: true, force: true })
  if (await exists(wasmOut)) {
    console.log('[mediapipe] wasm already present, skipping')
  } else {
    try {
      await cp(WASM_SRC, wasmPart, { recursive: true })
      await rename(wasmPart, wasmOut)
      console.log('[mediapipe] copied wasm from node_modules')
    } catch (error) {
      await rm(wasmPart, { recursive: true, force: true })
      throw error
    }
  }

  const modelOut = join(OUT, MODEL_NAME)
  const modelPart = `${modelOut}.part`
  await rm(modelPart, { force: true })
  if (await exists(modelOut)) {
    console.log('[mediapipe] model already present, skipping')
    return
  }

  console.log(`[mediapipe] downloading ${MODEL_NAME} (~5.5 MB)`)
  let response
  try {
    response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (error) {
    // A stalled/unreachable connection never resolves or rejects on its own —
    // without this, predev/prebuild would hang forever with no output. This
    // is distinct from an HTTP error below: the remedy for a timeout is
    // checking the network, the remedy for a bad status is checking the URL.
    if (error.name === 'TimeoutError') {
      console.error(
        `[mediapipe] download timed out after ${DOWNLOAD_TIMEOUT_MS}ms — check the network connection and retry`
      )
    } else {
      console.error('[mediapipe] download request failed:', error)
    }
    process.exit(1)
  }
  if (!response.ok || !response.body) {
    console.error(`[mediapipe] download failed: ${response.status} ${response.statusText}`)
    process.exit(1)
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(modelPart))
    await rename(modelPart, modelOut)
    console.log('[mediapipe] model ready')
  } catch (error) {
    await rm(modelPart, { force: true })
    throw error
  }
}

main().catch((error) => {
  console.error('[mediapipe]', error)
  process.exit(1)
})
