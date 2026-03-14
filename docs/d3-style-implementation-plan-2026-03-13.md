# D3 Style Implementation Plan

## Goal

Turn the styling study into an implementation path for this codebase:

- add a normalized `DocumentChartStyleDecision`
- add `chart_role` support in planning
- add a first D3 pilot family without disturbing the current production chart path

This plan assumes the current ECharts-based `data_viz` path remains the default renderer.

## Scope

In scope:

- planning and manifest schema changes
- document-level style decision model
- chart-role-aware style resolution
- token model for charts
- one D3 pilot family

Out of scope for the first implementation:

- replacing all chart rendering with D3
- redesigning infographic themes
- changing DOCX insertion behavior beyond what chart metadata needs

## Current insertion points

The implementation should build on the current structure, not bypass it.

### Planning

- [visual-manifest.types.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest.types.ts)
- [visual-manifest.schema.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest.schema.ts)
- [visual-manifest-planner.service.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest-planner.service.ts)

### Style selection

- [style-registry.config.ts](/d:/visualization%20%20project/src/image-gen/style-registry.config.ts)
- [themes.config.ts](/d:/visualization%20%20project/src/image-gen/themes.config.ts)

### Task construction

- [image-orchestrator.service.ts](/d:/visualization%20%20project/src/image-gen/image-orchestrator.service.ts)

### Chart rendering

- [data-viz.strategy.ts](/d:/visualization%20%20project/src/image-gen/strategies/data-viz.strategy.ts)
- [image-strategy.factory.ts](/d:/visualization%20%20project/src/image-gen/image-strategy.factory.ts)

## Target architecture

### 1. Document-level style decision

Add a normalized style-decision object produced once per manifest/document.

Recommended type:

```ts
export type ChartRole =
  | 'comparison'
  | 'trend'
  | 'composition'
  | 'spotlight'
  | 'distribution';

export type DocumentTone =
  | 'executive'
  | 'educational'
  | 'technical'
  | 'narrative';

export type DocumentChartStyleDecision = {
  profile_id: string;
  tone: DocumentTone;
  density: 'low' | 'medium' | 'high';
  energy: 'restrained' | 'balanced' | 'vivid';
  surface: 'light' | 'dark';
  trust_mode: 'conservative' | 'modern' | 'expressive';
  chart_family:
    | 'executive_clean'
    | 'field_guide'
    | 'technical_slate'
    | 'editorial_spotlight';
  chart_theme_id: string;
  tokens: ChartStyleTokens;
};
```

### 2. Per-chart role

Each `data_viz` should carry a `chart_role`.

Recommended manifest addition:

```ts
chart_role?: 'comparison' | 'trend' | 'composition' | 'spotlight' | 'distribution';
```

### 3. Renderer-independent chart tokens

Refactor chart theme presets into a token model.

Recommended type:

```ts
export type ChartStyleTokens = {
  surface: {
    background: string;
    border: string;
    radius: number;
  };
  type: {
    title_family: string;
    body_family: string;
    title_size: number;
    axis_size: number;
    annotation_size: number;
  };
  color: {
    text_primary: string;
    text_secondary: string;
    grid: string;
    emphasis: string;
    palette: string[];
  };
  axis: {
    show_domain: boolean;
    tick_size: number;
    label_rotation: number;
    grid_opacity: number;
  };
  mark: {
    bar_radius: number;
    line_width: number;
    point_size: number;
    value_labels: boolean;
    multicolor_by_datum: boolean;
  };
  annotation: {
    enabled: boolean;
    benchmark_line: boolean;
    direct_labels: boolean;
  };
};
```

ECharts should consume these tokens first. The D3 pilot should consume the same tokens.

## Implementation phases

## Phase 1: Add style decision model (implemented)

### Goal

Introduce the document-level style decision object without changing rendering yet.

### Files

- [style-registry.config.ts](/d:/visualization%20%20project/src/image-gen/style-registry.config.ts)
- new file: `src/image-gen/chart-style.types.ts`
- new file: `src/image-gen/chart-style-decision.service.ts` or equivalent utility module

### Changes

