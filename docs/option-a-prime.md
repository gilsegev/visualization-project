# Option A-prime: Phase 0 Implementation

This file tracks implementation status for **Phase 0 only** (Scope Lock and Contracts).

## Implemented

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

## Validation (Phase 0 design checks)

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

## Scope Guard

The initial change set implemented Phase 0 only. The current change set extends implementation through Phase 1 storage only.

## Phase 1 Implementation: Storage Layer (R2 / S3-compatible)

This section records implementation of **Phase 1 only**.

## Implemented (Phase 1)

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

## Validation (Phase 1)

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

## Scope Guard (current)

This change set is limited to Phase 1 storage primitives and validation only.

## Proposed Next Phase: Document Processing Observability and Logging

This phase is observability-first and should be implemented before broad document-processing rollout.

### Objectives

1. Make every document job fully traceable from upload to final `.docx`.
2. Provide live operator visibility into stage progress, errors, and bottlenecks.
3. Expose quality signals (anchor stability, insertion integrity, asset relevance) for fast validation.
4. Make failure recovery actionable with direct links to logs and artifacts.

### Implementation Plan

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

Validation requirements:
1. Metrics update on every run (happy path + failure path).
2. Counter deltas match event counts in logs.
3. Stage timing percentiles available (P50/P95/P99).

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

#### Step 4: Live Views (Operator Dashboard)

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

#### Step 5: Quality Scorecards per Job

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

#### Step 6: Failure Forensics and Recovery Logging

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

Validation requirements:
1. Failure report exists for every failed job.
2. Root cause code and stage are always present.
3. Rollback action path is visible in logs.

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
