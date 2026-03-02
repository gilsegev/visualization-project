# Worker Heartbeat and Health (5.B)

## Scope Implemented
- Added worker heartbeat lifecycle to durable workers.
- Added API-side supervisor loop to recover timed-out workers/tasks.
- Added `start:all` command to start app + clip + configurable worker count.

## Design
- Worker register/update:
  - On worker startup: upsert `worker_heartbeats` row with `ACTIVE` status.
  - Every `WORKER_HEARTBEAT_MS`: update `last_seen_at` and `current_task_id`.
  - On task claim/release: bind/unbind `current_task_id`.
  - On graceful shutdown: mark worker `SHUTDOWN`.
- API supervisor:
  - Poll every `WORKER_SUPERVISOR_POLL_MS`.
  - Detect stale `ACTIVE` workers using `WORKER_TIMEOUT_MS`.
  - Mark stale workers `TERMINATED`.
  - Requeue associated `processing` tasks and append worker-timeout log to `tasks.error_log`.

## Config Added
- `WORKER_COUNT`
- `WORKER_TASK_CONCURRENCY`
- `WORKER_HEARTBEAT_MS`
- `WORKER_TIMEOUT_MS`
- `WORKER_SUPERVISOR_ENABLED`
- `WORKER_SUPERVISOR_POLL_MS`

## Validation Performed
1. Build compiles after deduplicating heartbeat storage methods/types.
2. Worker startup writes heartbeat row and keeps `last_seen_at` fresh.
3. Task claim updates `current_task_id`; completion clears it.
4. Worker SIGTERM/SIGINT triggers `SHUTDOWN` status update.
5. Supervisor loop is active in API process and calls stale-worker recovery path.

