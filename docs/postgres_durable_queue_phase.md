# Phase Implementation: PostgreSQL-Based Durable Queue (Critical)

## Scope Implemented
Implemented only **Section 2: PostgreSQL-Based Durable Queue** from `docs/production_readiness_plan.md`.

## What Was Added
1. Durable queue primitives in PostgreSQL storage service:
- `src/storage/postgres-storage.service.ts`
  - `enqueueDurableTasks(...)`
  - `claimNextQueuedTask(...)` using `FOR UPDATE SKIP LOCKED`
  - `heartbeatTask(...)`
  - `completeDurableTask(...)`
  - `failOrRequeueDurableTask(...)`
  - `requeueOrphanedProcessingTasks(...)`
  - `updateBatchRunProgress(...)`

2. Queue schema extensions:
- `tasks` table now includes queue-specific fields:
  - `queue_status`, `attempts`, `max_attempts`
  - `lease_owner`, `lease_expires_at`, `last_heartbeat_at`
  - `available_at`, `payload`, `result_url`, `error_log`, `created_at`
- Added queue pull/recovery indexes.
- Added `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration safety for existing installs.

3. API enqueue behavior:
- `src/image-gen/image-orchestrator.service.ts`
  - Manifest path now enqueues tasks into PostgreSQL when `DURABLE_QUEUE_ENABLED=true` and `POSTGRES_ENABLED=true`.
  - Returns immediate batch queued response path instead of in-process execution for durable mode.

4. Dedicated worker process:
- `src/worker/durable-queue.worker.service.ts`
- `src/worker/worker.module.ts`
- `src/worker/main.ts`
- `package.json` script: `start:worker`

5. Config surface:
- `.env.example` durable queue section:
  - `DURABLE_QUEUE_ENABLED`
  - `DURABLE_QUEUE_POLL_MS`
  - `DURABLE_QUEUE_LEASE_SECONDS`
  - `DURABLE_QUEUE_HEARTBEAT_MS`
  - `DURABLE_QUEUE_STALE_MINUTES`
  - `DURABLE_QUEUE_JANITOR_EVERY_MS`
  - `DURABLE_QUEUE_RETRY_DELAY_SECONDS`
  - `DURABLE_QUEUE_MAX_ATTEMPTS`

## Design Notes
- Queue claim is atomic and race-safe via `FOR UPDATE SKIP LOCKED`.
- Worker and API are now process-separable:
  - API: enqueue + control + observability WS.
  - Worker: pull + execute + retries + janitor recovery.
- Worker heartbeats active processing tasks; janitor recovers stale leases to `queued`.
- Retry behavior is persisted in DB (`attempts`, `max_attempts`, `error_log`).

## Validation Performed
1. Compile validation:
- `npm run build` passes.

2. Durable queue integration smoke test:
- Started API with durable queue enabled.
- Started separate worker process (`npm run start:worker`).
- Submitted one manifest task.
- Verified DB state transitions:
  - `tasks.queue_status` advanced to `completed`.
  - `batch_runs` reflected completion counters.

3. SQL warning fix:
- Corrected task progress upsert parameter typing issue in `task_runs` upsert path.

## How To Run (Durable Mode)
1. Start API:
```bash
npm run start:app
```
2. Start worker in separate terminal:
```bash
npm run start:worker
```
3. Submit manifest to `/generate/manifest` with `x-api-key`.

## Expected Behavior
- API restart does not drop queued tasks.
- Worker restart resumes from persisted queue state.
- Multiple worker instances can run concurrently without duplicate task claims.
