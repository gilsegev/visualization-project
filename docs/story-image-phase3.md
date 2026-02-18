# Story Image Pipeline - Phase 3

## Scope Implemented

Phase 3 introduces a deterministic host template for narrative assets so story images flow through the same HTML + Playwright screenshot pipeline used by infographic templates.

## What Was Added

- New template: `public/assets/infographics/templates/html templates/story_frame.html`
  - Full-screen `<img>` host
  - Wellness-book border treatment
  - Data injection via `/* INSERT_JSON_HERE */ null`

- Template resolver support:
  - `src/image-gen/services/template-stamping.service.ts`
  - `templateId === "story_frame"` now resolves to `story_frame.html`

- Story strategy stamping path:
  - `src/image-gen/strategies/story-image.strategy.ts`
  - After SiliconFlow generation:
    1. Save raw image to `assets/story_image.png`
    2. Stamp `story_frame` HTML with local asset URL
    3. Capture via Playwright `screenshotHtml(...)`
    4. Save `poster.png`, `index.html`, and `blueprint.json`

## Architectural Alignment

This completes Layer V from `arch.md`:

- Deterministic stamping into a host frame
- Unified delivery path (`generated-images/...`)
- Same rendering/capture pipeline as infographics

## Verification Plan Executed

Verification script:

- `scripts/verify-story-phase3.ts`

Checks:

1. Stamping uses template id `story_frame`
2. Screenshot request receives target dimensions (e.g., `1400x900`)
3. Pipeline saves:
   - `assets/story_image.png`
   - `index.html`
   - `poster.png`
   - `blueprint.json`
4. Returned URL points to poster output

## Result

All checks passed in the script run with mocked provider/browser/storage dependencies.

