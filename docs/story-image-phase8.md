# Story Image Pipeline - Phase 8 E2E Validation

## Date
- 2026-02-18

## Scope
Validate narrative engine behavior after Phase 7 integration:
- Throttling/backoff behavior
- Observability metric visibility
- Hero asset rendering/pathing
- Lesson 1 quality threshold audit

## Executions

### 1) Pipeline Throttling Audit
Command:
- `npx ts-node scripts/verify-story-phase5.ts`

Result:
- `max_in_flight_siliconflow_calls = 2`
- backoff sequence observed: `1000, 2000, 4000 ms`
- PASS

### 2) Hero Path/Template Integrity
Command:
- `npx ts-node scripts/verify-story-phase6.ts`

Result:
- Story outputs written under `.../hero/<taskId>/...`
- Template used: `bento`
- Single full image cell composition confirmed
- Capture dimensions preserved (1400x900)
- PASS

### 3) Full Manifest Run
Input note:
- `public/assets/test2.json` is currently malformed/truncated (unterminated string in lesson 3 item 3.2).
- E2E run was executed with `public/assets/test2_phase8_recovered.json` to unblock validation.

Run result:
- 10 visuals generated across lessons 1-4
- Hero outputs created under:
  - `public/generated-images/2026-02-18/mindfulness-stress-management/lesson-1/hero/...`

### 4) Lesson 1 Quality Summary
- 1.1: `88`
- 1.2: `85`
- 1.3: `90` (story strategy assigned)
- 1.4: `90` (story strategy assigned)
- Minimum score: `85` (> 75 threshold)

## Observations
- Narrative metrics appear in dashboard and are computable from task payload metrics:
  - `narrative_hero_gen_ms`
  - `siliconflow_backoff_events`
  - `estimated_cost_usd`
- Hero posters are directly accessible from `/generated-images/.../hero/.../poster.png`.
