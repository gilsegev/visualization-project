# Phase 6 Document Planning Quality Fixes (2026-03-06)

This note documents the implementation completed on branch `document-processing` to address shallow document understanding and DOC JOBS observability issues.

## Scope Completed

1. Runtime analysis input fix (Phase 4 path)
   - Worker now extracts real text from uploaded `.docx` (`word/document.xml`) before analysis.
   - Removed filename-as-document analysis behavior.
   - Added extraction metadata to `analysis_json` artifact (`source`, `extracted_char_count`).

2. Analysis output enrichment
   - `DocumentAnalysisService` now returns `context_windows` as part of analysis output.
   - Worker passes those windows into planner input.

3. Planner quality fixes (Phase 5 path)
   - Added intent-aware routing for mixed windows:
     - procedural -> `flowchart`
     - quantitative -> `data_viz`
     - atmospheric -> `sourced_image`
   - Added content slicing per intent so each visualization uses relevant subset text.
   - Added flowchart text/node caps to prevent oversized diagrams.
   - Added overlap-aware dedupe by anchor window range to reduce duplicate flowcharts.

4. Mermaid gate behavior
   - Preserved existing Mermaid validation gate, single self-correction retry, and deterministic fallback.
   - Improved inputs into Mermaid generation by isolating procedural step text.

5. Document observability wiring (Phase 6)
   - Added document planning lifecycle logs in worker under `DocumentLLM` context:
     - start
     - complete
     - validation warning (on invalid manifest)
   - Included `doc_job_id`, `stage`, `event_type`, `duration_ms`, and planning metrics in metadata.
   - This ensures planning-call telemetry appears in DOC JOBS log filtering.

6. DOC JOBS UI overlap fix
   - Removed duplicate/competing log rendering in DOC JOBS mode.
   - Hidden global sticky log actions in DOC JOBS mode to avoid panel overlap.
   - Kept DOC JOBS logs in right-side Execution Trace as single source of truth.

7. Build/guard compatibility
   - Added `PostgresStorageService.isOperational()` expected by `ApiKeyGuard`.
   - Build now passes.

## Validation

Executed and passing:

1. `tools/validate-document-phase4-analysis.ts`
2. `tools/validate-document-phase5-planning.ts`
3. `tools/validate-document-phase6-observability.ts`
4. `npm run build`

## Files Touched (this scope)

- `src/documents/analysis/docx-text-extractor.service.ts`
- `src/documents/analysis/document-analysis.service.ts`
- `src/documents/analysis/document-analysis.types.ts`
- `src/documents/analysis/index.ts`
- `src/documents/planning/visual-manifest-planner.service.ts`
- `src/worker/document-queue.worker.service.ts`
- `src/worker/worker.module.ts`
- `src/storage/postgres-storage.service.ts`
- `public/dashboard/index.html`
- `tools/validate-document-phase4-analysis.ts`
- `tools/validate-document-phase5-planning.ts`
- `tools/validate-document-phase6-observability.ts`
- `package.json`
- `package-lock.json`
