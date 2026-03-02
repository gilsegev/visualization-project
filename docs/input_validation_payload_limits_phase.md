## Phase 4: Input Validation and Payload Limits (Critical)

### Scope Implemented
- Only section `4) Input Validation and Payload Limits (Critical)` from `docs/production_readiness_plan.md`.

### Design
- Added global Nest validation and unknown-field rejection.
  - `ValidationPipe` with:
    - `transform: true`
    - `whitelist: true`
    - `forbidNonWhitelisted: true`
    - `forbidUnknownValues: true`
- Added request body size limits at Express layer.
  - JSON + URL-encoded payload limit from env: `MAX_REQUEST_BODY_MB` (default `2`).
- Added DTO schemas for generation endpoints.
  - `POST /generate`: validated `content` string length.
  - `POST /generate/manifest`: validated top-level manifest shape + common visualization fields.
  - `POST /generate/source-debug`: validated query, per-page, orientation.
  - `POST /courses/generate`: validated course metadata and visualization prompt structure.
- Added explicit payload/count guards for manifest and course jobs.
  - Limits from env:
    - `MAX_LESSONS_PER_REQUEST` (default `20`)
    - `MAX_VISUALIZATIONS_PER_LESSON` (default `20`)
    - `MAX_TEXT_FIELD_LENGTH` (default `4000`)
  - Returns clear `400` messages when count/text limits are exceeded.

### Files Changed
- `src/main.ts`
- `src/image-gen/dto/image-gen-request.dto.ts`
- `src/common/validation/payload-limits.ts`
- `src/image-gen/image-gen.controller.ts`
- `src/courses/course.dto.ts`
- `src/courses/course.controller.ts`
- `.env.example`

### Validation Results
- Valid manifest accepted:
  - `POST /generate/manifest` returns `200` with `{ "message": "Batch started" }`.
- Unknown field rejected:
  - Extra top-level property returns `400` with `property ... should not exist`.
- Count limit rejected:
  - >20 lessons returns `400` with `lessons exceed max 20`.
- Text length rejected:
  - `/generate` content >4000 chars returns `400`.
- Body size rejected:
  - ~3MB request body returns `413 Payload Too Large` with `request entity too large`.

### Env Knobs Added
- `MAX_REQUEST_BODY_MB=2`
- `MAX_LESSONS_PER_REQUEST=20`
- `MAX_VISUALIZATIONS_PER_LESSON=20`
- `MAX_TEXT_FIELD_LENGTH=4000`

