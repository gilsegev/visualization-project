# Railway Services Runbook (Deterministic)

This file is the source of truth for Railway service topology, start commands, environment variables, deploy order, and rollback.

Current target state (Stage 2 split):
- `visualization-project` = API/web only
- `app-worker` = queue worker only
- `image-quality-control` = IQC/CLIP scoring service
- `postgres` = Railway Postgres

## 1. Service Topology

### Service: `visualization-project` (API/Web)
- Purpose: serves UI, API endpoints, websocket, orchestration.
- Start command:
```bash
npm run start:runtime
```
- Required behavior:
  - `WORKER_COUNT=0` (no local workers in API service)
  - Handles `/dashboard/index.html`, `/generate/*`, `/courses/generate`

### Service: `app-worker` (Worker)
- Purpose: claims tasks from durable queue and executes generation.
- Start command:
```bash
npm run start:worker:runtime
```
- Required behavior:
  - `PROCESS_ROLE=worker`
  - `DURABLE_QUEUE_ENABLED=true`
  - For free tier: `WORKER_COUNT=1`

### Service: `image-quality-control` (IQC)
- Purpose: CLIP + optional vision scoring endpoint used by API/worker.
- Start command:
```bash
npm run start:image-quality-control
```
- Required behavior:
  - Binds on internal host/port (`IQC_HOST=0.0.0.0`, `IQC_PORT=4310`)

## 2. Environment Variable Matrix

Set these in Railway exactly as listed.

### `visualization-project` (API/Web)

Core runtime:
- `POSTGRES_ENABLED=true`
- `DATABASE_URL=<from postgres service>`
- `INITIAL_ADMIN_KEY=<secret>`
- `ALLOWED_ORIGINS=https://<your-primary-domain>,https://<railway-domain>`
- `PROCESS_ROLE=app`
- `DURABLE_QUEUE_ENABLED=true`
- `WORKER_COUNT=0`

Queue/worker safety:
- `WORKER_GC_ENABLED=true`
- `WORKER_GC_POLL_MS=30000`
- `WORKER_STALE_TIMEOUT_MS=120000`

IQC wiring:
- `IQC_URL=http://image-quality-control:4310`
- `CLIP_SCORER_URL=http://image-quality-control:4310`
- `QUALITY_CONTROL_TIMEOUT_MS=12000`

Providers/models:
- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_MODEL=<model>`
- `SILICONFLOW_API_KEY=<secret>`
- `UNSPLASH_ACCESS_KEY=<optional>`
- `PIXABAY_API_KEY=<optional>`

Rendering/tooling:
- `D2_BIN=d2`
- `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`
- `D2_VERSION=0.7.1`

Quota/cost controls (if used in your environment):
- `QUOTA_SOURCED_IMAGE=<number>`
- `QUOTA_GENERATED_IMAGE=<number>`
- `QUOTA_CHART=<number>`
- `QUOTA_INFOGRAPHIC=<number>`

### `app-worker`

Core runtime:
- `POSTGRES_ENABLED=true`
- `DATABASE_URL=<same postgres>`
- `INITIAL_ADMIN_KEY=<same secret>`
- `PROCESS_ROLE=worker`
- `DURABLE_QUEUE_ENABLED=true`
- `WORKER_COUNT=1`

Queue/worker safety:
- `WORKER_GC_ENABLED=true`
- `WORKER_GC_POLL_MS=30000`
- `WORKER_STALE_TIMEOUT_MS=120000`

IQC wiring:
- `IQC_URL=http://image-quality-control:4310`
- `CLIP_SCORER_URL=http://image-quality-control:4310`
- `QUALITY_CONTROL_TIMEOUT_MS=12000`

Providers/models (same as API unless intentionally different):
- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_MODEL=<model>`
- `SILICONFLOW_API_KEY=<secret>`
- `UNSPLASH_ACCESS_KEY=<optional>`
- `PIXABAY_API_KEY=<optional>`

Rendering/tooling:
- `D2_BIN=d2`
- `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`
- `D2_VERSION=0.7.1`

### `image-quality-control`

Service binding:
- `IQC_HOST=0.0.0.0`
- `IQC_PORT=4310`

Model/provider:
- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_MODEL=<text-or-general-model>`
- `OPENROUTER_VISION_MODEL=<vision-model>`

## 3. Deploy Order (Every Change)

1. Deploy `image-quality-control`
2. Wait for IQC health to pass
3. Deploy `app-worker`
4. Wait for worker startup to stabilize
5. Deploy `visualization-project`
6. Run one 4-asset manifest smoke test from UI

Reason: API/worker should never deploy ahead of IQC when IQC scoring is enabled.

## 4. Health/Smoke Checks

### UI checks
- Open `https://<visualization-domain>/dashboard/index.html`
- Confirm websocket connects (no origin block)
- Run 4-asset manifest
- Confirm all 4 tasks complete

### Log checks (expected)

`visualization-project`:
- `[runtime] started app + 0 worker(s)`
- `Nest application successfully started`
- `POST /generate/manifest`

`app-worker`:
- `Durable queue worker started`
- task claim/start/complete lines
- no repeated kill/restart loop

`image-quality-control` and callers:
- `CLIP score=... via IQC service`
- no sustained IQC 500 errors

## 5. Deployment ID / Rollback Reference

In Railway UI:
1. Open service
2. Open `Deployments` tab
3. Open a deployment entry
4. Copy the deployment slug/id shown near the service name
   - Example format looks like `ceff29c0`

Track this for each service after every successful cut:
- `visualization-project: <id>`
- `app-worker: <id>`
- `image-quality-control: <id>`

## 6. Rollback Procedure

If production behavior regresses:
1. Redeploy prior known-good deployment for `visualization-project`
2. Redeploy prior known-good deployment for `app-worker`
3. Redeploy prior known-good deployment for `image-quality-control`
4. Re-run 4-asset smoke test

If free-tier memory pressure appears:
- Keep `app-worker` at `WORKER_COUNT=1`
- Keep API at `WORKER_COUNT=0`
- Avoid adding worker replicas until stable

## 7. Known-Good Baseline (2026-03-04)

- Stage 2 split validated with:
  - API service showing `app + 0 worker(s)`
  - worker service handling queue work
  - IQC scoring active from remote service
- Stable git tag:
  - `railway-stage1-stable-20260304`
