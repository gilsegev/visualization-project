# Performance Improvement: Manifest Throughput

## Goal
Reduce end-to-end manifest generation time by removing pipeline-level serialization and constraining only the expensive external image API stage.

## Root Cause
- Manifest processing used a single task-level limiter (`p-limit(3)`) for the entire lifecycle:
  - intake
  - triage
  - blueprinting
  - image generation
  - stamping
  - browser render
- This kept many assets in `Intake` while only a few full tasks ran.
- A fixed artificial delay (`500ms`) was applied per task during triage.

## Implemented Changes

### 1) Task-level concurrency is now configurable and higher by default
File: `src/image-gen/image-orchestrator.service.ts`

- Added `MANIFEST_TASK_CONCURRENCY` (default: `8`).
- Replaced hardcoded `p-limit(3)` with `p-limit(this.manifestTaskConcurrency)`.
- Removed artificial triage delay (`await new Promise(...500ms)`).
- Added immediate transition from `Intake` to `Queued for Generation` for observability clarity.

### 2) Image API is globally throttled in strategy layer
File: `src/image-gen/strategies/template-stamping.strategy.ts`

- Added a singleton image API limiter in `TemplateStampingStrategy`:
  - `IMAGE_API_CONCURRENCY` (default: `6`)
- Wrapped SiliconFlow generation + fetch in this limiter in `generateImage()`.
- Result: tasks can progress in parallel, but external image calls remain safely bounded.

## Why this architecture is faster
- Non-image work (triage, blueprint generation, stamping, screenshot, storage) can now run concurrently across more tasks.
- Backpressure is applied only where needed (SiliconFlow image calls), instead of pausing entire tasks.
- Observability now reflects queued state correctly instead of appearing stuck in intake.

## Config knobs
- `MANIFEST_TASK_CONCURRENCY`
  - Controls number of task pipelines running simultaneously.
  - Recommended start: `8`
- `IMAGE_API_CONCURRENCY`
  - Controls global concurrent image calls to SiliconFlow.
  - Recommended start: `6`

## Validation performed
- `npm run build` completed successfully after changes.

## Rollout notes
- If provider rate limits appear, lower `IMAGE_API_CONCURRENCY` first.
- If CPU or browser rendering becomes the bottleneck, lower `MANIFEST_TASK_CONCURRENCY`.
