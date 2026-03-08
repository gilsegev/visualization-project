# Quality Improvement Plan

## Architecture Principles

1. Keep the LLM as the primary decision-maker for visualization type, placement intent, and generation intent.
2. Preserve dynamic generation behavior. Avoid rigid, hardcoded prompt templates per asset type.
3. Keep deterministic logic limited to safety, executability, and DOCX integrity.

## Agreed Design Changes

1. Add an LLM-first Visualization Eligibility Router.
- LLM proposes `type`, `rationale`, and `evidence spans`.
- Deterministic validator checks structural validity only.
- If invalid, apply deterministic safe-type remap and log the override.

2. Enforce semantic payload hygiene.
- Strip internal metadata from generation payloads (`anchor_id`, internal IDs, pipeline-only labels).
- Inject explicit negative constraints to prevent known artifacts.
- Examples: no UI chrome, no mouse cursors, no placeholder text, no gibberish overlays.

3. Use LLM-led global placement planning with a constrained placement language.
- LLM outputs placement via a controlled DSL, not raw coordinates.
- Example tokens: `[AFTER_ANCHOR]`, `[AFTER_LIST_BLOCK]`, `[SECTION_INTRO_BODY]`, `[SECTION_END]`.
- Optional hints: alignment and bounded size hints.

4. Execute placement with deterministic insertion.
- Resolve placement DSL to real document positions.
- Enforce DOCX safety and integrity constraints.
- Handle collisions and unsafe targets deterministically.

5. Replace re-plan-on-structural-failure with Snap-to-Grid.
- If an LLM target is invalid or unsafe, auto-snap to nearest valid target.
- Log requested vs snapped placement and reason.
- Avoid extra LLM roundtrips for structural placement errors.

6. Add pre-insertion semantic QC with an independent multi-modal judge.
- Do not use the same model that generated the asset.
- Use a vision-capable judge model to detect hallucinations, text gore, irrelevance, and readability defects.
- On failure, retry generation with corrected constraints or use safe fallback type.

7. Expand observability end-to-end.
- Record raw LLM intent, normalized plan, snap-to-grid actions, QC decisions, and insertion outcomes.
- Expose per-asset prompt, output summary, judge verdicts, and quality scores in UI/logs.

## Policy Boundary

### LLM Responsibilities

- Semantic judgment and layout intent.
- Visualization type intent and placement intent.

### Deterministic Responsibilities

- Schema validity and placement executability.
- Collision handling and snap-to-grid safety adjustments.
- File integrity guarantees for DOCX output.
