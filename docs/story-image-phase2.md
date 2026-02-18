# Story Image Pipeline - Phase 2

## Scope Implemented

Phase 2 focuses on high-resolution support and heavy-task resilience for `story_image`.

Implemented outcomes:

- Supports requested narrative resolutions (e.g. `1400x900`).
- Keeps dedicated high-fidelity concurrency cap at `2`.
- Applies exponential backoff on transient provider load errors (`429`, `503`).
- Adds observability logs around queueing and retry behavior.

## Files Changed

- `src/image-gen/strategies/story-image.strategy.ts`
- `scripts/verify-story-phase2.ts` (new verification harness)

## Technical Details

### 1. Resolution Handling

`StoryImageStrategy` now resolves dimensions from multiple inputs:

- `task.metadata.dimensions.width/height`
- `task.payload.dimensions.width/height`
- pair strings such as `1400x900` / `1400×900`
- fallback default: `1400x900`

All dimensions are normalized to valid positive integers with a lower bound clamp.

### 2. High-Fidelity Queue

Narrative generation remains behind a dedicated `p-limit(2)` semaphore to prevent provider saturation during large-image workloads.

### 3. Backoff Policy

For generation API calls:

- retries on `429` / `503`
- delay schedule: `1s -> 2s -> 4s`
- max attempts: `4` total

### 4. Observability

Added structured logs for:

- queued request metadata (`model`, `size`)
- each scheduled retry with attempt number, status, and backoff delay

## Verification Plan and Results

Verification script: `scripts/verify-story-phase2.ts`

Checks performed:

1. **Resolution pass-through**
   - Confirms API request uses `1400x900` when requested.
2. **Backoff behavior**
   - Simulates `429`, `429`, then success and verifies retries + elapsed delay.
3. **Semaphore cap**
   - Fires 3 concurrent tasks and verifies max in-flight generation requests is `2`.
4. **Observability**
   - Confirms retry logs were emitted.

Observed result:

```json
{
  "resolution": { "requested": "1400x900", "pass": true },
  "backoff": { "attempts": 3, "elapsed_ms": 3019, "pass": true },
  "queue": { "max_in_flight": 2, "pass": true },
  "observability": { "retry_logs": 2, "pass": true }
}
```

