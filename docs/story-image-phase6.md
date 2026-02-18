# Story Image Pipeline - Phase 6

## Scope

Phase 6 verifies visual integrity and persistence pathing for narrative assets.

## Implemented Changes

- `src/image-gen/strategies/story-image.strategy.ts`
  - Story outputs now use a dedicated narrative directory:
    - `.../<date>/<course>/<lesson>/hero/<task>/...`
  - Narrative composition now stamps through the Bento engine using:
    - `story_mode: true`
    - exactly one cell:
      - `col_span: 12`
      - `row_span: 12`
      - `content.type: "image_only"`
      - `content.image_url: "./assets/story_image.png"`

- `public/assets/infographics/templates/html templates/bento.html`
  - Added `story_mode` rendering treatment for narrative assets:
    - wellness-frame overlay
    - full-frame image handling with preserved aspect intent
    - compatible with existing non-story bento behavior

- `scripts/verify-story-phase6.ts`
  - Adds automated Phase 6 audit checks.

## Verification Plan

1. Build check (`npm run build`)
2. Regression check for Phase 5 (`scripts/verify-story-phase5.ts`)
3. Phase 6 audit (`scripts/verify-story-phase6.ts`)

## Verification Outcome

Phase 6 checks passed:

- Hero directory path integrity: **pass**
- Bento template composition for story image: **pass**
- Single 12x12 `image_only` cell injection: **pass**
- Story mode enabled: **pass**
- Capture dimensions preserved (e.g. 1400x900): **pass**
- Assets persisted under hero path: **pass**

