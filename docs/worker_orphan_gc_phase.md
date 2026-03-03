# Orphan Worker GC (5.C)

## Scope Implemented
- Added orphan worker process garbage collection in API supervisor.
- Added startup sweep and periodic sweep for local host worker PIDs.
- Added process-tree termination for orphan/signature-invalid workers.
- Added DB recovery path to terminate worker heartbeat and requeue stuck task.

## Design
- Supervisor (`WorkerHealthSupervisorService`) now performs:
  - `startup` GC sweep on module init.
  - `periodic` GC sweep every `WORKER_GC_INTERVAL_MS`.
- Sweep targets only `worker_heartbeats.status='ACTIVE'` rows for current host.
- For each worker row:
  - If PID missing/not alive: mark worker `TERMINATED`, recover task.
  - If PID alive but signature check fails: kill process tree (`tree-kill`), mark `TERMINATED`, recover task.
- Signature checks:
  - Heartbeat row `signature` must match `WORKER_SIGNATURE`.
  - PID command line must include `dist/src/worker/main`.

## Storage Additions
- `PostgresStorageService.terminateWorkerAndRecoverTask(workerId, reason)`:
  - Marks heartbeat row `TERMINATED`, clears `current_task_id`.
  - Requeues associated `processing` task with `Queued (Worker GC)` stage.
  - Appends GC reason to `tasks.error_log`.

## Config Added
- `WORKER_GC_ENABLED=true`
- `WORKER_GC_INTERVAL_MS=30000`
- `WORKER_SIGNATURE=viz-worker`

## Validation
1. Build succeeds (`npm run build`).
2. Startup sweep runs without crashing API.
3. Periodic sweep runs and logs cleanups.
4. On orphan worker row, DB status moves to `TERMINATED` and linked task is requeued.

