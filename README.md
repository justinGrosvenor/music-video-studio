# Music Video Studio

> Audio-aware AI timeline editor for music videos. Drop in a song, get a beat-aware timeline of clips, fill each one with AI-generated video, and render to MP4.

https://github.com/user-attachments/assets/94b6d14f-810e-4a53-9af6-22135417e87c

*Music in the demo: [listen on Spotify](https://open.spotify.com/album/0qT88s29ZYPSsnXdSFzGxI?si=CYHK5WwoREeWhQKW1sfVOA).*

![Music Video Studio — night-drive project](docs/editor-2.png)

*Night-drive project: audio-analysis panel on the left, lookbook above it, section-labeled timeline below, mid-generation state visible.*

![Music Video Studio — biomech project](docs/editor.png)

*A different project mid-edit: the **AUDIO CONTEXT** panel auto-feeds section / energy / duration into every generation, and **Bridge between neighbors** interpolates from the previous clip's last frame to the next's first frame for seamless cuts.*

**Live demo:** https://d12ma5ztmnspan.cloudfront.net (basic-auth gated — creds on request).


## What it does

Upload a track → audio analyzer extracts BPM / beats / sections / energy → the timeline auto-subdivides into clips snapped to detected boundaries → for each clip you pick a generation source (continue, lookbook seed, fresh text-to-image, text-to-video, lip-sync, video-restyle) and a model, then click Generate → ffmpeg stitches the finished clips into an MP4 against the original audio.

## Repo layout

| Path | What |
|---|---|
| `apps/web` | React 19 + Vite SPA — timeline, waveform, sidebar, preview |
| `apps/api` | Fastify API — generation, render, storage, library |
| `packages/shared` | Zod schemas + TS types shared across web and api |
| `modal/` | Python audio analysis (librosa) — see [modal/README.md](modal/README.md) |
| `infra/` | Terragrunt + Terraform for AWS deploy — see [infra/README.md](infra/README.md) |
| `wireframes/` | Initial design exploration |

## Features

### Audio
- Upload mp3 / wav / flac / ogg / m4a, validated by magic-byte sniff (MIME headers can lie).
- Modal-deployed analyzer with a local FastAPI fallback for dev. Returns BPM, key, beats, downbeats, onsets, normalized RMS curve, and section boundaries.
- Section detection on a beat-synced multi-feature stack — chroma (harmony), MFCC (timbre), RMS (dynamics) — agglomerative clustering with adaptive `k` (~1 section per 25s, clamped 4–12). Boundaries snap to the nearest downbeat within ~0.6 of a bar; sections shorter than ~4 bars get merged out.
- Voice isolation via Runway → cached vocal stem per song.
- Region-accurate audio slicing (re-encoded to mp3 for frame-accurate seeks).
- Swap song mid-project — cast and lookbook survive, timeline resets.

### Timeline
- Sections auto-subdivide into clips (max 15s, min 0.5s) with cuts snapped to the nearest beat.
- Per-clip split (`S`) and merge-right (`M`) with beat snapping.
- Drag clip boundaries; cap-aware so neither side can grow past the 15s generation limit.
- WaveSurfer.js waveform with overlay rows for sections, lyrics, and clip lanes.
- Zoom 1×–32× with `+` / `-` / `0` shortcuts.
- Drag-and-drop video files from the filesystem onto any clip.
- Video thumbnails on filled clips; clear button (×) on hover.
- Split / merge controls in the transport bar.

### Generation sources (per clip)
- **Continue from previous clip** — extracts the last frame of the prior generated video and uses it as the init image. Defaults whenever a previous clip is ready.
- **Seed from lookbook** — pick a specific lookbook image (or drop a one-off seed) as the init frame.
- **Generate fresh image** — text-to-image first, then image-to-video. Lookbook flows through as `references` for style consistency. Separate image-prompt and motion-prompt fields.
- **Text-to-video** — prompt → video in one Runway task, no seed image.
- **Character sings this section** (Lip-sync) — slices the song region, isolates vocals, drives the avatar's lip motion.
- **Restyle existing clip** (Aleph) — video-to-video transformation of an already-generated clip.

### Runway models exposed
| Path | Models |
|---|---|
| Image-to-video | Gen-4.5, Gen-4 Turbo, SeedDance 2, Veo 3.1, Veo 3.1 Fast |
| Text-to-video | Gen-4.5, SeedDance 2, Veo 3.1, Veo 3.1 Fast |
| Text-to-image | Gen-4 Image, Gen-4 Image Turbo, GPT Image 2, Gemini Imagen 3 Pro, Gemini 2.5 Flash |
| Video-to-video (Aleph) | Gen-4 Aleph, SeedDance 2 |
| Lip-sync | GWM-1 Avatars |
| Voice isolation | ElevenLabs (via Runway) |

Per-model duration is auto-snapped to whatever each model accepts (e.g. Gen-4.5: 2–10s int, Gen-4 Turbo: 5/8/10, Veo 3.1: 4/6/8, SeedDance: 5–15).

### Cast / lookbook
- Upload a character image, then create a Runway avatar from it (personality + voice preset).
- Browse and pick existing avatars from the workspace.
- Lookbook (up to 16 reference images): upload directly, or generate via the in-app image generator (prompt + model + ratio + optional reference toggle).
- Generated images auto-save to the image library and rehost external URLs to local/S3 storage.
- Generated images can flow into the Lookbook and back out as references for subsequent generations — coherent style across a project for free.
- Click any lookbook image to expand it in a lightbox.

### Preview
- Double-buffered video preview — two `<video>` elements alternate so the next clip preloads with no black flash at boundaries.
- Fullscreen mode on the preview panel.
- Tabbed right sidebar (Image | Video) — auto-switches to Video tab when a clip is selected.

### Project lifecycle
- Save / load projects to the API; local autosave to `localStorage` with Zod-validated rehydration.
- Per-clip Save-to-Library for reusable generated clips.
- Library browser for saved projects, renders, and individual clips.
- Render to MP4 via an ffmpeg overlay graph against the project's audio. Optional 150ms alpha fade-in/out per clip boundary.

### Job scheduler
- Browser-side concurrency cap (3 in-flight Runway tasks).
- Continue clips block on the previous clip's completion (dependency wait, no race).
- Per-job state: `queued` / `running` / `succeeded` / `failed` / `cancelled`. Cancellable in-flight.
- Resume inflight generation jobs on page refresh (no lost work).
- Model-aware poll timeouts: 15 min for SeedDance 2 / Veo 3.1, 10 min for others.
- Toast notifications + queue chip in the header.

### Storage
- Pluggable backend: `local` (disk under `STORAGE_DIR`) or `s3` (with optional CloudFront base URL).
- Content-addressed by SHA256 — re-uploading the same file deduplicates.

### Reliability / validation
- ffmpeg subprocess wrapper with a 10-minute kill-on-timeout and an `FfmpegError` class so stderr stays in server logs and never leaks to clients.
- All API bodies are Zod-validated; ZodError → 400 with field-level messages.
- Runway rate-limit detection → 429 with a "resets at midnight UTC" hint.
- Render body caps: ≤ 500 clips, ≤ 1h total duration, finite numbers, `end > start` per clip, no clips past the project's audio duration.
- Analysis cache and persisted snapshot both schema-validate on read; corrupt entries fail clean instead of poisoning the project.

### Infra
- Terragrunt + Terraform stack for AWS: ALB + ECS Fargate + ECR + S3 storage + IAM.
- Modal app for audio analysis (CPU, librosa). Local FastAPI sidecar mirrors the same endpoint for dev.

## Stack

- `apps/web` — React 19 + Vite + React Router v7 (SPA mode) + WaveSurfer.js + Zustand
- `apps/api` — Fastify + TypeScript + `@runwayml/sdk@3.21` + ffmpeg
- `packages/shared` — Zod schemas + TS types shared across web and api
- `modal/` — Python audio analysis (librosa) — Modal endpoint + local FastAPI fallback

## Setup

```bash
pnpm install
cp .env.example .env  # fill in RUNWAYML_API_SECRET and MODAL_AUDIO_URL
```

Deploy the Modal audio function:

```bash
cd modal && modal deploy audio_analysis.py
```

Save the printed URL into `.env` as `MODAL_AUDIO_URL`. (Or run `pnpm dev:analyzer` for a local FastAPI sidecar on `:3002` and point `MODAL_AUDIO_URL` at `http://localhost:3002`.)

## Run

Three processes:

```bash
pnpm dev:analyzer   # http://localhost:3002 — Python audio analysis (librosa)
pnpm dev:api        # http://localhost:3001 — Fastify
pnpm dev:web        # http://localhost:5173 — Vite
```

`pnpm dev` runs the api and web in parallel but **not** the analyzer (Python venv, not a workspace package). Forgetting the analyzer is the common dev gotcha — uploads will silently sit in `pending` forever.

The Vite dev server proxies `/api` and `/storage` to Fastify.

**Heads up:** `--env-file-if-exists` only loads `.env` at process start, so editing `.env` requires restarting `dev:api`.

## Architecture

```
┌─ Browser ──────────────────────────┐
│  Vite dev server (5173)            │
│  ├─ React Router v7 (SPA)          │
│  ├─ Zustand store (project state)  │
│  ├─ WaveSurfer.js (waveform)       │
│  ├─ Browser job scheduler (cap=3)  │
│  └─ /api/* proxied to Fastify      │
└────────────────────────────────────┘
              │
┌─ Fastify (3001) ───────────────────┐
│  /api/songs/upload                 │── kicks off async analysis
│  /api/songs/:id/analysis           │── poll for ready
│  /api/songs/vocal-stem             │── voice isolation (cached)
│  /api/audio/slice                  │── ffmpeg cut
│  /api/images/upload                │── magic-byte sniff
│  /api/videos/upload                │── drag-and-drop import
│  /api/avatars · /api/avatars/create│── Runway avatars
│  /api/generate/image-to-video      │── 5 models
│  /api/generate/video-to-video      │── Aleph
│  /api/generate/text-to-image       │── 5 models
│  /api/generate/text-to-video       │── 4 models
│  /api/generate/lip-sync            │── GWM-1 Avatars
│  /api/videos/extract-last-frame    │── ffmpeg → png seed
│  /api/tasks/:id                    │── poll Runway tasks
│  /api/render                       │── ffmpeg stitch to MP4
│  /api/projects · /api/clips        │── server-side library
│  /storage/*                        │── static file server
└────────────────────────────────────┘
              │
┌─ External ─────────────────────────┐
│  Modal (audio analysis)            │
│  Runway API (generation primitives)│
│  S3 (prod storage backend, opt.)   │
└────────────────────────────────────┘
```

## Deploy (Fargate)

```bash
docker build -f apps/api/Dockerfile -t music-video-studio-api .
# push to ECR, point an ECS Fargate task at it, expose port 3001 behind an ALB
```

The Dockerfile is multi-stage: `pnpm deploy` flattens the workspace into a self-contained `node_modules` tree; runtime image is `node:22-bookworm-slim` with `ffmpeg` apt-installed.

Task definition env vars:
- `RUNWAYML_API_SECRET`
- `MODAL_AUDIO_URL`
- `PUBLIC_BASE_URL` — the ALB domain (Modal/Runway fetch uploads from here)
- `WEB_ORIGIN` — wherever the SPA is hosted
- `STORAGE_BACKEND` — `local` or `s3` (prod)
- `S3_BUCKET` / `S3_REGION` / `S3_PUBLIC_URL_BASE` — if `s3`

Container disk is ephemeral. Mount EFS at `/app/storage` if you need local-backend persistence across task restarts; otherwise prefer `s3`.

See `infra/README.md` for the Terragrunt + Terraform bootstrap flow.

## Known limitations

- Externally-pasted generation URLs expire 24–48h after creation. Generated clips and lookbook images are auto-rehosted to local/S3 storage on save, but a direct paste of a still-live URL is not.
- Section labels are positional (`section 1`, `section 2`, …) — semantic labels (`verse`, `chorus`, `bridge`) require swapping the analyzer for `allin1` (GPU, Modal-only).
- Render is a v1 overlay graph: hard cuts by default with optional 150ms alpha fades. No crossfades or transitions yet.
