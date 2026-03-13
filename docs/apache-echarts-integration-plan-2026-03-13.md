# Apache ECharts Integration Plan

Date: 2026-03-13
Branch: `apache`

## Objective

Quickly replace the current `data_viz` rendering path with Apache ECharts in a way that:

- preserves the current app layout
- preserves the current worker + manifest + DOCX pipeline
- enables fast viability testing using the real application flow
- keeps rollback simple

## Scope

Only the `data_viz` rendering path is in scope for the first pass.

Not in scope:

- changing manifest planning
- changing `ImageStrategyFactory` routing
- changing DOCX insertion logic
- changing non-chart strategies
- replacing D2 or infographic template stamping

## Section 1: Branch And Rollout Document

Status: implemented

Tasks:

- create branch `apache`
- create this plan document in `docs`
- use this file as the step tracker

## Section 2: Dependency And Runtime Loader

Status: implemented

Tasks:

- add Apache ECharts dependency
- add runtime loader support in `DataVizStrategy`
- resolve ECharts library from either:
  - `public/assets/echarts.min.js`
  - `node_modules/echarts/dist/echarts.min.js`
- keep current browser-capture strategy intact for first-pass verification

Success criteria:

- app builds
- strategy loads ECharts runtime without changing surrounding pipeline code

## Section 3: Replace VChart Rendering With ECharts Rendering

Status: implemented

Tasks:

- remove VChart-specific HTML/spec generation from `DataVizStrategy`
- generate ECharts options for:
  - bar
  - line
  - pie
  - funnel
- use existing theme mapping from task metadata
- use SVG renderer for first-pass robustness
- preserve existing output payload shape

Success criteria:

- static charts render through the current `data_viz` path
- no downstream contract changes required

## Section 4: Verification In Current App Flow

Status: implemented

Tasks:

- run build
- render the currently supported manifest chart set
- verify generated chart artifacts are produced through existing worker/app flow
- compare visual quality and runtime stability against current behavior

Success criteria:

- build passes
- chart artifacts are generated successfully
- chart output quality is at least directionally better than current VChart output

Verification performed:

- `npm run build` passed after the ECharts swap
- direct strategy smoke test passed for:
  - `bar`
  - `line`
  - `pie`
  - `funnel`
- Nest application-context verification passed using the real app module and orchestrator with:
  - `POSTGRES_ENABLED=false`
  - `DURABLE_QUEUE_ENABLED=false`
  - `CHART_ENGINE=echarts`
- manifest batch completed successfully with 4/4 chart tasks rendered through:
  - manifest normalization
  - `ImageOrchestratorService`
  - `ImageStrategyFactory`
  - `DataVizStrategy`
  - `BrowserService`
  - `LocalStorageService`

Observed outputs:

- `/generated-images/task-viz-1773377383517-shflcbcm0-data_viz.png`
- `/generated-images/task-viz-1773377383518-iu7ueik2m-data_viz.png`
- `/generated-images/task-viz-1773377383518-jm3pomph4-data_viz.png`
- `/generated-images/task-viz-1773377383518-cndfwf2f1-data_viz.png`

## Section 5: Rollback And Hardening Notes

Status: implemented

Tasks:

- document rollback path
- document remaining limitations
- identify next hardening steps if ECharts is viable

Likely follow-ups:

- optional direct SVG export path
- animated chart path review
- richer label formatting and chart-specific presets
- chart-type-specific layout tuning for long labels and dense legends
- visual regression snapshots for the 4 supported chart families

## Rollback Plan

If the first-pass swap is not viable:

- revert `DataVizStrategy`
- keep manifest/task routing unchanged
- leave the rest of the app untouched

## Current Limitations

- first-pass integration still uses Playwright capture rather than direct SVG artifact persistence
- animated chart path is still using the existing video-capture model and has not been deeply tuned for ECharts yet
- bar/line/pie/funnel are the only chart families explicitly tuned in this pass
- label overflow, legend density, and editorial polish need a second pass before calling the engine migration fully production-ready

## Notes

This integration is intentionally designed as a direct swap inside the existing `data_viz` strategy so that viability is measured using the real application layout rather than a demo harness.
