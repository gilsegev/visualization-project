# Sourced Image S2 Status (Current)

Date: 2026-02-19
Branch: `new-endpoint-development`

## Implemented

- Added new task type routing for `sourced_image` in orchestrator.
- Added `SourcedImageStrategy` and registered it in module + strategy factory.
- Added local CLIP service (`LocalClipService`) and kept it feature-flaggable.
- Added Unsplash retrieval path via API search.
- Added strict fail-fast protections:
  - per-task orchestrator timeout (`MANIFEST_TASK_TIMEOUT_MS`, default `120000`)
  - sourced strategy timeout (`SOURCED_IMAGE_TIMEOUT_MS`, default `90000`)
  - bounded Unsplash/CLIP/vision step timeouts
- Added explicit config error when Unsplash key is missing (no silent ambiguity).

## Current Runtime Mode

- Manifest with explicit `imageSpecs.source.assetUrl` removed in `public/assets/sourced_image.json`.
- Unsplash is now the active source path for these sourced-image test items.
- CLIP and vision gate can be disabled by env for stability while integrating sourcing:
  - `SOURCED_IMAGE_DISABLE_CLIP=true`
  - `SOURCED_IMAGE_DISABLE_VISION=true`

## Required Env

- `UNSPLASH_ACCESS_KEY` (primary)
- Also supported aliases in code:
  - `UNSPLASH_KEY`
  - `UPLASH_ACCESS_KEY`
  - `UPLASH_KEY`

## Verified Result

Using `public/assets/sourced_image.json`:

- Batch starts and completes.
- 3 sourced outputs created under:
  - `public/generated-images/<date>/build-your-first-pc-core-parts-and-safe-assembly/lesson-1/sourced/viz-*/poster.png`
- Blueprint/provider metadata shows `provider=unsplash` and `source_type=sourced_image`.

## Known Next Step

- Re-enable CLIP + vision gate after Unsplash sourcing baseline is stable in repeated runs.
