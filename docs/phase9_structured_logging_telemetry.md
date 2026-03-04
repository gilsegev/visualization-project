# Phase 9: Structured Logging and Telemetry

## Scope
Implemented **only** section `9) Structured Logging and Telemetry (Medium)` from `docs/production_readiness_plan.md`.

## Changes

### 1) Structured JSON Logging
- File: `src/observability/observability.gateway.ts`
- Added normalized log envelope with standard fields:
  - `task_id`
  - `user_id`
  - `latency_ms`
  - `provider_status`
  - plus `event_id`, `batch_id`, `source_role`, `source_pid`, `source_worker_id`, `timestamp`, `level`, `context`, `message`
- Each emitted system log now writes a structured JSON line to stdout.
- Metadata normalization added so `user_id`, `latency_ms`, and `provider_status` are consistently typed.

### 2) Worker Telemetry Metadata
- File: `src/worker/durable-queue.worker.service.ts`
- Added structured metadata to worker log events:
  - claim event: `user_id`, `strategy`, `provider_status=claimed`
  - completion event: `user_id`, `strategy`, `latency_ms`, `provider_status=success`
  - requeue/failure event: `user_id`, `strategy`, `provider_status=requeued|failed`

### 3) Database-Backed Telemetry
- File: `src/storage/postgres-storage.service.ts`
- Added strategy telemetry aggregation (`last 24h`) in `getDatabaseHealthStats()`:
  - `total`, `completed`, `failed`, `success_rate_pct`, `avg_latency_ms` by strategy.
- Added `querySystemLogs({ taskId?, userId?, limit? })` to make logs queryable by `task_id` and `metadata.user_id`.
- Added index for user-id metadata lookup:
  - `idx_system_logs_metadata_user_id` on `(metadata->>'user_id')`.

### 4) Dashboard Visibility
- File: `public/dashboard/index.html`
- Added a compact `STRATEGY TELEMETRY (24H)` panel in the `DATABASE HEALTH` section showing:
  - strategy
  - success %
  - avg latency (ms)
  - error %

## Validation Performed
- `npm run build` ✅
- `npm run lint` ❌ not runnable in this environment (`eslint` not installed/resolvable in current shell).

## Notes
- This phase does not change queue logic, service topology, or retention behavior.
- Telemetry is exposed through existing `live_stats` payload under:
  - `database.telemetry.strategies_24h`.
