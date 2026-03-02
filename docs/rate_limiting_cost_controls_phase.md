# Phase Implementation: Rate Limiting and Cost Controls (Section 6)

## Scope Implemented
Implemented only **Section 6: Rate Limiting and Cost Controls (High)** from `docs/production_readiness_plan.md`.

## What Was Added
1. API throttling (per API key):
- `src/main.ts`
  - Added global in-memory fixed-window middleware keyed by `x-api-key`/Bearer token.
  - Config: `API_RATE_LIMIT_PER_MINUTE` (default: `120`).
  - Exceeding requests return `429 Too Many Requests`.

2. Worker-side budget gate before generation:
- `src/worker/durable-queue.worker.service.ts`
  - Before strategy execution, worker now fetches user daily budget usage.
  - If projected spend exceeds user `daily_quota`, task is failed immediately (no retry loop).
  - Emits observability progress/log with `Quota Exceeded` stage.

3. Cost telemetry persistence in PostgreSQL task metadata:
- `src/storage/postgres-storage.service.ts`
  - Added `recordTaskCost(...)` to persist `metadata.cost` (`estimated_usd`, `actual_usd`, provider/model metadata).
  - Worker now records cost on success and failure paths.

4. User daily quota storage + usage query:
- `src/storage/postgres-storage.service.ts`
  - Added `users.daily_quota` schema field (default `25`).
  - Added migration-safe `ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_quota`.
  - Added `getUserDailyBudget(...)` for worker budget checks.
  - Added `failDurableTaskImmediately(...)` for non-retriable quota failures.

5. Config surface updates:
- `.env.example`
  - Added section 6 environment knobs:
    - `API_RATE_LIMIT_PER_MINUTE`
    - `TASK_COST_STORY_IMAGE_USD`
    - `TASK_COST_SOURCED_IMAGE_USD`
    - `TASK_COST_DATA_VIZ_USD`
    - `TASK_COST_INFOGRAPHIC_USD`

## Validation Performed
1. Build validation:
- `npm run build`

2. Functional behavior checks (manual test plan):
- Rate limit test:
  - Send repeated authenticated requests above `API_RATE_LIMIT_PER_MINUTE` within one minute.
  - Expected: `429` response from rate-limit middleware.
- Quota exceed test:
  - Set a low `users.daily_quota` for a test user and trigger durable-queue tasks.
  - Expected: worker marks task `failed` with `Quota Exceeded`, no extra retry cycle.
- Cost telemetry test:
  - Run a task and verify `tasks.metadata.cost` contains estimated/actual values.

## Notes
- This phase intentionally does not implement other production-readiness sections.
- Rate limiting is process-local in-memory (works immediately; not yet distributed across multiple API instances).
