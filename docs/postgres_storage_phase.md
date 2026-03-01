# Phase Implementation: Unified Data Storage Layer (PostgreSQL)

## Scope Implemented
Implemented only the **"unified data storage layer: PostgreSQL (critical)"** phase.

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

6. Dependency:
- `pg` added to `package.json` and `package-lock.json`

## Design Notes
- Storage is **feature-flagged** with `POSTGRES_ENABLED`.
- If disabled or unavailable, app behavior remains unchanged (no hard runtime dependency).
- Schema bootstrap runs automatically on app startup when Postgres is enabled.
- Writes are best-effort and non-blocking to avoid slowing generation flow.

## Tables Created
- `batch_runs`
- `task_runs`
- `system_logs`

## Runtime Behavior
- `emitBatchInitialized(...)` upserts initial batch row.
- `emitProgress(...)` upserts task status/stage and metadata.
- `emitLog(...)` inserts structured log rows.
- `emitBatchFinalized(...)` upserts final batch summary.

## Environment Variables
```env
POSTGRES_ENABLED=false
DATABASE_URL=
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=
PGDATABASE=visualization
```

## Validation Performed
1. Static build validation:
- `npm run build` succeeds.

2. Integration sanity validation:
- Gateway compiles with injected storage provider.
- Postgres storage calls are wired on all core observability events.

3. Backward-compat validation:
- With `POSTGRES_ENABLED=false`, app path remains compatible.

## Suggested Manual Validation (when DB is available)
1. Set:
- `POSTGRES_ENABLED=true`
- `DATABASE_URL=postgres://...` (or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)

2. Run app and execute one manifest batch.

3. Verify rows:
- `SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT 5;`
- `SELECT * FROM task_runs ORDER BY updated_at DESC LIMIT 20;`
- `SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 50;`

