# Server Body-Detection Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove an end-to-end pipe — FrameJump client uploads a clip's extracted frames to a new `body_detection` job type on `ai-lab`, a new RTMPose-lightweight service processes them, and the client gets real landmarks back. No physics integration; the result is just displayed/logged.

**Architecture:** New Python FastAPI service on `ai-lab` (`src/body-detection-server/`) wraps `rtmlib`'s `Body(mode='lightweight')`. New TypeScript plumbing on `ai-lab` (job type, scope, route, worker case, client) follows the *exact* pattern already used for `audio.transcription.async`. New FrameJump composable packages already-extracted frames into a zip, uploads, polls, and displays the raw result.

**Tech Stack:** `ai-lab`: TypeScript/Fastify/BullMQ (existing), Python/FastAPI (new service, matching `src/qwen-tts-server`'s shape), `rtmlib` (RTMPose). `jump-measurer`: Vue 3/TypeScript, `JSZip` (new dependency).

## Global Constraints

- **`ai-lab` repo** (`/home/cypher/Projects/ai-lab`): TypeScript throughout. New job type/scope must extend the existing `Scope`/`JobType` enums in `src/db/repositories.ts` and `src/jobs/job-types.ts` — do not create a parallel type system. Never add a `Co-Authored-By` trailer.
- **`jump-measurer` repo** (current directory once in the SDD worktree): TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Composables that touch browser APIs live in `src/composables/`, never `src/lib/**` (which must stay pure). Never add a `Co-Authored-By` trailer.
- This plan produces NO changes to `src/lib/**`'s physics (`comTrack.ts`, `bodyModel.ts`, `flightPhase.ts`, `comSlope.ts`) and NO changes to `measureJump`/`guessFlightWindow` call sites. The landmark format this plan delivers (17 COCO points, no z) is deliberately incompatible with `PoseFrame` — that adaptation is a separate, future plan.
- Design doc: `docs/2026-08-05-server-body-detection-plumbing-design.md` (in `jump-measurer`) — read for full rationale.

---

### Task 1: RTMPose Python service on `ai-lab`

**Repo:** `/home/cypher/Projects/ai-lab`

**Files:**
- Create: `src/body-detection-server/Dockerfile`
- Create: `src/body-detection-server/requirements.txt`
- Create: `src/body-detection-server/main.py`

**Interfaces:**
- Produces: `GET /healthz` → `{"ok": bool}`. `POST /v1/detect` — body `{"zip_path": string}`, response `{"frames": [{"time": number, "landmarks": [{"x": number, "y": number, "score": number}, ...exactly 17, COCO order: nose, left_eye, right_eye, left_ear, right_ear, left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist, left_hip, right_hip, left_knee, right_knee, left_ankle, right_ankle]}]}`. Task 3's `BodyDetectionClient` (TS) calls this.

This container reads a zip file from a path on the shared `ai-lab-data` volume (mounted the same way `xtts`/`qwen-tts` already mount it for file-path-based inputs — see `qwen-tts`'s `reference_audio_path` field in `src/qwen-tts-server/main.py`) — it does NOT receive the zip's bytes over HTTP. Task 2 wires this volume.

- [ ] **Step 1: `requirements.txt`**

```
rtmlib==0.0.16
opencv-python-headless
fastapi
uvicorn[standard]
pydantic
```

- [ ] **Step 2: `main.py`**

```python
"""HTTP wrapper around RTMPose (via rtmlib) for ai-lab's body_detection job type.

Loads the RTMPose-lightweight pipeline (YOLOX-tiny detector + RTMPose-s) once at
startup, not per-request -- rtmlib's Body() constructor downloads and loads both
onnxruntime sessions, which is too slow to repeat per frame. Runs on CPU by
default (device="cpu"); the model is small enough (see the comment on DEVICE
below) that this is a genuine option, not just a fallback -- measured at 63ms
per frame on CPU alone (no GPU) during the offline comparison that motivated
this service, well within what a synchronous per-request call can tolerate.
"""
import logging
import os
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from rtmlib import Body

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("body-detection-server")

# "cpu" by default: rtmlib's lightweight mode recovered 100% of the frames
# MediaPipe's heavy tier missed, at 63ms/frame on CPU alone during the
# comparison that motivated this service -- fast enough to not require GPU as
# a precondition. Set to "cuda" via env once a GPU slot is confirmed free on
# the host (see the design doc's open question on GPU vs CPU deploy).
DEVICE = os.environ.get("BODY_DETECTION_DEVICE", "cpu")
MIN_KEYPOINT_SCORE = 0.3

state: dict = {"body": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("loading RTMPose lightweight (device=%s)", DEVICE)
    state["body"] = Body(mode="lightweight", backend="onnxruntime", device=DEVICE)
    log.info("RTMPose lightweight loaded")
    yield
    state["body"] = None


app = FastAPI(lifespan=lifespan)


class DetectRequest(BaseModel):
    zip_path: str


@app.get("/healthz")
async def healthz():
    loaded = state["body"] is not None
    return JSONResponse({"ok": loaded}, status_code=200 if loaded else 503)


# Deliberately a plain `def`, not `async def`: rtmlib's Body.__call__ is a
# blocking CPU/GPU inference call. Starlette dispatches sync route handlers to
# its threadpool, keeping the event loop (and /healthz) free during a long
# multi-frame request -- the same reasoning src/qwen-tts-server/main.py's /v1/tts
# route documents for its own blocking call.
@app.post("/v1/detect")
def detect(req: DetectRequest):
    zip_path = Path(req.zip_path)
    if not zip_path.exists():
        raise HTTPException(status_code=400, detail=f"Zip not found: {req.zip_path}")

    extract_dir = zip_path.with_suffix("")
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(extract_dir)

    manifest_path = extract_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=400, detail="Zip has no manifest.json")

    import json
    manifest = json.loads(manifest_path.read_text())

    body = state["body"]
    frames = []
    for entry in manifest:
        frame_path = extract_dir / f"frame_{entry['index']:04d}.jpg"
        if not frame_path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Manifest references missing frame: {frame_path.name}",
            )
        img = cv2.imread(str(frame_path))
        keypoints, scores = body(img)

        landmarks = []
        if len(scores) > 0:
            kpts = keypoints[0]
            scs = scores[0]
            for (x, y), s in zip(kpts, scs):
                landmarks.append({"x": float(x), "y": float(y), "score": float(s)})
        else:
            # No person found at all -- 17 zero-score entries, not a missing
            # frame. The caller (Task 3's BodyDetectionClient / Task 4's
            # composable) decides what "not detected" means downstream; this
            # service never silently drops a frame from the response array,
            # since the manifest's frame count is the caller's contract for
            # matching results back to timestamps.
            landmarks = [{"x": 0.0, "y": 0.0, "score": 0.0} for _ in range(17)]

        frames.append({"time": entry["time"], "landmarks": landmarks})

    return {"frames": frames}
```

- [ ] **Step 3: `Dockerfile`**

```dockerfile
# -slim, unlike src/qwen-tts-server's full python:3.12: rtmlib's dependencies
# (onnxruntime, opencv-python-headless) ship prebuilt wheels and need no
# compiler at runtime, unlike qwen-tts's Triton (which compiles a CUDA shim
# and needs Python.h + a compiler present in the container).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8110
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8110"]
```

- [ ] **Step 4: Build and smoke-test locally**

```bash
cd src/body-detection-server
docker build -t ai-lab-body-detection-test .
```

Expected: build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/body-detection-server/
git commit -m "Add the RTMPose body-detection service (Dockerfile, requirements, FastAPI wrapper)"
```

---

### Task 2: Wire the new service into `docker-compose.yml`

**Repo:** `/home/cypher/Projects/ai-lab`

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `src/body-detection-server/` (Task 1).
- Produces: a `body-detection` service reachable at `http://body-detection:8110` from other containers on the `ai-lab` network. Task 3's `BodyDetectionClient` is configured with this base URL.

- [ ] **Step 1: Add the service block**

Find the `qwen-tts:` service block in `docker-compose.yml` (used here as the placement anchor — insert the new block immediately after it, before `llama:`):

```yaml
  qwen-tts:
    build: ./src/qwen-tts-server
    volumes:
      - ai-lab-data:/app/data
      - qwen-tts-models:/models
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
    networks:
      - ai-lab
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    profiles:
      - models

  llama:
```

Insert between them:

```yaml
  body-detection:
    build: ./src/body-detection-server
    volumes:
      - ai-lab-data:/app/data
    environment:
      - BODY_DETECTION_DEVICE=cpu
    networks:
      - ai-lab
    profiles:
      - models
```

(No GPU reservation block — `BODY_DETECTION_DEVICE=cpu` per Task 1's default; switching to GPU later is a one-line env change plus adding the same `deploy.resources.reservations.devices` block `xtts`/`qwen-tts` use, left for when a GPU slot is confirmed free, per the design doc's open question.)

- [ ] **Step 2: Add `AI_LAB_BODY_DETECTION_URL` to the gateway's environment**

Find (in the `gateway:` service block, alongside the other `*_BASE_URL` entries):

```yaml
      XTTS_BASE_URL: http://xtts:8020
      QWEN_TTS_BASE_URL: http://qwen-tts:8100
      FISH_SPEECH_BASE_URL: http://fish-speech:8080
```

Replace with:

```yaml
      XTTS_BASE_URL: http://xtts:8020
      QWEN_TTS_BASE_URL: http://qwen-tts:8100
      FISH_SPEECH_BASE_URL: http://fish-speech:8080
      BODY_DETECTION_BASE_URL: http://body-detection:8110
```

Apply the identical change to the `worker:` service block too (find the same three `*_BASE_URL` lines there — the worker, not just the gateway, needs this URL since `worker.ts` is what actually calls `BodyDetectionClient`).

- [ ] **Step 3: Validate the compose file**

```bash
docker compose config --quiet
```

Expected: no errors (validates YAML + variable interpolation without starting anything).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "Wire the body-detection service into docker-compose"
```

---

### Task 3: `ai-lab` job type, scope, route, worker case, client

**Repo:** `/home/cypher/Projects/ai-lab`

**Files:**
- Modify: `src/db/repositories.ts`
- Modify: `src/jobs/job-types.ts`
- Modify: `src/routes/job-routes.ts`
- Create: `src/clients/body-detection-client.ts`
- Create: `src/routes/body-detection-routes.ts`
- Modify: `src/jobs/worker.ts`
- Modify: `src/config.ts`
- Modify: `src/server.ts` (or wherever routes are registered — Step 6 locates the exact file)

**Interfaces:**
- Consumes: `BODY_DETECTION_BASE_URL` env var (Task 2).
- Produces: `POST /v1/vision/body-detection/async` (multipart zip upload → `{id, object: "job", type: "body_detection", status, created_at}`, HTTP 202). Existing `GET /v1/jobs/:id` (unchanged, already generic) returns the job with `result: {frames: [...]}` once `status: "succeeded"` — Task 4's FrameJump composable polls this exact endpoint, no new endpoint needed for reading the result (confirmed by reading `job-routes.ts`: JSON results live in the job's own `result` field, retrieved via `GET /v1/jobs/:id` — the separate `/output` route is reserved for binary/file results like `audio.speech`, not applicable here).

- [ ] **Step 1: Add `body_detection` to the type and scope enums**

In `src/db/repositories.ts`, find:

```ts
const scopeSchema = z.enum(["chat", "stt", "tts", "voice_clone", "admin"]);
```

Replace with:

```ts
const scopeSchema = z.enum(["chat", "stt", "tts", "voice_clone", "body_detection", "admin"]);
```

Find:

```ts
const jobTypeSchema = z.enum([
  "chat.completion",
  "audio.transcription",
  "audio.speech",
  "voice.clone.speech",
]);
```

Replace with:

```ts
const jobTypeSchema = z.enum([
  "chat.completion",
  "audio.transcription",
  "audio.speech",
  "voice.clone.speech",
  "body_detection",
]);
```

- [ ] **Step 2: Add `body_detection` to `jobCreateSchema`'s type enum**

In `src/jobs/job-types.ts`, find:

```ts
export const jobCreateSchema = z.object({
  type: z.enum([
    "chat.completion",
    "audio.transcription",
    "audio.speech",
    "voice.clone.speech",
  ]),
  request: z.record(z.string(), z.unknown()),
})
```

Replace with:

```ts
export const jobCreateSchema = z.object({
  type: z.enum([
    "chat.completion",
    "audio.transcription",
    "audio.speech",
    "voice.clone.speech",
    "body_detection",
  ]),
  request: z.record(z.string(), z.unknown()),
})
```

(No dedicated Zod request schema for `body_detection`, matching `audio.transcription`'s own precedent in this file — both are created exclusively through a dedicated multipart route, never through generic `POST /v1/jobs` with a raw JSON body, so there is nothing for a schema here to validate.)

- [ ] **Step 3: Map the new job type to its scope**

In `src/routes/job-routes.ts`, find:

```ts
const jobScopes: Record<JobType, Scope> = {
  "chat.completion": "chat",
  "audio.transcription": "stt",
  "audio.speech": "tts",
  "voice.clone.speech": "voice_clone",
};
```

Replace with:

```ts
const jobScopes: Record<JobType, Scope> = {
  "chat.completion": "chat",
  "audio.transcription": "stt",
  "audio.speech": "tts",
  "voice.clone.speech": "voice_clone",
  "body_detection": "body_detection",
};
```

- [ ] **Step 4: `BodyDetectionClient`**

Create `src/clients/body-detection-client.ts`:

```ts
import { ApiError } from "../errors.js"

export interface BodyDetectionLandmark {
  x: number
  y: number
  score: number
}

export interface BodyDetectionFrame {
  time: number
  landmarks: BodyDetectionLandmark[]
}

export class BodyDetectionClient {
  constructor(private readonly baseUrl: string) {}

  async detectFromZip(zipPath: string): Promise<{ frames: BodyDetectionFrame[] }> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/v1/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip_path: zipPath }),
      })
    } catch {
      throw new ApiError("Body-detection backend is unavailable", 503, "backend_unavailable")
    }

    if (!response.ok) {
      throw new ApiError(
        `Body-detection backend returned HTTP ${response.status}`,
        response.status >= 500 ? 503 : 502,
        "backend_unavailable",
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new ApiError("Body-detection backend returned invalid JSON", 502, "backend_bad_response")
    }

    const parsed = data as { frames?: unknown }
    if (!Array.isArray(parsed.frames)) {
      throw new ApiError("Body-detection backend response missing frames array", 502, "backend_bad_response")
    }

    return { frames: parsed.frames as BodyDetectionFrame[] }
  }
}
```

- [ ] **Step 5: `body-detection-routes.ts`**

Create `src/routes/body-detection-routes.ts`:

```ts
import fs from "node:fs/promises"
import { createWriteStream } from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { requireScope } from "../auth/auth-plugin.js"
import { ApiError } from "../errors.js"
import { createQueuedJob } from "../jobs/job-service.js"

