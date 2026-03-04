# Phase Implementation: Unified Data Storage Layer (PostgreSQL)

## Scope Implemented
Implemented only the **"unified data storage layer: PostgreSQL (critical)"** phase, including manual admin provisioning and API-key auth bridge.

## What Was Added
1. PostgreSQL storage service:
- `src/storage/postgres-storage.service.ts`

2. Storage module:
- `src/storage/storage.module.ts`

3. Observability integration:
- `src/observability/observability.module.ts` (imports storage module)
- `src/observability/observability.gateway.ts` (persists task progress, logs, batch init/finalize)

4. Batch metadata extension:
- `src/image-gen/image-orchestrator.service.ts` (passes `courseTitle` into finalized batch event)

5. Config surface:
- `.env.example` (Postgres toggles and connection env vars)
7. Auth layer:
- `src/auth/auth.module.ts`
- `src/auth/api-key.guard.ts`
- `src/auth/admin.guard.ts`
- `src/image-gen/image-gen.controller.ts` (guarded; `POST /generate/stop` is admin-only)
- `src/courses/course.controller.ts` (guarded)

8. Dashboard handshake:
- `public/dashboard/index.html` (prompts for API key, stores in localStorage, sends `x-api-key` on API calls, authenticates socket with `auth.apiKey`)

6. Dependency:
- `pg` added to `package.json` and `package-lock.json`

## Design Notes
- Storage is **feature-flagged** with `POSTGRES_ENABLED`.
- If disabled or unavailable, app behavior remains unchanged (no hard runtime dependency).
- Schema bootstrap runs automatically on app startup when Postgres is enabled.
- Writes are best-effort and non-blocking to avoid slowing generation flow.

## Tables Created
- `users`
- `batch_runs`
- `task_runs`
- `tasks`
- `system_logs`

## Runtime Behavior
- On startup (when `POSTGRES_ENABLED=true`), schema is auto-created and initial admin is seeded from env.
- `emitBatchInitialized(...)` upserts initial batch row.
- `emitProgress(...)` upserts task status/stage and metadata.
- `emitLog(...)` inserts structured log rows.
- `emitBatchFinalized(...)` upserts final batch summary.
- HTTP routes behind guards require a valid `x-api-key`.
- WebSocket connection requires API key via socket auth/header/query.

## Environment Variables
```env
POSTGRES_ENABLED=false
DATABASE_URL=
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=
PGDATABASE=visualization
INITIAL_ADMIN_KEY=
INITIAL_ADMIN_EMAIL=admin@local
INITIAL_ADMIN_NAME=Initial Admin
```

## Validation Performed
1. Static build validation:
- `npm run build` succeeds.

2. Integration sanity validation:
- Gateway compiles with injected storage provider.
- Postgres storage calls are wired on all core observability events.
- API key guard compiles and is applied to generation/course endpoints.
- Admin guard is applied to `POST /generate/stop`.
- Dashboard composes authenticated HTTP + WebSocket requests.

3. Backward-compat validation:
- With `POSTGRES_ENABLED=false`, app path remains compatible.

## Suggested Manual Validation (when DB is available)
1. Set:
- `POSTGRES_ENABLED=true`
- `DATABASE_URL=postgres://...` (or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)

2. Run app and execute one manifest batch.

3. Verify rows:
- `SELECT id, email, role, active FROM users ORDER BY id DESC LIMIT 5;`
- `SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT 5;`
- `SELECT * FROM task_runs ORDER BY updated_at DESC LIMIT 20;`
- `SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 50;`

4. Verify auth:
- Open `/dashboard` and enter `INITIAL_ADMIN_KEY` when prompted.
- Call API with and without `x-api-key` and confirm 200 vs 401.
- Call `POST /generate/stop` using non-admin user key (if present) and confirm 403.
