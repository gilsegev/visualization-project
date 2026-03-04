# Railway Migration Runbook

## 1. Branch and Merge Plan

### A. Prepare Release Branch

```bash
git fetch origin
git checkout containerization
git pull
git checkout -b release/containerization-railway
```

### B. Freeze and Validate Locally on Release Branch

```bash
npm ci
npm run build
docker compose up -d --build
```

Validate:

- `http://localhost:8081/dashboard/index.html` loads
- WebSocket connects (no origin error)
- 4-asset manifest completes
- IQC health returns OK (`/health`)

### C. Merge to `main` (After Local/Staging Pass)

```bash
git checkout main
git pull
git merge --no-ff release/containerization-railway -m "merge: containerization railway migration"
git push origin main
git tag containerization-railway-cutover-YYYYMMDD
git push origin containerization-railway-cutover-YYYYMMDD
```

## 2. Railway Deployment Topology

### Stage 1 (Recommended Now)

- `app-runtime` service (single service)
  - Start command: `npm run start:runtime`
- `image-quality-control` service
  - Start command: `npm run start:image-quality-control`
- Existing PostgreSQL service

This gets you branch migration + IQC separation with minimal break risk.

### Stage 2 (Later)

- `visualization-project` (API/web): `npm run start:runtime`, `WORKER_COUNT=0`
- `app-worker`: `npm run start:worker:runtime`, `DURABLE_QUEUE_ENABLED=true`, `PROCESS_ROLE=worker`
- `image-quality-control`
- PostgreSQL

External object storage is recommended as the next hardening step.

## 3. Railway Setup Steps (UI)

- In Railway project, set deploy branch to `main` (or your active release branch if running a staged cutover).
- Keep current app service; update start command to:

```bash
npm run start:runtime
```

- Add new service from same repo:
  - Name: `image-quality-control`
  - Start command: `npm run start:image-quality-control`
- Set IQC service as internal only (no public route needed unless you want direct health checks).
- Set env vars (below) in each service.
- Deploy IQC first, then app service.
- Confirm API logs show `app + 0 worker(s)` and worker-service logs show queue claims/completions.

## 4. Required Environment Variables

### Common (App + Worker/Runtime Service)

- `POSTGRES_ENABLED=true`
- `DATABASE_URL=postgresql://...`
- `INITIAL_ADMIN_KEY=...`
- `ALLOWED_ORIGINS=https://<your-app-domain>,https://<railway-generated-domain>`
- `IQC_URL=http://image-quality-control:4310`
- `CLIP_SCORER_URL=http://image-quality-control:4310` (compat alias)
- `D2_BIN=d2`
- `QUALITY_CONTROL_TIMEOUT_MS=12000`
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=google/gemini-2.0-flash-001` (or your selected model)
- `SILICONFLOW_API_KEY=...`
- `UNSPLASH_ACCESS_KEY=...` (if using Unsplash)
- `PIXABAY_API_KEY=...` (if using Pixabay)
- `QUOTA_SOURCED_IMAGE=...`
- `QUOTA_GENERATED_IMAGE=...`
- `QUOTA_CHART=...`
- `QUOTA_INFOGRAPHIC=...`

### App-Runtime Specific (Stage 1)

- `PROCESS_ROLE=app`
- `WORKER_COUNT=3` (or desired)
- `DURABLE_QUEUE_ENABLED=true`

### IQC Service

- `IQC_HOST=0.0.0.0`
- `IQC_PORT=4310`
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=...`
- `OPENROUTER_VISION_MODEL=...` (if set separately)

### If/When Split (Stage 2)

- `visualization-project` (API): `PROCESS_ROLE=app`, `DURABLE_QUEUE_ENABLED=true`, `WORKER_COUNT=0`
- `app-worker`: `PROCESS_ROLE=worker`, `DURABLE_QUEUE_ENABLED=true`, `WORKER_COUNT=1` on free tier (or replicas model)

Important: use either:

- 1 worker container with `WORKER_COUNT=N`, or
- N worker replicas with `WORKER_COUNT=1`

Do not multiply both accidentally.

## 5. Build/Deploy Validation Checklist

After deploy:

- Open dashboard and confirm:
  - WebSocket connected
  - no `Origin not allowed`
- Submit `dark_mode_style_test.json`
- Confirm in logs:
  - IQC scoring events appear
  - no `No sourced-image providers configured` unless keys are intentionally empty
- Confirm API logs show no local workers (`app + 0 worker(s)`) and worker logs show active claims.
- Confirm D2 renders with no `D2 executable not found`.
- Confirm generated assets are viewable from UI.

## 6. Rollback Plan (Fast)

If issues occur:

- Redeploy previous stable image/tag on app service.
- Reset start command to prior known good (`npm run start:runtime` old release or old command).
- Keep DB untouched.
- Disable/stop IQC service if needed.
- Revert branch target back to previous stable branch/tag.

## 7. Notes Specific to Your Current Repo

Your scripts support this directly:

- `start:runtime`
- `start:worker:runtime`
- `start:image-quality-control`

Additional notes:

- Dockerfile already includes Playwright deps and D2.
- The `ALLOWED_ORIGINS` WebSocket gate is strict; include exact Railway domain(s) to avoid the auth disconnect you saw before.
- Runtime startup now includes strict env validation in Railway/production contexts; missing required vars fail fast at process start.
- If needed, this can be converted into a checked runbook file in `docs/` plus a Railway variable matrix template for service-by-service paste.