// Same ceiling audio-routes.ts uses for its own async upload -- a clip's
// extracted-frames zip is far smaller than 2 GB in practice (a few hundred
// JPEG frames), this is a shared safety ceiling, not a tuned value for this
// specific payload shape.
const ASYNC_UPLOAD_SIZE_LIMIT = 2 * 1024 * 1024 * 1024

export async function registerBodyDetectionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/vision/body-detection/async",
    { bodyLimit: ASYNC_UPLOAD_SIZE_LIMIT },
    async (request, reply) => {
      const apiKey = requireScope(request, "body_detection")
      const uploadsDir = app.config.uploadsDir
      await fs.mkdir(uploadsDir, { recursive: true })

      let filePath: string | undefined
      let filename = "upload.zip"

      for await (const part of request.parts({ limits: { fileSize: ASYNC_UPLOAD_SIZE_LIMIT } })) {
        if (part.type === "file") {
          filename = part.filename || "upload.zip"
          const tmpName = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`
          filePath = path.join(uploadsDir, tmpName)
          const writeStream = createWriteStream(filePath)
          await new Promise<void>((resolve, reject) => {
            part.file.pipe(writeStream)
            part.file.on("end", resolve)
            part.file.on("error", reject)
            writeStream.on("error", reject)
          })
        }
      }

      if (!filePath) throw new ApiError("No zip file provided", 400, "invalid_request")

      const job = await createQueuedJob(
        app.repos,
        app.jobQueue,
        apiKey.projectId,
        "body_detection",
        { filePath, filename },
      )

      return reply.status(202).send({
        id: job.id,
        object: "job",
        type: job.type,
        status: job.status,
        created_at: job.createdAt,
      })
    },
  )
}
```

- [ ] **Step 6: Register the new route**

Routes are wired up in `src/app.ts`. Find the import block:

```ts
import { registerAudioRoutes } from "./routes/audio-routes.js";
import { registerChatRoutes } from "./routes/chat-routes.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerJobRoutes } from "./routes/job-routes.js";
import { registerModelRoutes } from "./routes/model-routes.js";
import { registerVoiceProfileRoutes } from "./routes/voice-profile-routes.js";
```

Replace with:

```ts
import { registerAudioRoutes } from "./routes/audio-routes.js";
import { registerBodyDetectionRoutes } from "./routes/body-detection-routes.js";
import { registerChatRoutes } from "./routes/chat-routes.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerJobRoutes } from "./routes/job-routes.js";
import { registerModelRoutes } from "./routes/model-routes.js";
import { registerVoiceProfileRoutes } from "./routes/voice-profile-routes.js";
```

Find:

```ts
  await registerModelRoutes(app);
  await registerChatRoutes(app);
  await registerAudioRoutes(app);
  await registerJobRoutes(app);
```

Replace with:

```ts
  await registerModelRoutes(app);
  await registerChatRoutes(app);
  await registerAudioRoutes(app);
  await registerBodyDetectionRoutes(app);
  await registerJobRoutes(app);
```

- [ ] **Step 7: Add the worker case**

In `src/jobs/worker.ts`, find the `import` block near the top (alongside the other client imports):

```ts
import { WhisperClient } from "../clients/whisper-client.js"
```

Add immediately after:

```ts
import { BodyDetectionClient } from "../clients/body-detection-client.js"
```

Find the `ProcessorDeps` interface:

```ts
interface ProcessorDeps {
  repos: ReturnType<typeof ReposType>
  modelManager: ModelManagerClient
  llamaBaseUrl: string
  whisperBaseUrl: string
  xttsBaseUrl: string
  fishSpeechBaseUrl: string
  qwenTtsBaseUrl: string
  voiceProfilesDir: string
}
```

Replace with:

```ts
interface ProcessorDeps {
  repos: ReturnType<typeof ReposType>
  modelManager: ModelManagerClient
  llamaBaseUrl: string
  whisperBaseUrl: string
  xttsBaseUrl: string
  fishSpeechBaseUrl: string
  qwenTtsBaseUrl: string
  bodyDetectionBaseUrl: string
  voiceProfilesDir: string
}
```

Find where the existing clients are constructed inside `createWorkerProcessor`:

```ts
export function createWorkerProcessor(deps: ProcessorDeps) {
  const { repos, modelManager, llamaBaseUrl, whisperBaseUrl, xttsBaseUrl, fishSpeechBaseUrl, qwenTtsBaseUrl, voiceProfilesDir } = deps
  const llama = new LlamaClient(llamaBaseUrl)
  const whisper = new WhisperClient(whisperBaseUrl)
  const xtts = new XttsClient(xttsBaseUrl)
  const fish = new FishSpeechClient(fishSpeechBaseUrl)
  const qwen = new QwenTtsClient(qwenTtsBaseUrl)
```

Replace with:

```ts
export function createWorkerProcessor(deps: ProcessorDeps) {
  const { repos, modelManager, llamaBaseUrl, whisperBaseUrl, xttsBaseUrl, fishSpeechBaseUrl, qwenTtsBaseUrl, bodyDetectionBaseUrl, voiceProfilesDir } = deps
  const llama = new LlamaClient(llamaBaseUrl)
  const whisper = new WhisperClient(whisperBaseUrl)
  const xtts = new XttsClient(xttsBaseUrl)
  const fish = new FishSpeechClient(fishSpeechBaseUrl)
  const qwen = new QwenTtsClient(qwenTtsBaseUrl)
  const bodyDetection = new BodyDetectionClient(bodyDetectionBaseUrl)
```

Find the end of the `case "audio.transcription":` block (its closing `break` and the next case, `case "voice.clone.speech":`) — insert the new case between them:

```ts
          break
        }

        case "voice.clone.speech": {
```

Replace with:

```ts
          break
        }

        case "body_detection": {
          const dbJob = repos.jobs.find(jobId)
          const req = dbJob!.request as { filePath: string; filename?: string }

          try {
            const result = await bodyDetection.detectFromZip(req.filePath)
            await fs.unlink(req.filePath).catch(() => {})
            repos.jobs.markSucceeded(jobId, result)
          } catch (err) {
            if (!(err instanceof ApiError && err.statusCode === 503)) {
              await fs.unlink(req.filePath).catch(() => {})
            }
            throw err
          }
          break
        }

        case "voice.clone.speech": {
```

(No chunking, no lease/model-manager coordination — unlike `audio.transcription`'s multi-chunk GPU-lease dance, `body_detection` sends the whole zip in one call, and the RTMPose service is always-resident, not loaded/unloaded per request, so there is nothing to lease.)

- [ ] **Step 8: Wire `bodyDetectionBaseUrl` through `src/config.ts`**

Find:

```ts
  XTTS_BASE_URL: z.string().url().default("http://xtts:8020"),
  QWEN_TTS_BASE_URL: z.string().url().default("http://qwen-tts:8100"),
  FISH_SPEECH_BASE_URL: z.string().url().default("http://fish-speech:8080"),
```

Replace with:

```ts
  XTTS_BASE_URL: z.string().url().default("http://xtts:8020"),
  QWEN_TTS_BASE_URL: z.string().url().default("http://qwen-tts:8100"),
  FISH_SPEECH_BASE_URL: z.string().url().default("http://fish-speech:8080"),
  BODY_DETECTION_BASE_URL: z.string().url().default("http://body-detection:8110"),
```

Find:

```ts
  xttsBaseUrl: string;
  qwenTtsBaseUrl: string;
  fishSpeechBaseUrl: string;
```

Replace with:

```ts
  xttsBaseUrl: string;
  qwenTtsBaseUrl: string;
  fishSpeechBaseUrl: string;
  bodyDetectionBaseUrl: string;
```

Find:

```ts
    xttsBaseUrl: parsed.XTTS_BASE_URL,
    qwenTtsBaseUrl: parsed.QWEN_TTS_BASE_URL,
    fishSpeechBaseUrl: parsed.FISH_SPEECH_BASE_URL,
```

Replace with:

```ts
    xttsBaseUrl: parsed.XTTS_BASE_URL,
    qwenTtsBaseUrl: parsed.QWEN_TTS_BASE_URL,
    fishSpeechBaseUrl: parsed.FISH_SPEECH_BASE_URL,
    bodyDetectionBaseUrl: parsed.BODY_DETECTION_BASE_URL,
```

- [ ] **Step 9: Wire `bodyDetectionBaseUrl` into the worker's own entry point**

`src/jobs/worker.ts` is both the module Step 7 edited AND the worker process's own entry point — it ends with an `if (import.meta.url === ...)` main guard (this is what `npm run worker` / `tsx src/jobs/worker.ts` actually runs) that builds the real config and calls `createWorkerProcessor`. Find:

```ts
  const processor = createWorkerProcessor({
    repos,
    modelManager,
    llamaBaseUrl: config.llamaBaseUrl,
    whisperBaseUrl: config.whisperBaseUrl,
    xttsBaseUrl: config.xttsBaseUrl,
    fishSpeechBaseUrl: config.fishSpeechBaseUrl,
    qwenTtsBaseUrl: config.qwenTtsBaseUrl,
    voiceProfilesDir: config.voiceProfilesDir,
  })
```

Replace with:

```ts
  const processor = createWorkerProcessor({
    repos,
    modelManager,
    llamaBaseUrl: config.llamaBaseUrl,
    whisperBaseUrl: config.whisperBaseUrl,
    xttsBaseUrl: config.xttsBaseUrl,
    fishSpeechBaseUrl: config.fishSpeechBaseUrl,
    qwenTtsBaseUrl: config.qwenTtsBaseUrl,
    bodyDetectionBaseUrl: config.bodyDetectionBaseUrl,
    voiceProfilesDir: config.voiceProfilesDir,
  })
```

- [ ] **Step 10: Typecheck and build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add src/db/repositories.ts src/jobs/job-types.ts src/routes/job-routes.ts src/clients/body-detection-client.ts src/routes/body-detection-routes.ts src/jobs/worker.ts src/config.ts src/app.ts
git commit -m "Add the body_detection job type: scope, route, worker case, client"
```

---

### Task 4: FrameJump client — package, upload, poll

**Repo:** `jump-measurer` (SDD worktree)

**Files:**
- Create: `src/composables/useServerBodyDetection.ts`
- Modify: `package.json` (add `jszip` dependency)

**Interfaces:**
- Consumes: `PoseFrame[]` shape already produced by `usePoseDetection.ts`'s `scan()` (has `.time` and `.landmarks`, but this composable only needs the raw video frames to re-extract JPEGs from — see Step 2 for why it captures its own canvas snapshots rather than reusing MediaPipe's landmark output).
- Produces: `useServerBodyDetection(videoRef: Ref<HTMLVideoElement | null>)` returning `{ status: Ref<'idle'|'uploading'|'processing'|'done'|'error'>, result: Ref<{ frames: BodyDetectionFrame[] } | null>, error: Ref<string | null>, run: () => Promise<void> }`, where `BodyDetectionFrame = { time: number, landmarks: { x: number, y: number, score: number }[] }` (17 entries, COCO order) — a NEW type, not `PoseFrame`.

- [ ] **Step 1: Add `jszip`**

```bash
npm install jszip
```

- [ ] **Step 2: `useServerBodyDetection.ts`**

Create `src/composables/useServerBodyDetection.ts`:

```ts
import { ref, type Ref } from 'vue'
import JSZip from 'jszip'

export interface BodyDetectionLandmark {
  x: number
  y: number
  score: number
}

export interface BodyDetectionFrame {
  time: number
  landmarks: BodyDetectionLandmark[]
}

export type ServerDetectionStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

/**
 * Plumbing-only: packages frames extracted directly from the video element
 * into a zip and uploads them to ai-lab's body_detection job type, then polls
 * for the result. Captures its own canvas snapshots rather than reusing
 * usePoseDetection.ts's scan() output, deliberately -- this composable proves
 * the server pipe works in isolation, independent of the existing MediaPipe
 * pipeline's own frame-sampling choices. Wiring the two together (sharing one
 * frame-extraction pass, feeding the result into measureJump) is explicitly
 * out of scope -- see docs/2026-08-05-server-body-detection-plumbing-design.md
 * section 7.
 */
export function useServerBodyDetection(
  videoRef: Ref<HTMLVideoElement | null>,
  baseUrl: string,
  apiKey: string,
) {
  const status = ref<ServerDetectionStatus>('idle')
  const result = ref<{ frames: BodyDetectionFrame[] } | null>(null)
  const error = ref<string | null>(null)

  const POLL_INTERVAL_MS = 1500
  const POLL_TIMEOUT_MS = 120_000
  // Every frame, at the video's own frame rate -- matches the "extract every
  // frame" choice usePoseDetection.ts's planFullPass already made for the
  // MediaPipe pipeline this composable is deliberately independent of, kept
  // consistent so a side-by-side comparison isn't confounded by different
  // sampling rates.
  const SAMPLE_STEP_SECONDS = 1 / 30

  async function extractFrames(video: HTMLVideoElement): Promise<{ time: number; blob: Blob }[]> {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    const frames: { time: number; blob: Blob }[] = []
    const duration = video.duration
    for (let t = 0; t < duration; t += SAMPLE_STEP_SECONDS) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = t
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob) frames.push({ time: t, blob })
    }
    return frames
  }

  async function packageZip(frames: { time: number; blob: Blob }[]): Promise<Blob> {
    const zip = new JSZip()
    const manifest = frames.map((f, index) => ({ index, time: f.time }))
    zip.file('manifest.json', JSON.stringify(manifest))
    frames.forEach((f, index) => {
      zip.file(`frame_${String(index).padStart(4, '0')}.jpg`, f.blob)
    })
    return zip.generateAsync({ type: 'blob' })
  }

  async function pollJob(jobId: string): Promise<{ frames: BodyDetectionFrame[] }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`Job status check failed: HTTP ${res.status}`)
      const job = await res.json() as { status: string; result?: { frames: BodyDetectionFrame[] }; error?: string }
      if (job.status === 'succeeded' && job.result) return job.result
      if (job.status === 'failed') throw new Error(job.error ?? 'Body-detection job failed')
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error('Timed out waiting for body-detection job to complete')
  }

  async function run(): Promise<void> {
    const video = videoRef.value
    if (!video) {
      error.value = 'No video loaded'
      status.value = 'error'
      return
    }

    error.value = null
    result.value = null

    try {
      status.value = 'uploading'
      const frames = await extractFrames(video)
      const zipBlob = await packageZip(frames)

      const form = new FormData()
      form.append('file', zipBlob, 'frames.zip')

      const uploadRes = await fetch(`${baseUrl}/v1/vision/body-detection/async`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      })
      if (!uploadRes.ok) throw new Error(`Upload failed: HTTP ${uploadRes.status}`)
      const job = await uploadRes.json() as { id: string }

      status.value = 'processing'
      result.value = await pollJob(job.id)
      status.value = 'done'
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      status.value = 'error'
    }
  }

  return { status, result, error, run }
}
```

- [ ] **Step 3: Typecheck**

```bash
npx vue-tsc -b
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/composables/useServerBodyDetection.ts
git commit -m "Add useServerBodyDetection: package frames, upload to ai-lab, poll for landmarks"
```

---

### Task 5: Dev-only trigger and raw-result display

**Repo:** `jump-measurer` (SDD worktree)

**Files:**
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `useServerBodyDetection` (Task 4).

- [ ] **Step 1: Find where `pose` (the existing `usePoseDetection` instance) is wired into the template in `src/App.vue`**

```bash
grep -n "usePoseDetection\|pose\.run\|pose\.status" src/App.vue
```

- [ ] **Step 2: Add a dev-only button and raw result display**

Alongside the existing pose-detection wiring, add a call to `useServerBodyDetection` and a minimal UI trigger. The exact placement (near the existing "Найти прыжок автоматически" button, or in a separate dev panel) is an implementation detail — place it visibly but clearly labeled as a dev/test path (e.g. a button reading "Body detection (server, dev)"), matching this plan's explicit scope: prove the pipe works, not ship a polished feature. Read the API base URL and key from Vite env vars (`import.meta.env.VITE_AI_LAB_BASE_URL`, `import.meta.env.VITE_AI_LAB_API_KEY`) — add both to a new `.env.local` (gitignored, not committed) for local testing, and document the two variable names in a comment at the call site so a future reader knows where to set them.

On click, call `run()`, and once `status.value === 'done'`, render `result.value` — a plain `<pre>{{ JSON.stringify(result, null, 2) }}</pre>` is sufficient for this plumbing-proving step; a real debug overlay is out of scope (see design doc section 7).

- [ ] **Step 3: Manual verification in the browser**

```bash
npm run dev -- --host
```

Upload the real motivating clip (`1.mp4`, from earlier debugging in this project's history). Click the new dev button. Confirm: upload succeeds, job status transitions from `processing` to `done`, and the displayed result contains a `frames` array with `landmarks` entries whose `score` values are mostly well above 0 for the frames known to make MediaPipe fail entirely (see the offline comparison this plan is based on) — this is the actual proof the pipe delivers what it promises, not just that it doesn't crash.

- [ ] **Step 4: Commit**

```bash
git add src/App.vue
git commit -m "Add a dev-only trigger for the server body-detection pipe"
```

---

### Task 6: End-to-end validation

**Files:** none changed — this is verification.

- [ ] **Step 1: `ai-lab` side**

```bash
cd /home/cypher/Projects/ai-lab
docker compose --profile models build body-detection gateway worker
docker compose --profile models up -d body-detection gateway worker redis
curl -s http://127.0.0.1:8080/healthz  # or whatever the gateway's own healthcheck path is -- confirm via README/existing scripts
```

Expected: all three containers start and stay up (no crash-loop). Confirm `body-detection`'s own health via `docker compose exec body-detection curl -s http://localhost:8110/healthz` — expect `{"ok": true}`.

- [ ] **Step 2: Create a `body_detection`-scoped API key**

Follow `ai-lab`'s existing admin-key-creation flow (see `README.md`'s admin bootstrap section) to mint a key with the `body_detection` scope. Record it for Step 3.

- [ ] **Step 3: `jump-measurer` side, manual browser check**

Already covered by Task 5 Step 3 — re-run it here as the final, whole-pipe confirmation, now against the fully-composed `ai-lab` stack (not a partial `docker build` check) and a freshly-minted real API key. Set `VITE_AI_LAB_BASE_URL`/`VITE_AI_LAB_API_KEY` in `.env.local` to the real gateway address and Step 2's key.

- [ ] **Step 4: Record the outcome**

No commit for this task. If any step fails, that becomes a new, separately-scoped fix — not a same-task patch to already-committed code from Tasks 1-5.
