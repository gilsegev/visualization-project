# Containerization Execution Plan (Branch-Isolated, Local-First)

## Summary

Execute the full re-architecture on a dedicated Git branch named `containerization`, keeping `main` production-safe. Build and validate locally first, then deploy to Railway only after local acceptance gates pass.

## Branch and Repo Safety Strategy

### Branch Model

- `main`: production-safe baseline only.
- `containerization`: all topology/container/IQC re-architecture work.
- Optional follow-up hardening branches off `containerization`:
  - `containerization-iqc`
  - `containerization-compose`
  - `containerization-railway`

### Commit Policy

- Small, reversible commits by phase.
- No mixed-purpose commits (e.g., no styling/refactor noise mixed with topology changes).
- Tag stable checkpoints:
  - `containerization-phase1-local-pass`
  - `containerization-phase2-compose-pass`
  - `containerization-phase3-railway-ready`

### Merge Policy

Do not merge `containerization` into `main` until:

- local compose validation passes
- rollback docs are complete
- Railway smoke tests pass on split services

## Implementation Plan (on `containerization` branch)

### Phase 1: Image Quality Control (IQC) Service

- Create/rename service from clip scorer to `image-quality-control`.
- Add endpoints:
  - `GET /health`
  - `POST /score/clip`
  - `POST /score/vision`
  - `POST /score/composite` (or keep policy in worker initially, but endpoint contract defined now).
- Move current vision gate logic into IQC (OpenRouter-backed).
- Preserve existing scoring semantics (threshold/fallback parity).

### Phase 2: Worker Integration with IQC

- Replace direct clip/vision logic paths in worker with IQC client calls.
- Keep fallback/degraded behavior when IQC is unavailable.
- Emit structured metadata (`task_id`, `batch_id`, `event_id`, `source`) around IQC calls and decisions.

### Phase 3: Service Split and Startup Roles

- Keep observability in `app-api`.
- Ensure API runs without spawning workers.
- Ensure worker runs as standalone consumer.
- Keep legacy `start-runtime` only for compatibility/local legacy mode.

### Phase 4: Local Docker Compose Topology

- Add compose stack:
  - `app-api`
  - `app-worker`
  - `image-quality-control`
  - `postgres` (or external DB option toggle)
- Add healthchecks/readiness for all services.
- Add shared volume strategy for generated assets.
- Verify internal DNS/service URL wiring (`IQC_URL`, DB URL, etc.).

### Phase 5: Railway-Ready Packaging (After Local Pass)

- Keep Docker standards; avoid Railway-only logic.
- Define per-service command/env matrix for split deployment.
- Prepare simple cutover runbook (API-only service, worker service, IQC service).

## Local Validation Gates (Must Pass Before Railway)

### Functional

- Manifest generation succeeds end-to-end in compose.
- Sourced-image path uses IQC for both clip and vision.
- Dashboard/WS observability remains fully functional from API service.

### Resilience

- Stop IQC during run:
  - worker degrades/falls back as configured; queue remains healthy.
- Kill worker mid-task:
  - requeue/recovery works.
- Restart API:
  - no task loss; dashboard rehydrates active batch state.

### Debuggability

- Single task traceable across API/worker/IQC logs via correlation IDs.
- Batch diagnostics still filters correctly to active batch.
- Errors clearly identify failing service boundary.

### Performance Sanity

- API responsiveness improves under concurrent worker load vs monolith runtime.
- No material regression in completion time for baseline manifest set.

## Deployment Plan (Post-Local Confidence)

### Railway Simple Cutover

- Deploy `image-quality-control` service.
- Deploy `app-worker` service.
- Convert API service to `app-api` role only.
- Run smoke manifest and queue/WS checks.
- Scale worker replicas as needed.

### Rollback

- Revert API to previous runtime mode and previous image tag.
- Disable split worker/IQC services.
- Keep DB state intact (no destructive migration required for rollback).

## Public Interfaces / Contracts to Lock

- IQC endpoint request/response schemas.
- Worker->IQC timeout and retry behavior.
- Env names and defaults:
  - `IQC_URL`
  - `QUALITY_CONTROL_TIMEOUT_MS`
  - `OPENROUTER_API_KEY` (IQC scope)
  - compatibility aliasing for old clip scorer vars (temporary).

## Assumptions and Defaults

- Observability remains in API for this re-architecture phase.
- IQC includes both CLIP and Vision using OpenRouter for vision.
- Work is isolated on `containerization` branch until validated.
- Local-first validation is mandatory before Railway deployment.
