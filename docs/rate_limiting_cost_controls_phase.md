# 6) Rate Limiting and Cost Controls (High)

## Issue
- Unbounded per-user requests across asset classes can spike spend and exhaust upstream providers.

## High-Level Plan
- Enforce per-user, per-asset daily quotas in PostgreSQL using atomic count-up semantics (UTC day boundary).
- Keep cost telemetry in `tasks.metadata.cost` and stamp estimated cost at task start.

## Design Specification (Implemented)
- Added `daily_usage` table (PostgreSQL):
  - `user_id`, `asset_type`, `usage_date`, `current_count`, timestamps.
  - Unique key on `(user_id, asset_type, usage_date)`.
  - Asset types constrained to:
    - `SOURCED_IMAGE`
    - `GENERATED_IMAGE`
    - `CHART`
    - `INFOGRAPHIC`
- Added atomic quota reservation:
  - `reserveDailyAssetQuota(userId, assetType, limit)` in `PostgresStorageService`.
  - Uses single-statement upsert with `WHERE current_count < limit` to avoid race overrun.
  - UTC reset is implicit via `(NOW() AT TIME ZONE 'UTC')::date`.
- Worker-side count-up guard:
  - In `DurableQueueWorkerService`, each claimed task maps to one asset quota bucket.
  - If quota is exceeded, task is failed immediately with a 429-style message and no retry.
- Cost telemetry:
  - Estimated cost is written to `tasks.metadata.cost` when task processing begins.
  - Final actual cost continues to be updated on completion/failure paths.

## Environment Knobs
- `QUOTA_SOURCED_IMAGE`
- `QUOTA_GENERATED_IMAGE`
- `QUOTA_CHART`
- `QUOTA_INFOGRAPHIC`

## Validation Performed
- Build validation: `npm run build` succeeds.
- Runtime/DB validation:
  - `daily_usage` table exists with unique user/asset/day key.
  - Quota rows increment during task intake.
  - Existing workflows continue, with no schema regressions.

## Validation Procedure (Operator)
1. Set one quota low, e.g. `QUOTA_GENERATED_IMAGE=1`.
2. Submit 2 generated-image tasks for same user in same UTC day.
3. Confirm:
   - first task proceeds,
   - second task fails with stage `Rate Limit Exceeded`,
   - task details include `http_status: 429`, `asset_type`, `quota_limit`, `quota_count`, `usage_date_utc`.
4. Submit a `sourced_image` task and verify it still succeeds (asset isolation).
