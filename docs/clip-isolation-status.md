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
