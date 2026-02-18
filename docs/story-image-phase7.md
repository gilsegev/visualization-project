# Story Image Pipeline - Phase 7

## Scope

Phase 7 integrates narrative performance visibility into the observability dashboard.

## Implemented

### 1. Strategy Metrics & Cost Tracking

File: `src/image-gen/strategies/story-image.strategy.ts`

Added narrative-specific metrics to task payload:

- `narrative_hero_gen_ms`
- `siliconflow_backoff_events`
- `siliconflow_attempts`
- `estimated_cost_usd`
- `total_ms`

Also emits observability log lines for narrative generation metrics and supports configurable cost baseline:

- env key: `SILICONFLOW_STORY_BASE_COST_USD` (default: `0.02`)

### 2. Dashboard Metric Mapping

File: `public/dashboard/index.html`

Added dedicated dashboard cards:

- `Narrative Hero` (count)
- `NarrativeHeroGenTime` (avg seconds)
- `SiliconFlowBackoffEvents`
- `Narrative Cost (est USD)`

### 3. Task Typing for UI Grouping

File: `src/image-gen/image-orchestrator.service.ts`

Added `metadata.task_type` so the dashboard can reliably identify `story_image` tasks.

## Verification Notes

- Build passes.
- Existing Phase 5/6 verification scripts remain compatible.

