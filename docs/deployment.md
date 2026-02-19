# Deployment Guide

## Target Topology

Deploy as two containers on the same Docker network:

1. `app` (Nest orchestrator + API + UI)
2. `clip-scorer` (isolated CLIP scoring service)

This keeps CLIP runtime crashes isolated from the main app.

## Environment Variables

### App container

- `CLIP_SCORER_URL=http://clip-scorer:4310`
- `CLIP_SCORER_USE_LOCAL_FALLBACK=false`
- `SOURCED_IMAGE_DISABLE_CLIP=false`
- `SOURCED_IMAGE_DISABLE_VISION=true` (or `false` when vision gate is enabled)
- `UNSPLASH_ACCESS_KEY=<your_unsplash_access_key>`

### CLIP scorer container

- `CLIP_SCORER_PORT=4310`
- `CLIP_SCORER_HOST=0.0.0.0`
- `CLIP_SCORER_MODEL=Xenova/clip-vit-base-patch32`

## Runtime Contract

`clip-scorer` exposes:

- `GET /health` -> `{ ok: true }`
- `POST /score`
  - request: `{ "imageUrl": "...", "brief": "..." }`
  - response: `{ "ok": true, "score": 0.0-1.0, "latency_ms": number, "model": "..." }`

## Minimal Docker Compose Example

```yaml
services:
  app:
    build: .
    environment:
      CLIP_SCORER_URL: http://clip-scorer:4310
      CLIP_SCORER_USE_LOCAL_FALLBACK: "false"
      SOURCED_IMAGE_DISABLE_CLIP: "false"
      SOURCED_IMAGE_DISABLE_VISION: "true"
      UNSPLASH_ACCESS_KEY: ${UNSPLASH_ACCESS_KEY}
    depends_on:
      - clip-scorer
    ports:
      - "3000:3000"

  clip-scorer:
    image: node:20
    working_dir: /app
    volumes:
      - ./:/app
    command: ["node", "tools/clip-scorer/server.js"]
    environment:
      CLIP_SCORER_PORT: "4310"
      CLIP_SCORER_HOST: "0.0.0.0"
      CLIP_SCORER_MODEL: Xenova/clip-vit-base-patch32
    ports:
      - "4310:4310"
```

## Health and Fail-Fast

- App task-level timeout: `MANIFEST_TASK_TIMEOUT_MS`
- Sourced-image timeout: `SOURCED_IMAGE_TIMEOUT_MS`
- If `clip-scorer` is unavailable and fallback is disabled, task fails fast with clear error.
- Recommended production setting: keep `CLIP_SCORER_USE_LOCAL_FALLBACK=false`.
