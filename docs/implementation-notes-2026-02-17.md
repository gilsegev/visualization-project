# Implementation Notes - 2026-02-17

This note captures the changes completed for observability UX and hub template layering.

## Observability UI

- Fixed inconsistent `View in Folder` button visibility in the modal.
- Added frontend fallback that derives `output_dir` from asset URLs when backend payloads do not include it.
- Normalized task payloads from both `task_progress` and `batch_initialized` events so modal actions are consistent.

Files:
- `public/dashboard/index.html`

## Generation Payload Consistency

- Standardized template strategy outputs so each template path returns:
  - `output_dir`
  - `blueprint_prompt`
  - `image_prompts`
  - normalized timing metrics

File:
- `src/image-gen/strategies/template-stamping.strategy.ts`

## Hub Template Layering + Background

- Added explicit canvas background layer at the lowest z-index.
- Added support for optional `background_url` injection on that layer.
- Implemented deterministic spoke stacking order with counter-clockwise precedence.

File:
- `public/assets/infographics/templates/html templates/Hub.html`

## Runtime Note

- Production launch currently requires `node dist/src/main.js`.
- `npm run start:prod` points to `dist/main` and should be corrected in `package.json`.

## Follow-up Fixes (Render + E2E Validation)

- Fixed a JavaScript syntax issue in `Hub.html` that could stop rendering after compact-mode adjustments.
- Improved compact hub collision handling for high spoke counts (10-12) using stronger radial + angular separation.
- Hardened hub density E2E validation so a run cannot pass when rendering fails:
  - fail on browser `pageerror`
  - fail when rendered card count does not match requested spoke count
  - fail when center title remains default placeholder text
  - isolate each case in a fresh Playwright page to avoid script redeclaration artifacts

Files:
- `public/assets/infographics/templates/html templates/Hub.html`
- `scripts/e2e-hub-density.js`
