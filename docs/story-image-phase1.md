# Story Image Pipeline - Phase 1

## Scope Implemented

Phase 1 introduces a dedicated `story_image` generation path that targets `imageSpecs` payloads and sends `promptParts` directly to SiliconFlow/Flux.

Implemented capabilities:

- Added a new strategy: `StoryImageStrategy`.
- Added task routing support for `story_image`.
- Added schema support for `story_image` tasks.
- Added manifest orchestration detection for `story_image` visualizations.
- Enforced palette-lock behavior when `paletteLockToCourseStyleGuide: true`.

## Files Changed

- `src/image-gen/strategies/story-image.strategy.ts` (new)
- `src/image-gen/image-task.schema.ts`
- `src/image-gen/image-strategy.factory.ts`
- `src/image-gen/image-gen.module.ts`
- `src/image-gen/image-orchestrator.service.ts`

## Behavior Details

### 1. Semantic Routing

In manifest orchestration:

- If `viz.type === "story_image"` OR `viz.imageSpecs` exists, task type is set to `story_image`.
- Otherwise tasks continue through `infographic` path.

### 2. Prompting

`StoryImageStrategy` reads:

- `payload.imageSpecs.rendering.generation.promptParts.positive`
- `payload.imageSpecs.rendering.generation.promptParts.negative`

and builds the final Flux prompt directly from those parts.

### 3. Palette Lock

When `imageSpecs.constraints.paletteLockToCourseStyleGuide === true`:

- Course palette hex values are extracted from `course.globalStyleGuide.colorPalette`.
- The prompt is prefixed with the palette lock instruction + hex list.

### 4. Resilience and Throughput Guardrails

- Strategy queue limit: `p-limit(2)` for high-fidelity requests.
- Exponential backoff for transient provider errors:
  - retries on `429` / `503` with `1s -> 2s -> 4s`.

### 5. Output

- Output is saved into the standard generated-images hierarchy:
  - `public/generated-images/<date>/<course>/<lesson>/<task>/poster.png`
- Returns standard URL payload compatible with existing observability flow.

## Validation

- `npm run build` passes after changes.

