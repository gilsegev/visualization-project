# Phase 6 Completion Notes (Document Processing Observability and Logging)

This note documents Phase 6-only work completed on branch `document-processing`.

## Scope Implemented

1. Canonical document event schema fields in log pipeline:
   - `doc_job_id`
   - `stage`
   - `event_type`
   - `duration_ms`
   - `error_code`
   - `error_message`

2. New canonical event emitter:
   - `ObservabilityGateway.emitDocumentEvent(...)`
   - Used by document intake lifecycle operations to emit normalized stage events.

3. Document observability metrics from Postgres:
   - Added `getDocumentObservabilityMetrics()` in `PostgresStorageService`
   - Exposes:
     - `completed_total`
     - `failed_total`
     - `retries_total`
     - `avg_duration_ms`
     - `p95_duration_ms`
     - `flowchart_fallback_total`

4. `live_stats.documents.metrics` wiring:
   - Included in websocket `live_stats` snapshots from `ObservabilityGateway`.

5. Dashboard visibility:
   - Added document metric cards:
     - Avg duration
     - P95 duration
     - Retries
     - Flowchart fallbacks
   - Added `documentObsMetrics` computed binding and default payload handling.

6. Phase 6 validator expansion:
   - `tools/validate-document-phase6-observability.ts` now checks:
     - canonical event emitter presence
     - canonical document fields in structured logs
     - document observability metrics wiring
     - dashboard metric bindings

## Files Changed

- `src/observability/observability.gateway.ts`
- `src/storage/postgres-storage.service.ts`
- `src/documents/intake/document-intake.service.ts`
- `public/dashboard/index.html`
- `tools/validate-document-phase6-observability.ts`

## Validation Run

Command:

```bash
cmd /c npx ts-node --transpile-only tools/validate-document-phase6-observability.ts
```

Result:

```text
[phase6-observability-validation] PASS
```
