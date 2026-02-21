# Flowchart D2 Integration (Prompt flowchart1)

## Scope
- Added a dedicated D2-based rendering path for dense process diagrams.
- Triggered only when `template_type` is one of:
  - `flowchart`
  - `timeline`
  - `process_map`
- Existing infographic templates (`hub`, `versus`, `steps`, `bento`) remain unchanged.

## Code Changes
- Added `src/image-gen/strategies/d2-diagram.strategy.ts`
  - Generates D2 script from LLM (OpenRouter) with deterministic fallback.
  - Injects branding (palette + typography) into the D2 script.
  - Executes D2 CLI with:
    - `--layout=dagre`
    - `--theme=200`
  - Renders `diagram.svg` and screenshots a review HTML into `poster.png`.
  - Saves artifacts:
    - `diagram.d2`
    - `diagram.svg`
    - `index.html`
    - `blueprint.json`
    - `poster.png`
- Updated `src/image-gen/image-strategy.factory.ts`
  - Routes matching infographic tasks to `D2DiagramStrategy`.
- Updated `src/image-gen/image-gen.module.ts`
  - Registered `D2DiagramStrategy` provider.
- Updated `src/image-gen/image-orchestrator.service.ts`
  - Adds `metadata.template_type = viz.type` so strategy routing is explicit.
- Updated `.env.example`
  - Added:
    - `D2_BIN=d2`
    - `D2_RENDER_TIMEOUT_MS=5000`

## Runtime Requirements
- D2 CLI must be installed and available on PATH (or configure `D2_BIN`).
- Current implementation renders to SVG with D2, then screenshots to PNG at runtime.

## Notes
- Minimum output width for D2 posters is enforced at `1400px` for readability.
- If LLM D2 translation fails, deterministic script generation is used to keep pipeline continuity.
