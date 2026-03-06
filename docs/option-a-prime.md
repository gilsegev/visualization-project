# Option A-prime Master Plan

## Phase Status

1. Phase 0: Scope Lock and Contracts (`implemented`)
2. Phase 1: Storage Layer (R2 / S3-compatible) (`implemented`)
3. Phase 2: DB and Queue Extensions (`implemented`)
4. Phase 3: Intake API (Zero-Proxy Ingestion) (`implemented`)
5. Phase 4: Analysis and Anchor Detection (Layer 1 Deterministic Skeleton) (`implemented baseline; needs deeper deterministic parser upgrades`)
6. Phase 5: Visual Manifest Planning (Layer 2/3 currently scoped) (`implemented baseline; needs intent-router/context-window upgrades`)
7. Phase 6: Document Processing Observability and Logging (`in progress; Steps 1-6 implemented`)
8. Phase 7: Worker Orchestration and Resource Control (`implemented`)

## Scope and Progress Notes

- This document is the canonical, ordered implementation log and master execution reference for Option A-prime.
- Phase numbering is strictly sequential and authoritative.
- Future work should continue from this order; do not append out-of-order phase sections.

## Phase 0: Scope Lock and Contracts

This section tracks implementation status for **Phase 0** (Scope Lock and Contracts).

### Implemented

1. Contract types added:
   - `src/documents/contracts/document-job.contract.ts`
   - `DocumentJob`, `DocumentAssetTask`, `DocumentOutput`
   - Includes `docVersionHash` (`DOC_VERSION_HASH` contract field)
2. Manifest version baseline added:
   - `src/documents/contracts/document-manifest.contract.ts`
   - `DOCUMENT_MANIFEST_VERSION = 1`
3. `DOC_VERSION_HASH` generator added:
   - `src/documents/contracts/doc-version-hash.ts`
   - Deterministic SHA-256 from source object metadata
4. State machine guard added:
   - `src/documents/state/document-job-state.machine.ts`
   - Allowed transitions:
     - `queued -> analyzing -> planning -> generating_assets -> inserting -> packaging -> completed`
     - Any active state may transition to `failed`
5. Export barrel added:
   - `src/documents/index.ts`

### Validation

Validation script:

- `tools/validate-document-phase0.ts`

What it verifies:

