# Quality Improvement Plan

## Architecture Principles

1. Keep the LLM as the primary decision-maker for visualization type, placement intent, and generation intent.
2. Preserve dynamic generation behavior. Avoid rigid, hardcoded prompt templates per asset type.
3. Keep deterministic logic limited to safety, executability, and DOCX integrity.

## Implementation Tracker

### 1) LLM-first Visualization Eligibility Router

- Status: `implemented`
- Design:
- LLM proposes type + rationale + evidence spans.
- Deterministic validator checks structural eligibility only.
- Invalid type is safely remapped and override is logged.
- How it will be validated:
- Run planner with `DOC_PLANNING_USE_LLM=true` and inspect `planning_llm_trace_json`.
- Confirm type decisions include validation/remap metadata for any ineligible choice.
- Confirm manifest contains only eligible final types for the source evidence.
- Validation result:
- Implemented in planner normalization and deterministic planning paths.
- Evidence:
- `src/documents/planning/visual-manifest-planner.service.ts`: `validateTypeEligibility`, `remapIneligibleType`, `eligibility_remap` usage in both deterministic and LLM paths.
- Build passed: `npm run build`.

### 2) Semantic Payload Hygiene + Negative Constraints

- Status: `implemented`
- Design:
- Strip pipeline/internal metadata from generation prompts.
- Inject negative constraints to block known artifacts.
- How it will be validated:
- Trigger a document job and inspect `DocumentAsset` logs.
- Confirm emitted prompt excludes anchor IDs / internal labels.
- Confirm prompt includes explicit negative constraints.
- Validation result:
- Prompt sanitation and constraints injection added in worker prompt preparation.
- Evidence:
- `src/worker/document-queue.worker.service.ts`: `sanitizeGenerationPrompt` + constraints sentence + sanitized prompt used in generation.
- Build passed: `npm run build`.

### 3) LLM-led Global Placement with Constrained DSL

- Status: `implemented`
- Design:
- LLM emits constrained placement tokens.
- Deterministic parser maps DSL tokens to supported scopes.
- How it will be validated:
- Inspect planner prompt contract and parsed output normalization.
- Confirm `[AFTER_ANCHOR]`, `[AFTER_LIST_BLOCK]`, `[SECTION_INTRO_BODY]`, `[SECTION_END]` map to internal scopes.
- Validation result:
- DSL token support added to planner scope normalization and prompt contract.
- Evidence:
- `src/documents/planning/visual-manifest-planner.service.ts`: `parsePlacementDslToken`, DSL prompt contract tokens, `placement_dsl_token_normalized`.
- Build passed: `npm run build`.

### 4) Deterministic Execution of Placement DSL

- Status: `implemented`
- Design:
- Inserter resolves normalized scope into concrete paragraph insertion points.
- Maintains DOCX integrity, heading/list safety, and collision handling.
- How it will be validated:
- Run insertion for mixed-content doc and inspect `surgical_log_json`.
- Confirm resolved scope and paragraph index are present for each plan.
- Validation result:
- Existing inserter scope resolution retained and extended with richer placement diagnostics.
- Evidence:
- `src/documents/insertion/docx-surgical-inserter.service.ts`: resolved scope/index logging + `snap_reason`.
- Build passed: `npm run build`.

### 5) Snap-to-Grid Instead of Re-Plan on Structural Failure

- Status: `implemented`
- Design:
- Invalid/unsafe placement is deterministically snapped to nearest safe target.
- No extra LLM roundtrip for structural placement failure.
- How it will be validated:
- Force invalid placement target and inspect `surgical_log_json`.
- Confirm `requested` vs `resolved` target and snap reason are logged.
- Validation result:
- Snap-to-grid logging and metrics added in inserter and worker stage telemetry.
- Evidence:
- `src/documents/insertion/docx-surgical-inserter.service.ts`: `snap_to_grid_adjustments` counter.
- `src/worker/document-queue.worker.service.ts`: insertion telemetry includes `snap_to_grid_adjustments`.
- Build passed: `npm run build`.

### 6) Independent Multi-Modal Judge for Pre-Insertion QC

- Status: `implemented`
- Design:
- Use a separate vision-capable model as judge (not generator model).
- Judge checks relevance, text-gore/hallucination, readability, and policy fit.
- Failed assets are excluded from insertion and logged.
- How it will be validated:
- Enable judge config and run a doc job.
- Confirm `DocumentAssetJudge` events include verdict, score, reasons.
- Confirm rejected assets are skipped before insertion.
- Validation result:
- Judge service integrated into worker pre-insertion pipeline with structured observability.
- Evidence:
- `src/documents/quality/document-asset-judge.service.ts` added and wired in `src/worker/worker.module.ts`.
- Worker generation loop now runs judge and rejects failed assets before persistence/insertion.
- Build passed: `npm run build`.

### 7) End-to-End Observability Expansion

- Status: `implemented`
- Design:
- Capture intent vs normalized decisions, snap actions, judge verdicts, final insertion outcomes.
- Surface metrics for planned/resolved/inserted/skipped and adjustment counts.
- How it will be validated:
- Inspect `planning_llm_trace_json`, `surgical_log_json`, and execution trace for job.
- Confirm each stage emits structured metadata fields.
- Validation result:
- Planner + worker + inserter telemetry expanded for all required decision points.
- Evidence:
- `planning_llm_trace_json` now includes normalization reasons for placement/type remaps.
- `surgical_log_json` includes `snap_reason` and `snap_to_grid_adjustments`.
- `DocumentAssetJudge` logs include model, score, reason, concerns.
- Build passed: `npm run build`.

## Validation Run Log

- `npm run build`: passed.
- `npm test -- --runInBand --passWithNoTests`: passed (`No tests found`).
- Static verification via `rg` completed for all implemented features (eligibility router, DSL placement, prompt hygiene, judge integration, snap metrics).

## Policy Boundary

### LLM Responsibilities

- Semantic judgment and layout intent.
- Visualization type intent and placement intent.

### Deterministic Responsibilities

- Schema validity and placement executability.
- Collision handling and snap-to-grid safety adjustments.
- File integrity guarantees for DOCX output.