1. Create `ChartStyleTokens`, `ChartRole`, and `DocumentChartStyleDecision` types.
2. Replace implicit profile-only returns with a richer decision object.
3. Preserve current profile logic initially, but wrap it inside a richer decision result.
4. Derive initial traits from:
   - `manifest.course.title`
   - `targetAudience`
   - `designPhilosophy`
   - `globalStyleGuide`
   - lesson titles

### First-pass heuristic mapping

- `field_manual_system` -> `educational`, `balanced`, `light`, `field_guide`
- `slate_signal_system` -> `technical`, `restrained`, `light`, `technical_slate`
- `paper_ledger_system` -> `narrative`, `restrained`, `light`, `executive_clean`
- `midnight_contrast_system` -> `technical` or `narrative`, `vivid`, `dark`

### Success criteria

- orchestrator logs one document-level style decision object
- current chart theme id still resolves exactly as before

## Phase 2: Add `chart_role` to planning (implemented)

### Goal

Make the planner describe not only what chart to render, but what stylistic role the chart plays.

### Files

- [visual-manifest.types.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest.types.ts)
- [visual-manifest.schema.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest.schema.ts)
- [visual-manifest-planner.service.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest-planner.service.ts)

### Changes

1. Add `chart_role` to `PlannedVisualization`.
2. Validate it in the schema.
3. In deterministic planning:
   - map quarter/time-series content -> `trend`
   - category counts/currency snapshots -> `comparison`
   - shares/percentages -> `composition`
4. In LLM planning:
   - extend the prompt to require `chart_role` for `data_viz`
   - include allowed values
5. Add a deterministic fallback so missing `chart_role` is inferred server-side.

### Example rule

- labels like `Q1/Q2/Q3/Q4`, years, months -> `trend`
- category labels with one value each -> `comparison`
- percent/share/mix -> `composition`

### Success criteria

- every `data_viz` in the manifest has a valid `chart_role`
- existing jobs still validate and generate

## Phase 3: Introduce chart token resolution (implemented)

### Goal

Replace `chartThemePresets` as the internal styling contract with a tokenized model.

### Files

- [data-viz.strategy.ts](/d:/visualization%20%20project/src/image-gen/strategies/data-viz.strategy.ts)
- [style-registry.config.ts](/d:/visualization%20%20project/src/image-gen/style-registry.config.ts)
- new file: `src/image-gen/chart-style-tokens.ts`

### Changes

1. Move hard-coded chart presets into structured tokens.
2. Add a resolver:

```ts
resolveChartStyleTokens(
  styleDecision: DocumentChartStyleDecision,
  chartRole: ChartRole,
  viz: any
): ChartStyleTokens
```

3. Have `DataVizStrategy.buildCourseChartTheme` become a compatibility layer over `ChartStyleTokens`.
4. Add role modifiers:
   - `comparison`:
     - stronger bars
     - moderate grid
     - optional value labels
   - `trend`:
     - stronger line
     - lighter grid
     - direct end-label preference
   - `composition`:
     - tighter palette
     - no pseudo-3D
     - explicit segment labeling
   - `spotlight`:
     - one emphasis color
     - muted non-focus palette

### Success criteria

- current ECharts charts render from tokens instead of raw presets
- chart styling changes correctly when `chart_role` changes

## Phase 4: Propagate style decision through orchestrator metadata (implemented)

### Goal

Make the chart renderer receive the full style decision, not just theme ids.

### Files

- [image-orchestrator.service.ts](/d:/visualization%20%20project/src/image-gen/image-orchestrator.service.ts)

### Changes

1. Compute one `DocumentChartStyleDecision` per manifest.
2. Store it in task metadata:
   - `document_chart_style_decision`
   - `chart_role`
   - `chart_style_tokens`
3. Keep existing `chart_theme_id` for backward compatibility.

### Success criteria

- logs show both `chart_theme_id` and full style decision metadata
- chart strategy can render without consulting manifest-global style logic again

## Phase 5: First D3 pilot family (implemented)

### Goal

Add one D3-based chart family to validate the styling model.

### Recommendation

Pilot family: `editorial_spotlight_bar`

Reason:

- it is the easiest chart family to make visibly better than default engine output
- it benefits from custom direct labels and emphasis
- it is suitable for document export as static SVG/PNG

### Files

