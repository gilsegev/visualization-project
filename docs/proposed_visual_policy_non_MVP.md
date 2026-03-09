# Proposed Visual Policy (Non-MVP)

## Goal
Add a user-selectable planning policy to control how conservative vs liberal document visualization planning should be.

This is intentionally deferred from MVP and documented for future implementation.

## Why this is not just LLM temperature
Variance in outputs is affected by more than LLM sampling:
- candidate filtering and scaffold suppression
- type eligibility/remap guards
- per-section density caps
- fallback behavior

So the feature should be a policy layer, not only a temperature field.

## Proposed user-facing control
- `Conservative`
- `Balanced` (default)
- `Liberal`

Stored per document job in metadata:
- `visualization_policy: conservative | balanced | liberal`

## Internal knobs (mapped from policy)
- `llm_temperature`
- `max_assets`
- `scaffold_filter_strength`
- `min_data_candidates`
- `min_flow_candidates`
- `min_scene_candidates`
- `section_asset_cap`
- `allow_fallback_assets`

## Behavioral mapping
### Conservative
- low LLM temperature
- strict scaffold suppression
- strict evidence requirements
- lower max assets

### Balanced
- moderate temperature
- normal scaffold suppression
- type quotas enforced
- current max assets

### Liberal
- higher temperature
- relaxed scaffold suppression
- broader candidate pool
- higher max assets

## Hard guardrails (always on)
- No unsupported factual additions
- Require evidence spans per planned visual
- `data_viz` requires numeric/metric evidence
- If evidence is weak, skip with explicit reason instead of inventing content

## API/UI/Observability additions
### API
- Accept optional `visualization_policy` on document enqueue flow.

### UI
- Add 3-state selector near DOCX upload.

### Observability
- Show selected policy, resolved knobs, candidate counts (before/after filters), planned type mix, and skip reasons.

## Rollout plan
1. Add schema + persistence + observability only (no behavior changes).
2. Gate behavior mapping behind feature flag.
3. Validate on fixed corpus and compare variance/quality.
4. Promote as default once stable.

