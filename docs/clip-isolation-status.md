# CLIP Isolation Update

Date: 2026-02-19

## What Changed

- CLIP scoring was moved out of the main Nest process into a dedicated HTTP scorer process.
- Added scorer service entrypoint: `tools/clip-scorer/server.js`.
- Main app now calls scorer via `CLIP_SCORER_URL` from `LocalClipService`.
- Added optional local fallback switch: `CLIP_SCORER_USE_LOCAL_FALLBACK`.

## Why

- Prevent CLIP runtime/native crashes from taking down the main app process.
- Prepare deployment model where CLIP runs in a separate Docker container.

## Runtime Contract

- `GET /health`
- `POST /score` with `{ imageUrl, brief }`
- Response includes numeric `score` in `[0,1]`.

## Validation Performed

- Started `clip-scorer` and main app in separate processes.
- Ran one-image sourced test from `public/assets/sourced_image.json`.
- Verified output generated under sourced path.
- Verified blueprint had `provider=unsplash` and non-null `clip_score`.
- Verified app log used `via external scorer` path.

## Deployment

- See `docs/deployment.md` for separate-container deployment instructions (`app` + `clip-scorer`).

## Follow-Up Fixes (2026-02-19)

- Strengthened CLIP scoring in `tools/clip-scorer/server.js`:
  - Added strict scoring mode (`CLIP_STRICT_MODE`, default `true`).
  - Added hard-negative label set plus domain-specific negatives.
  - Returned expanded diagnostics: `positive_score`, `strongest_negative_score`, `strongest_negative_label`, `strict_mode`.
- Improved sourced fallback behavior in `src/image-gen/strategies/sourced-image.strategy.ts`:
  - If external CLIP scorer is unavailable for all candidates, keep sourced flow and use top retrieved Unsplash candidate.
  - Preserve CLIP diagnostics on story fallback (`clip_score`, `clip_threshold`, `sourced_fallback_reason`) for observability.
- Improved observability clarity in `public/dashboard/index.html`:
  - Added CLIP score badges on task cards.
  - Added sourced scoring block in modal.
  - Added selected-asset metrics card in `BY ASSET` tab with CLIP/threshold/fallback reason.
  - Clicking an asset card now syncs `BY ASSET` selection.
- Fixed Windows folder-open reliability in `src/observability/observability.gateway.ts`:
  - Replaced shell `start` command with `explorer.exe` argument-safe invocation.
  - Added path normalization, existence checks, and base-dir guard.