- new file: `src/image-gen/strategies/d3-custom-chart.strategy.ts`
- possibly new shared helper: `src/image-gen/strategies/d3/d3-chart-runtime.ts`
- [image-strategy.factory.ts](/d:/visualization%20%20project/src/image-gen/image-strategy.factory.ts) only if routed as a distinct subtype
- [data-viz.strategy.ts](/d:/visualization%20%20project/src/image-gen/strategies/data-viz.strategy.ts) if embedded as a family within existing `data_viz`

### Recommended integration

Do not add a new top-level manifest type.

Instead:

- keep `type = data_viz`
- add `renderer_hint?: 'echarts' | 'd3'`
- add `chart_family?: 'default' | 'editorial_spotlight_bar'`

Then in `DataVizStrategy`:

- if `renderer_hint === 'd3'` or `chart_family === 'editorial_spotlight_bar'`
  - render via D3 path
- else
  - render via current ECharts path

### D3 pilot visual behavior

- horizontal or vertical comparison bar chart
- direct value labels on bars
- one emphasis bar
- muted secondary bars
- no detached legend
- clean title block
- optional annotation note

### Rendering target

- generate SVG in-page with D3
- screenshot the SVG through the existing browser service first
- if stable, later move to direct SVG persistence

### Success criteria

- one known manifest task can route to D3 and render successfully
- resulting chart is visually stronger than current default comparison bars
- output still flows through the current asset/document insertion pipeline

## Phase 6: Planner support for D3 pilot routing (implemented)

### Goal

Let the planner recommend the D3 pilot only for cases where it has clear value.

### Files

- [visual-manifest-planner.service.ts](/d:/visualization%20%20project/src/documents/planning/visual-manifest-planner.service.ts)

### Changes

Add optional fields for `data_viz`:

```ts
chart_role?: ChartRole;
chart_family?: 'default' | 'editorial_spotlight_bar';
renderer_hint?: 'echarts' | 'd3';
```

Deterministic selection rule for first pass:

- if `chart_role === 'comparison'`
- and there are 3-7 categories
- and one clear focal category exists
- then allow `chart_family = editorial_spotlight_bar`

Otherwise default to ECharts.

### Success criteria

- D3 routing is deliberate and limited
- the planner does not send every chart into the D3 path

## Phase 7: Export-safe styling rules

### Goal

Make styling rules consistent across engines for static DOCX-bound assets.

### Files

- shared token module
- [data-viz.strategy.ts](/d:/visualization%20%20project/src/image-gen/strategies/data-viz.strategy.ts)
- future D3 strategy file

### Rules

- minimum axis font size
- minimum annotation font size
- minimum stroke width
- axis label truncation or wrapping thresholds
- direct-label preference for small-category charts
- no dark-theme chart unless document profile explicitly requests dark surface
- zero-baseline rules for bar charts

### Success criteria

- judge complaints about readability and fidelity decrease
- chart styling becomes more stable under export

## Suggested order of implementation

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 7
6. Phase 5
7. Phase 6

Reason:

- first make style structured
- then make it flow through the pipeline
- then add D3 as a narrow renderer target

## Risks

### 1. Overfitting style classification

If the document classifier is too rule-heavy, profile selection will become brittle.

Mitigation:

- keep profile logic deterministic and simple at first
- log decisions visibly

### 2. D3 pilot scope creep

If the pilot tries to solve every chart family, it will stall.

Mitigation:

- keep the first D3 family to one comparison-bar variant

### 3. Divergent styling logic between ECharts and D3

If each renderer invents its own style model, the architecture regresses.

Mitigation:

- make both consume the same `ChartStyleTokens`

## Deliverables

### Deliverable A

Structured style decision layer:

- `DocumentChartStyleDecision`
- `ChartStyleTokens`
- `ChartRole`

### Deliverable B

Manifest/planner support:

- `chart_role`
- optional `chart_family`
- optional `renderer_hint`

### Deliverable C

Renderer integration:

- tokenized ECharts styling
- first D3 pilot family

## Recommended immediate next coding task

If implementation starts now, the first concrete patch should be:

1. add `chart_role` to manifest types/schema
2. add `ChartStyleTokens` and `DocumentChartStyleDecision` types
3. refactor `resolveStyleSelection` to return a richer chart-style decision object

That is the smallest useful vertical slice and sets up everything else cleanly.
