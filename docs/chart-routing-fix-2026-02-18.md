# Chart Routing and Stability Fix (2026-02-18)

## Summary
This update restores and hardens manifest-based chart generation end to end.

## Changes

### 1) Manifest task routing to DataViz
File: `src/image-gen/image-orchestrator.service.ts`

- Added `resolveManifestTaskType(...)` to classify chart-like manifest visuals as `data_viz`.
- Added `buildManifestPayloadForTask(...)` to normalize chart payload shape from manifest input:
  - `chartType`
  - `data`
  - `format`

Supported chart-like manifest types now include:
- `data_viz`, `chart`, `bar`, `line`, `pie`, `funnel`
- `bar_chart`, `line_chart`, `pie_chart`, `funnel_chart`

### 2) Orchestrator completion guard
File: `src/image-gen/image-orchestrator.service.ts`

- Prevents completion-stage crashes when a strategy omits payload fields:
  - `metrics: result?.payload?.metrics || {}`
  - Optional access for `output_dir`, `image_prompts`, `blueprint_prompt`

### 3) DataViz return payload parity
File: `src/image-gen/strategies/data-viz.strategy.ts`

- DataViz now returns a payload consistent with observability expectations:
  - `metrics.generation_ms`, `metrics.total_ms`
  - `output_dir`
  - `image_prompts`
  - `blueprint_prompt`
  - `chart_type`, `format`

### 4) Fishing course manifest chart coverage
File: `public/assets/fishing_course.json`

- Added 4 chart visualizations:
  - `1.8` bar chart
  - `1.9` line chart
  - `1.10` pie chart
  - `1.11` funnel chart
- Normalized a few malformed non-ASCII characters that caused strict JSON parse errors in API ingestion.

## Verification
- Build completed successfully.
- `fishing_course.json` manifest run produced chart artifacts:
  - `public/generated-images/task-8-data_viz.png`
  - `public/generated-images/task-9-data_viz.png`
  - `public/generated-images/task-10-data_viz.png`
  - `public/generated-images/task-11-data_viz.png`
- The previous runtime error `Cannot read properties of undefined (reading 'metrics')` no longer appears after the fix run.
