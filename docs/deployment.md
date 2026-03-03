# Deployment Guide

## Target Topology

Deploy as three application services plus PostgreSQL:

1. `app-api` (Nest API, dashboard UI, WebSocket observability fanout)
2. `app-worker` (durable queue consumer only)
3. `image-quality-control` (IQC sidecar for CLIP + Vision scoring)
4. `postgres` (state, queue, observability persistence)

Observability stays in `app-api`. Workers write to Postgres; API streams state to the dashboard.

## Runtime Commands

- API only: `npm start`
- Worker only: `npm run start:worker`
- IQC only: `npm run start:image-quality-control`
- Legacy combined runtime (compatibility): `npm run start:runtime`

## Environment Contract

### Shared (API + Worker)

- `POSTGRES_ENABLED=true`
- `DATABASE_URL=postgresql://...`
- `IQC_URL=http://image-quality-control:4310`
- `QUALITY_CONTROL_TIMEOUT_MS=12000`

Compatibility alias remains supported:

- `CLIP_SCORER_URL` (fallback alias when `IQC_URL` is unset)

### IQC service

- `IQC_HOST=0.0.0.0`
- `IQC_PORT=4310`
- `OPENROUTER_API_KEY=<key>` (required for vision scoring)
- `OPENROUTER_VISION_MODEL=<optional override>`

## IQC HTTP API

- `GET /health`
  - response: `{ ok, service, clip_model, vision_model, vision_enabled }`
- `POST /score/clip`
  - request: `{ imageUrl, brief }`
  - response: `{ ok, score, positive_score, strongest_negative_score, strongest_negative_label, ... }`
- `POST /score/vision`
  - request: `{ imageUrl, brief, domain?, style? }`
  - response: `{ ok, score, reason, ... }`
- `POST /score/composite`
  - request: `{ imageUrl, brief, domain?, style?, clipWeight?, clipThreshold?, disableClip?, disableVision? }`
  - response: `{ ok, clip_score, vision_score, weighted_score, clip_pass, vision_pass, accepted, ... }`

Backward-compatible endpoint:

- `POST /score` (alias of `/score/clip`)

## Local Compose

Use `docker-compose.yml` from repo root:

```bash
docker compose up --build
```

This starts `app-api`, `app-worker`, `image-quality-control`, and `postgres` with shared generated-asset storage.

## Railway Cutover (Simple)

1. Deploy `image-quality-control` service first.
2. Deploy `app-worker` service (`npm run start:worker`).
3. Switch existing app service to API-only (`npm start`).
4. Set envs:
   - API and worker: `IQC_URL`, `DATABASE_URL`, `POSTGRES_ENABLED=true`
   - IQC: `OPENROUTER_API_KEY`
5. Run smoke test with one manifest and confirm:
   - queue updates in dashboard
   - worker task completion
   - IQC scoring logs present

## Rollback

1. Redeploy prior API image/tag and run legacy runtime (`npm run start:runtime`) if needed.
2. Disable/scale down split `app-worker` and `image-quality-control`.
3. Keep PostgreSQL unchanged (no destructive schema rollback required).
