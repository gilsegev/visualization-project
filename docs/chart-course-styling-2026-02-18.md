# Course Styling on DataViz Charts (2026-02-18)

## Goal
Apply course theme styling to chart outputs so `data_viz` visuals match manifest-driven brand/theme settings.

## Implemented

### 1) Theme propagation to chart payload
File: `src/image-gen/image-orchestrator.service.ts`
- Added `title` into normalized chart payload for manifest chart tasks.
- This allows DataViz charts to use clean chart titles (instead of raw refined prompts).

### 2) DataViz style engine now uses course theme
File: `src/image-gen/strategies/data-viz.strategy.ts`
- Added `buildCourseChartTheme(task)` that reads:
  - `metadata.custom_theme` (preferred)
  - `metadata.course_palette_hexes` (fallback)
- Applied course theme to:
  - chart/canvas background
  - title and axis/legend text colors
  - grid line color
  - series palette colors
  - bar hover color / line point stroke
  - font family (uses manifest font when available)
- Removed hardcoded neon dark look from chart defaults.

### 3) Utility added
- `hexToRgba(...)` helper for grid color generation from theme text color.

## Verification
- Rebuilt and ran a chart-only manifest derived from `public/assets/fishing_course.json`.
- New outputs (`task-1`..`task-4`) show course-aligned styling (light background + fishing palette):
  - `public/generated-images/task-1-data_viz.png`
  - `public/generated-images/task-2-data_viz.png`
  - `public/generated-images/task-3-data_viz.png`
  - `public/generated-images/task-4-data_viz.png`
