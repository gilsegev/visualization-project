# Story Image Pipeline - Phase 5

## Scope

Phase 5 validates throttling and resilience behavior under load for `story_image`.

## Verification Implemented

- Script: `scripts/verify-story-phase5.ts`

The script performs:

1. **Concurrency stress test**
   - Launches 5 simultaneous `story_image` tasks.
   - Asserts max concurrent SiliconFlow generation calls is exactly `2` (via `p-limit(2)`).

2. **Backoff simulation**
   - Forces `429` on first three attempts, success on fourth.
   - Asserts backoff sequence is `1000ms -> 2000ms -> 4000ms`.
   - Asserts elapsed runtime aligns with expected cumulative backoff delay.

## Expected Result Shape

```json
{
  "concurrency_stress_test": {
    "max_in_flight_siliconflow_calls": 2,
    "pass": true
  },
  "backoff_simulation": {
    "attempts": 4,
    "observed_backoff_ms": [1000, 2000, 4000],
    "pass": true
  }
}
```

