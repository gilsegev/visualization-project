# Narrative Remediation Package (Prompt 16 Fixes)

## Date
- 2026-02-18

## Implemented Fixes

### 1) Strict Schema Enforcement (Fail-Fast)
Files:
- `src/image-gen/strategies/story-image.strategy.ts`
- `src/image-gen/image-orchestrator.service.ts`

Changes:
- Story strategy now validates pre-flight requirements before any provider call.
- If `type=story_image` and `imageSpecs` or `imageSpecs.brief` is missing, generation is refused.
- Refusal error includes:
  - `message: "Missing mandatory imageSpecs for narrative type."`
  - `correction_log: ["Missing mandatory imageSpecs for narrative type."]`
- Orchestrator now propagates `correction_log` in failed task details and logs.

### 2) Queue Wait-Time Metric
Files:
- `src/image-gen/image-orchestrator.service.ts`
- `src/observability/observability.gateway.ts`
- `public/dashboard/index.html`

Changes:
- Added `metadata.queued_at` when tasks are created.
- Captures `started_at` when task clears p-limit and starts execution.
- Computes wait time as `started_at - queued_at`.
- Emits:
  - `metrics.wait_ms`
  - `metrics.narrative_wait_ms` (story tasks)
- Dashboard now displays `NarrativeWaitTime` card (average seconds).

### 3) Deterministic Story Canvas + 2x Export
Files:
- `public/assets/infographics/templates/html templates/story_frame.html`
- `src/image-gen/strategies/story-image.strategy.ts`
- `src/image-gen/browser.service.ts`

Changes:
- Story frame locked to fixed `1400x900` canvas.
- Inner story image uses `object-fit: cover`.
- Story strategy now stamps `story_frame` template directly for hero renders.
- Browser capture supports export scaling via `options.scale`.
- Story strategy reads `rendering.export.scale` and requests scaled output.
  - `scale: 2` yields `2800x1800` poster output.

### 4) Prompt Weighting and Style Lock
File:
- `src/image-gen/strategies/story-image.strategy.ts`

Changes:
- Prompt now begins with style directive:
  - `Style: [course style guide]. Subject: [brief/prompt...]`
- Reinforced negative list to suppress photorealistic drift:
  - `photorealistic`, `cinematic`, `3d render`, `realistic photo`
- Existing no-text constraints remain enforced.

## Notes
- The changes preserve existing story throttling/backoff behavior.
- Failure-path observability now carries correction logs for dashboard diagnosis.