1. Manifest version is pinned to `1`
2. Valid and invalid state transitions behave as expected
3. Invalid transitions throw errors
4. `DOC_VERSION_HASH` is deterministic
5. `DOC_VERSION_HASH` changes when source metadata changes

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase0.ts
```

Expected output:

```text
[phase0-validation] PASS
```


## Phase 1: Storage Layer (R2 / S3-compatible)

This section records implementation of **Phase 1 only**.

### Implemented

1. Object storage contracts:
   - `src/storage/object-storage/object-storage.interface.ts`
   - Signed URL API for upload/download.
2. Deterministic document key layout helper:
   - `src/storage/object-storage/object-key-layout.ts`
   - Supports:
     - `documents/{jobId}/input/source.docx`
     - `documents/{jobId}/analysis/*.json`
     - `documents/{jobId}/assets/*.png`
     - `documents/{jobId}/output/final.docx`
3. R2/S3-compatible presigned URL utility:
   - `src/storage/object-storage/s3-presign.util.ts`
   - Supports `PUT` and `GET` SigV4 query signing.
4. Injectable R2 adapter service:
   - `src/storage/object-storage/r2-object-storage.service.ts`
   - Reads env config and generates signed URLs.
5. Storage module wiring:
   - `src/storage/storage.module.ts`
   - Exports `R2ObjectStorageService`.
6. Runtime env validation extension:
   - `tools/runtime-env-validate.js`
   - When `DOC_PIPELINE_ENABLED=true`, app/worker now require:
     - `OBJECT_STORE_PROVIDER` (`r2|s3`)
     - `S3_ENDPOINT`
     - `S3_REGION`
     - `S3_BUCKET`
     - `S3_ACCESS_KEY_ID`
     - `S3_SECRET_ACCESS_KEY`
7. `.env` placeholders added for R2/S3 keys:
   - `DOC_PIPELINE_ENABLED`
   - `OBJECT_STORE_PROVIDER`
   - `S3_ENDPOINT`
   - `S3_REGION`
   - `S3_BUCKET`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
   - `S3_FORCE_PATH_STYLE`

### Validation

Validation script:

- `tools/validate-document-phase1-storage.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase1-storage.ts
```

Expected output:

```text
[phase1-storage-validation] PASS
```

Validation checks performed:

1. Key layout matches required directory contract.
2. Signed URL contains required SigV4 query parameters.
3. Signed URL path matches expected bucket/object key structure.
4. Bucket CORS policy allows browser `PUT` from approved frontend origins (no wildcard in production).


## Phase 2: DB and Queue Extensions

This section records implementation of **Phase 2 only**.

### Implemented

1. New document queue/data row types in storage service:
   - `DocumentJobState`
   - `DocumentJobRow`
2. New schema objects in `PostgresStorageService.ensureSchema()`:
   - `document_jobs`
   - `document_assets`
   - `document_artifacts`
3. Idempotency and lookup indexes:
   - `ux_document_jobs_user_request_hash` (partial unique on `(user_id, request_hash)`)
   - `idx_document_jobs_queue_pull`
   - `idx_document_jobs_user_created`
   - `idx_document_assets_job_status`
   - `idx_document_artifacts_job_created`
4. Queue/storage methods added to `PostgresStorageService`:
   - `enqueueDocumentJob(...)`
   - `claimNextQueuedDocumentJob(...)`
   - `updateDocumentJobState(...)`
   - `upsertDocumentAsset(...)`
   - `upsertDocumentArtifact(...)`
5. Backward-compatible ALTER coverage added:
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` for key document columns.

Primary file changed:

- `src/storage/postgres-storage.service.ts`

### Validation

Validation script:

- `tools/validate-document-phase2-db.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase2-db.ts
```

Expected output:

```text
[phase2-db-validation] PASS
```

Validation checks performed:

1. Document table DDL exists for `document_jobs`, `document_assets`, `document_artifacts`.
2. Idempotency and queue indexes are present in schema SQL.
3. Required Phase 2 queue/data methods exist in `PostgresStorageService`.
4. `request_hash` composition includes `docVersionHash` so same request on different document versions is not deduped incorrectly.

## Phase 3: Intake API (Zero-Proxy Ingestion)

This section records implementation of **Phase 3 only**.

### Implemented

1. New document intake module:
   - `src/documents/intake/document-intake.module.ts`
2. New intake controller with guarded endpoints:
   - `src/documents/intake/document-intake.controller.ts`
   - `POST /documents/jobs`
   - `POST /documents/jobs/:jobId/finalize`
   - `GET /documents/jobs/:jobId/status`
   - `GET /documents/jobs/:jobId/download-url`
3. New intake service:
   - `src/documents/intake/document-intake.service.ts`
   - Draft job metadata generation
   - Signed upload URL generation (direct-to-object-store)
   - Finalize + queue flow
   - Status and final download URL resolution
4. Strict payload validation:
   - `src/documents/intake/document-intake.validation.ts`
   - Enforces `.docx` extension, required DOCX MIME, and `DOC_MAX_MB`
   - Enforces `doc_version_hash` as SHA-256 hex
5. DTO/type file:
   - `src/documents/intake/document-intake.types.ts`
6. App wiring:
   - `src/app.module.ts` imports `DocumentIntakeModule`
7. Storage read helpers for intake status/download:
   - `src/storage/postgres-storage.service.ts`
   - `getDocumentJobStatusForUser(...)`
   - `getDocumentArtifactKeyForUser(...)`

Zero-proxy guarantee in this phase:

1. API issues signed upload URL.
2. Client uploads directly to object storage.
3. API finalize endpoint persists/queues metadata only.

### Validation

Validation script:

- `tools/validate-document-phase3-intake.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase3-intake.ts
```

Expected output:

```text
[phase3-intake-validation] PASS
```

Validation checks performed:

1. Valid `.docx` payload accepted.
2. Invalid extension/MIME rejected.
3. Invalid `doc_version_hash` rejected.
4. Intake routes exist for create/finalize/status/download.
5. Signed upload URL flow is used in service layer.

## Phase 4: Analysis and Anchor Detection (Layer 1 Deterministic Skeleton)

This section records implementation of **Phase 4 only**.

### Implemented

1. New analysis package:
   - `src/documents/analysis/document-analysis.types.ts`
   - `src/documents/analysis/document-analysis.service.ts`
   - `src/documents/analysis/index.ts`
2. Document analysis capabilities:
   - Plain-text paragraph extraction into stable paragraph nodes
   - Deterministic signal extraction per paragraph:
     - `has_sequence`
     - `has_data`
     - `has_entity`
     - `text_density`
   - Structural section inference
   - Static anchor map generation using:
     - `xml_path_id` (deterministic path id)
     - `paragraph_hash` (stable content hash)
   - Deterministic sequence-group tagging (`sequence_group_id`) for contiguous step-like ranges
3. Deterministic anchor IDs:
   - `anchor-{index}-{hash_prefix}` derived from paragraph hash and index
4. Fallback anchor mode:
   - If low-signal content, fallback anchors at start/mid/end
5. LLM context-window preparation:
   - `buildContextWindows(...)`
   - Bounded windows with configurable radius (default +/- 2048 chars)
   - Sequence-aware expansion rule: if high sequence signal is detected (for example `Step 1 ... Step N`), the context window expands to include the entire detected sequence range even if it exceeds character bounds.
6. Export wiring:
   - `src/documents/index.ts` now exports the analysis package

### Validation

Validation script:

- `tools/validate-document-phase4-analysis.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase4-analysis.ts
```

Expected output:

```text
[phase4-analysis-validation] PASS
```

Validation checks performed:

1. Paragraph and section extraction return expected structure.
2. Static anchor map is deterministic for identical input.
3. Context windows are generated per anchor and stay within bounds.
4. Fallback anchor mode is triggered for low-signal content.
5. High-sequence ranges are captured as full-range windows (not truncated to 2048 chars).
6. `anchor_id` stability is preserved across worker restarts for the same source document and version hash.
7. Signal metadata (`has_sequence|has_data|has_entity|text_density`) is emitted deterministically.

## Phase 5: Visual Manifest Planning (Layer 2/3 currently scoped)

This section records implementation of **Phase 5 only**.

### Implemented

1. New planning package:
   - `src/documents/planning/visual-manifest.types.ts`
   - `src/documents/planning/visual-manifest.schema.ts`
   - `src/documents/planning/visual-manifest-planner.service.ts`
   - `src/documents/planning/index.ts`
2. Manifest planner:
   - Builds visual manifest from analysis anchors
   - Maps to current `generateFromManifest`-compatible shape:
     - `course`
     - `lessons[].visualizations[]`
3. Guardrails in planner:
   - Enforces `maxAssets` (`DOC_MAX_ASSETS` fallback)
   - Dedupes near-duplicate anchor text via normalized fingerprint
4. Type mapping heuristics:
   - `data_viz` for chart/metric/trend-like text
   - `sourced_image` for scene/photo-like text
   - `flowchart` for procedural/sequence logic
   - default `infographic`
5. Flowchart rendering gate (Mermaid Gate):
   - If `visual_type=flowchart`, run Mermaid syntax validation before rendering.
   - On syntax failure, perform one self-correction pass by sending the syntax error back to the planner/LLM.
   - If still invalid after one retry, downgrade to `aesthetic_anchor` (or configured safe fallback), and log the downgrade reason.
6. Schema validation:
   - Zod schema for manifest correctness
   - Validation result returns `valid + errors[]`
7. Persistence helper in storage:
   - `upsertDocumentManifestValidation(...)` in `PostgresStorageService`
   - Stores manifest + validation metadata as `manifest_json` artifact record
8. Export wiring:
   - `src/documents/index.ts` exports planning package

### Validation

Validation script:

- `tools/validate-document-phase5-planning.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase5-planning.ts
```

Expected output:

```text
[phase5-planning-validation] PASS
```

Validation checks performed:

1. Planner output passes schema validation.
2. Max-asset cap is enforced.
3. Duplicate anchor-derived visuals are deduped.
4. Output shape is compatible with lesson/visualizations manifest routing.
5. `data_viz` and `sourced_image` routes generate distinct prompt templates and are validated as non-identical.
6. Flowchart Mermaid syntax validator executes for flowchart jobs; single self-correction retry is enforced; fallback path is logged on persistent failure.

## Phase 6: Document Processing Observability and Logging

This phase is observability-first and is now part of the numbered execution sequence immediately after Phase 5.
All later phases are shifted down by one position.

### Objectives

1. Make every document job fully traceable from upload to final `.docx`.
2. Provide live operator visibility into stage progress, errors, and bottlenecks.
3. Expose quality signals (anchor stability, insertion integrity, asset relevance) for fast validation.
4. Make failure recovery actionable with direct links to logs and artifacts.

### Implemented

1. Live stats payload extension (non-breaking):
   - `src/observability/observability.gateway.ts`
   - Adds `live_stats.documents` block:
     - `documents.queue` (`queued|processing|completed|failed`)
     - `documents.recent_jobs`
     - `documents.artifact_type_counts`
2. Storage read APIs for document observability:
   - `src/storage/postgres-storage.service.ts`
   - `getDocumentQueueHealthStats()`
   - `getRecentDocumentJobs(limit)`
   - `getDocumentArtifactTypeCounts(limit)`
3. Document intake lifecycle logging:
   - `src/documents/intake/document-intake.service.ts`
   - Emits structured logs for:
     - draft creation
     - upload URL issuance
     - job queueing
     - status reads
     - download URL issuance
4. Intake module dependency wiring:
   - `src/documents/intake/document-intake.module.ts`
   - Imports `ObservabilityModule` to emit document logs.
5. Phase 6 Step 1 canonical schema wiring:
   - `src/documents/observability/document-event.schema.ts`
   - `src/observability/observability.gateway.ts`
   - `src/worker/document-queue.worker.service.ts`
   - Shared event schema + parser-backed validation in gateway emitter.
   - Canonical fields normalized into structured JSON:
     - `event_id`, `job_id`, `asset_task_id`, `user_id`, `stage`, `event_type`, `severity`
     - `duration_ms`, `error_code`, `error_message`
     - `deployment_id`, `service_role`, `worker_id`, `pid`, `timestamp_iso`

### Implementation details (design intent)

#### Step 1: Canonical Event Schema

1. Add a document event schema used by app + worker logs:
   - `event_id`
   - `job_id`
   - `asset_task_id` (nullable)
   - `user_id`
   - `stage` (`queued|analyzing|planning|generating_assets|inserting|packaging|completed|failed`)
   - `event_type` (`stage_started|stage_completed|stage_failed|retry_scheduled|artifact_written|quality_scored`)
   - `severity` (`debug|info|warn|error`)
   - `duration_ms` (for stage completion)
   - `error_code` / `error_message` (on failure)
   - `deployment_id`, `service_role`, `worker_id`, `pid`
   - `timestamp_iso`
2. Standardize payload structure in one shared helper module (single source of truth).

Validation requirements:
1. All document logs emitted in JSON with required fields.
2. Missing required fields fail local schema validation.
3. Stage transitions in logs match persisted DB state transitions.

Validation script:

- `tools/validate-document-phase6-step1-event-schema.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-step1-event-schema.ts
```

Expected output:

```text
[phase6-step1-event-schema-validation] PASS
```

#### Step 2: Stage Timers and Critical Counters

1. Emit timers per stage:
   - `doc_stage_duration_ms{stage=...}`
2. Emit counters:
   - `doc_jobs_total{status=completed|failed}`
   - `doc_retries_total{stage=...}`
   - `doc_anchor_fallback_total`
   - `doc_insertion_collision_total`
   - `doc_version_hash_mismatch_total`
3. Emit queue gauges:
   - `doc_jobs_inflight`
   - `doc_jobs_queued`
   - `doc_assets_inflight`
4. Emit planning/render gate counters:
   - `doc_flowchart_mermaid_invalid_total`
   - `doc_flowchart_mermaid_self_correct_total`
   - `doc_flowchart_mermaid_fallback_total`

Validation requirements:
1. Metrics update on every run (happy path + failure path).
2. Counter deltas match event counts in logs.
3. Stage timing percentiles available (P50/P95/P99).
4. Mermaid gate counters reconcile with flowchart task logs and outcomes.

Validation script:

- `tools/validate-document-phase6-step2-metrics.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-step2-metrics.ts
```

Expected output:

```text
[phase6-step2-metrics-validation] PASS
```

#### Step 3: Artifact Index and Deep Links

1. Persist an artifact index per job in DB + storage (JSON):
   - source doc key
   - backup key (`source_v1_backup.docx`)
   - analysis JSON key
   - anchor map key
   - manifest key
   - generated asset keys
   - final output key
   - debug report key
2. Include signed URL resolvers for operator-only debug access.
3. Add `artifact_written` events for each artifact with object key and byte size.

Validation requirements:
1. Every completed job has a complete artifact index.
2. Every failed job has source + backup + failure report links.
3. Artifact URLs resolve and expire according to policy.

Validation script:

- `tools/validate-document-phase6-step3-artifact-index.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-step3-artifact-index.ts
```

Expected output:

```text
[phase6-step3-artifact-index-validation] PASS
```

#### Step 4: Live Views (Operator Dashboard)

Status: `implemented`

1. Add live "Document Jobs" view:
   - active jobs table with `job_id`, user, stage, elapsed time, worker, retries
2. Add stage waterfall panel:
   - per-job timeline of stage durations
3. Add failures panel:
   - top error codes, failing stage, last deployment correlation
4. Add throughput panel:
   - jobs/hour, assets/job, success rate
5. Add quality panel:
   - anchor fallback rate
   - insertion fallback rate
   - average asset quality score
   - doc corruption/repair prompt rate

Validation requirements:
1. New jobs appear in live view within acceptable latency.
2. Stage changes stream in real time.
3. Dashboard links open corresponding logs and artifacts.

Validation script:

- `tools/validate-document-phase6-step4-live-views.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-step4-live-views.ts
```

Expected output:

```text
[phase6-step4-live-views-validation] PASS
```

#### Step 5: Quality Scorecards per Job

Status: `implemented`

1. Write a `quality_report.json` per job with:
   - anchor resolution rate
   - anchor fallback count
   - insertion collision count
   - asset generation success ratio
   - average CLIP/vision score (if used)
   - formatting integrity checks
   - final quality verdict (`pass|needs_review|fail`)
2. Emit `quality_scored` event after packaging.
3. Store scorecard summary in DB for query/filtering.

Validation requirements:
1. Every completed job has a quality report.
2. Quality verdict logic is deterministic for same inputs.
3. Dashboard can filter by `needs_review` and `fail`.

Validation script:

- `tools/validate-document-phase6-step5-quality-scorecards.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-step5-quality-scorecards.ts
```

Expected output:

```text
[phase6-step5-quality-scorecards-validation] PASS
```

#### Step 6: Failure Forensics and Recovery Logging

Status: `implemented`

1. On failure, emit a single normalized `doc_job_failed` summary event:
   - stage
   - root error code
   - retry history
   - recovery recommendation
2. Generate `failure_report.json`:
   - stage timeline
   - last successful stage
   - artifact availability
   - suggested operator/user next action
3. Ensure rollback path is logged explicitly:
   - backup created
   - restore attempted
   - restore outcome
4. Ensure insertion ordering is logged explicitly for insertion phase:
   - bottom-up order (`last anchor -> first anchor`)
   - number of anchors inserted vs skipped due to conflict

Validation requirements:
1. Failure report exists for every failed job.
2. Root cause code and stage are always present.
3. Rollback action path is visible in logs.
4. Insertion logs prove reverse-order placement strategy when insertion stage runs.

Validation script:

- `tools/validate-document-phase6-step6-failure-forensics.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-step6-failure-forensics.ts
```

Expected output:

```text
[phase6-step6-failure-forensics-validation] PASS
```

#### Step 7: Alerts and SLO Guardrails

1. Add alert rules:
   - high failure rate (5-min and 1-hour windows)
   - P95 end-to-end duration breach
   - repeated insertion-stage failures
   - queue lag growth
   - worker crash loop/OOM
2. Define initial SLOs:
   - success rate target
   - P95 completion target
   - max corruption rate
3. Route alerts with context payload (deployment, job sample links).

Validation requirements:
1. Synthetic alert tests confirm each rule triggers.
2. Alert payload includes direct drilldown links.
3. On-call runbook references match actual dashboards/queries.

### Log Types Required

1. Lifecycle logs: stage start/complete/fail, transition validation.
2. Performance logs: stage durations, queue waits, per-asset latency.
3. Quality logs: anchor confidence, fallback reasons, insertion results.
4. Artifact logs: write/read/delete, object keys, sizes.
5. Security/audit logs: user ownership checks, signed URL issuance/use.
6. Recovery logs: retries, rollback, terminal status with reasons.

### Live Views Required

1. Job list (live).
2. Per-job timeline/waterfall.
3. Error heatmap by stage/code.
4. Worker health and queue pressure.
5. Quality trend board (daily/weekly).

### Validation Gates for This Phase

1. No feature rollout unless event schema compliance is >= 99%.
2. No rollout unless every failed job has forensic report + artifact index.
3. No rollout unless dashboard live latency and metric freshness are within agreed bounds.
4. No rollout unless alert tests pass and runbook drilldowns are validated.

### Validation

Validation script:

- `tools/validate-document-phase6-observability.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase6-observability.ts
```

Expected output:

```text
[phase6-observability-validation] PASS
```

## How To Use Updated Observability

1. Start app and open existing observability dashboard as usual (no dashboard migration required).
2. Trigger document flow:
   - `POST /documents/jobs`
   - upload directly to signed URL
   - `POST /documents/jobs/:jobId/finalize`
3. Watch websocket/live stats payload:
   - inspect `live_stats.documents.queue` for queue movement
   - inspect `live_stats.documents.recent_jobs` for per-job state/attempts
   - inspect `live_stats.documents.artifact_type_counts` for manifest/output artifact trends
4. Watch system logs stream:
   - filter by `context=DocumentIntake`
   - confirm lifecycle events for each job ID
5. Correlate with API:
   - `GET /documents/jobs/:jobId/status`
   - confirm returned state matches `recent_jobs` and system logs.

## How To Validate Quality For Phases 1-5 (using observability-first workflow)

1. Phase 1 (Storage):
   - Create draft job and confirm `DocumentIntake` log for upload URL issuance.
   - Verify object key path shape in metadata/logs (`documents/{jobId}/input/source.docx`).
2. Phase 2 (DB/Queue):
   - Finalize job and confirm `documents.queue.queued` increments.
   - Confirm job appears in `documents.recent_jobs` with attempts/max_attempts.
3. Phase 3 (Intake API):
   - Validate invalid MIME/size rejects.
   - Validate successful create/finalize emits lifecycle logs and status is retrievable.
4. Phase 4 (Analysis/Anchors):
   - Run `tools/validate-document-phase4-analysis.ts`.
   - Confirm deterministic anchor IDs and fallback mode behavior in validator output.
5. Phase 5 (Manifest planning):
   - Run `tools/validate-document-phase5-planning.ts`.
   - Review generated sample manifests for relevance/dedupe/type mapping and approve thresholds.
   - Persist manifest validation results and verify artifact counters include `manifest_json`.

## Tactical Milestone Review (Architect Checks)

1. Phase 1 (Storage) -> Core win: R2/S3-compatible zero-proxy ingestion.
   - Critical check: verify bucket CORS permits browser `PUT` from your frontend domain.
2. Phase 2 (DB/Queue) -> Core win: idempotent document intake and stable queue pull semantics.
   - Critical check: ensure `request_hash` includes `docVersionHash`.
3. Phase 4 (Analysis) -> Core win: deterministic anchors and context windows.
   - Critical check: confirm `anchor_id` values remain stable across worker restarts.
4. Phase 5 (Planning) -> Core win: semantic mapping to visual types.
   - Critical check: verify `data_viz` prompt path is materially distinct from `sourced_image` prompt path.
5. Phase 5/7 (Flowcharts) -> Core win: Mermaid gate prevents invalid flowchart render jobs.
   - Critical check: enforce syntax check + one self-correction retry + deterministic fallback.
6. Phase 8 (Insertion) -> Core win: drift-safe document mutation.
   - Critical check: reverse-order insertion (`last anchor -> first anchor`) is enforced and logged.


## Phase 7: Worker Orchestration and Resource Control

This phase ensures that the app-worker doesn't crash from memory pressure when switching between "lightweight" image generation and "heavy" document editing.
Status: `implemented`

### Implemented

1. Added shared worker resource semaphore:
   - `src/worker/worker-resource-semaphore.service.ts`
   - Provides insertion lock acquire/release/read APIs.
2. Wired semaphore into worker module:
   - `src/worker/worker.module.ts`
3. Added insertion lock lifecycle in document worker:
   - `src/worker/document-queue.worker.service.ts`
   - Acquires lock before insertion work and releases in `finally`.
   - Emits lock acquire/release observability logs.
4. Added image-queue pull pause while insertion lock is active:
   - `src/worker/durable-queue.worker.service.ts`
   - Loop pauses before `claimNextQueuedTask(...)` when insertion lock is active.
5. Added Mermaid render gate before renderer call:
   - `src/image-gen/strategies/d2-diagram.strategy.ts`
   - If `mermaid_code` is provided and invalid, renderer call is blocked with explicit log and error.
   - Valid Mermaid logs a gate pass event.

### Validation Plan

    Implement a Resource Semaphore: Create a lock mechanism in the worker logic that grants exclusive CPU/RAM access to the Insertion Module.

    Pause Image Pulls: While a document is in the INSERTING stage, the worker must block the PostgresStorageService.claimNextQueuedTask() function for all other image tasks.

    Mermaid Render Gate: Integrate a hook that runs the Mermaid syntax check immediately before calling the Chromium/Playwright renderer.

Validation Plan

    Local Validation:

        Unit Test: Use a mock semaphore to verify that the claimNextTask function returns null while an "Insertion Lock" is active.

        Syntax Test: Provide a valid and an invalid Mermaid string; verify the renderer only attempts to process the valid one.

    E2E Validation: Run a 50MB document job in "Parallel Stress Mode" (trigger 5 document jobs at once).

    Outcome: The worker memory profile should remain stable (no sawtooth pattern or OOMs), and the queue should process document jobs one-at-a-time while image tasks wait in the wings.

Validation script:

- `tools/validate-document-phase7-worker-orchestration.ts`

Run command:

```bash
npx ts-node --transpile-only tools/validate-document-phase7-worker-orchestration.ts
```

Expected output:

```text
[phase7-worker-orchestration-validation] PASS
```

🪡 Phase 8: Surgical Insertion + Rollback Artifacts

This phase executes the physical modification of the user's document using a "Safety-First" mutation strategy.
Key Instructions for the Agent

    Immutable Backup Creation: Before the first edit, the worker must copy source.docx to source_v1_backup.docx in R2.

    Bottom-Up Execution: Implement the insertion loop to process the manifest.visualizations array in reverse order (highest xml_path_id first). This ensures that as page 10 expands, it doesn't shift the "anchors" for page 2.

    Deterministic Anchor Matching: Match anchors based on the xml_path_id and paragraph_hash generated in Phase 4 to ensure precision.

Validation Plan

    Local Validation:

        Drift Test: Create a 2-page doc. Insert a large image at the very end. Verify that the anchor for the first paragraph on page 1 remains at the same XML index.

        Collision Test: Provide two identical sentences in a document. Verify that the image is only inserted into the one specifically identified by its unique path ID.

    E2E Validation: Trigger a job failure mid-insertion (manual kill). Verify that the system automatically points the user's download-url to the source_v1_backup.docx instead of a half-edited file.

    Outcome: A "Surgical Log" that proves reverse-order placement and a 0% corruption rate across your acceptance docs.

🕵️ Desired State after Phase 8
Metric	Target Outcome
Integrity	100% of .docx files open without "Repair Document" prompts.
Stability	0 Worker OOM crashes under a 50MB load.
Resilience	Every failed job has a corresponding source_v1_backup.docx available for recovery.
