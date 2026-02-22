# Changelog

## [V2-QUERY-OPT-4] - 2026-02-22

### Changed
- **Domain Hardening**: Added primary-domain inference and high-collision noun protection (`tackle`, `cell`, `strike`, `lead`) so Pixabay queries stay domain-locked.
- **Tiered Pixabay Waterfall**: Added 3-tier fallback retrieval (`domain+subject+setting` -> `domain+subject` -> `domain+subject+literal`) with CLIP + vision acceptance per tier.
- **Smart Vision Thresholds**: Vision gate threshold is now dynamic by CLIP confidence (`>0.90 => 40`, `<0.70 => 75`, otherwise `60`).
- **Negative Sports Classifier**: Vision gate now hard-rejects sports/rugby scenes for fishing-domain tasks (forces vision score `0`).
- **Observability**: Added tier retry logs and threshold-aware vision logs for easier diagnosis of query collisions.

### Verified
- `npm run build` passes.

## [V2-QUERY-OPT-3] - 2026-02-22

### Changed
- **Isolated CLIP Scoring**: Phase 3/6 now scores each candidate image against the specific expanded query that produced it (not the original task brief).
- **CLIP Text Normalization**: Added strict normalization before CLIP scoring (lowercase + punctuation removal + whitespace collapse).
- **Query Plan Subject Enforcement**: Query optimizer now guarantees non-empty `subject`; falls back to the most frequent noun in lesson title when LLM omits subject.

### Verified
- `npm run build` passes.

## [V2-QUERY-OPT-2] - 2026-02-22

### Changed
- **Minimalist Search Broker**: Switched LLM query expansion to a compact extractor that targets a dominant object + aesthetic tag.
  - New LLM output contract includes `core_noun`, `aesthetic_tag`, and short 2-3 word query variants.
  - Added provider-aware quality injection toggle so Pixabay runs compact keyword queries.

- **Pixabay Query Strategy**: Tightened Pixabay query shaping for higher precision.
  - Simplified generated variants to short noun-led terms.
  - Enforced short keyword phrasing through normalization for Pixabay calls.

- **CLIP Guard + Retry Loop**: Added an adaptive retry when retrieval quality drops.
  - CLIP now scores top-5 candidates and logs summary stats (`avg`, `max`, `min`).
  - If `CLIP avg < 0.6` on Pixabay, pipeline retries with a noun-only query and keeps the better top score.
  - Ranking remains max-CLIP winner selection from candidate pool.

### Verified
- `npm run build` passes.
- Manual `/generate/source-debug` call returns scored results after changes.

## [V2-VERSUS-PREMIUM] - 2026-02-13

### Added
- **Premium Glassmorphism Template**: Integrated the new `versus_split.html` featuring high-fidelity glass-card rows, glowing spine, and dynamic background images.

### Changed
- **Strategy Injection Refactor**: Updated `HtmlInfographicStrategy.ts` to support `backgroundImage` injection and the new complex stat row structure.


## [V2-VERSUS-ALIGNMENT] - 2026-02-13

### Fixed
- **Unified Title Scaling**: Implemented logic to share the same font size between both titles for visual balance.
- **Strict Grid Centering**: Refined the `versus_split` grid and padding to ensure categories are perfectly centered on the spine.
- **Alignment Offset**: Removed asymmetric padding that caused the right title and categories to be offset.


## [V2-VERSUS-SCALING] - 2026-02-13

### Changed
- **Dynamic Title Scaling**: Replaced static character threshold with a sliding scale (`Math.max(3.0, Math.min(5.0, 5.0 * (12 / length)))rem`) to ensure titles fit on one line.
- **Template Reversion**: Reverted the optical anchor to **50% center** for standard alignment.
- **Content Integrity**: Removed automatic truncation of comparison values.

## [V2-FIX-VERSUS] - 2026-02-13

### Changed
- **Shared Axis Row Refactor**: Refactored the `versus_split` infographic to a unified row-based model.
  - Replaced independent subject containers with a centralized `#stat_rows_container`.
  - Implemented 3-column grid alignment (`1fr 180px 1fr`) for perfectly aligned comparison points.
  - Applied "Magnet Anchor" logic (`top: 50%`, `transform: translateY(-50%)`) for deterministic vertical centering.
  - Improved responsive typography and high-contrast label pills.
  - Added stylistic "VS" backdrop and pinned subject titles to the top.

### Technical Details
- **Files Modified**:
  - `public/assets/infographics/templates/versus_split.html`: Complete structure rewrite.
  - `src/image-gen/strategies/html-infographic.strategy.ts`: Updated injection logic and injected styles.
  - `test-versus-split.ts`: Updated with "AI vs Human Intuition" test case.


## [V2-DEBUG-23] - 2026-02-13

### Fixed
- **Versus Template Data Mapping**: Fixed issue where the right side of the Versus template remained empty.
  - Updated `HtmlInfographicStrategy.ts` to correctly split comparison data using the `|` character.
  - Refined LLM system prompt to enforce `Val A | Val B` format with exactly 4-5 items.
  - Correctly populated `stat_list_left` and `stat_list_right` in the DOM.

- **Vertical Centering (Middle-Out)**: Implemented "Middle-Out" vertical alignment for Versus subjects.
  - Enforced `top: 40%` and `translateY(-50%)` via style injection for `.subject-container`.
  - Ensured content grows symmetrically from the horizontal axis.

### Changed
- **Versus Template Realignment**: Replaced `versus_split.html` with the improved version from `_versus_split.html`.
- **Styling Consistency**: Injected high-contrast styles for `stat-label` background and accessibility.

### Added
- **Versus Split Test Script**: Created `test-versus-split.ts` for targeted verification of Versus templates.


## [Unreleased] - 2026-02-10

### Added
- **OpenRouter Migration**: Migrated from Google Generative AI to OpenRouter for LLM interactions
  - Installed `openai` npm package for OpenRouter API integration
  - Configured OpenRouter with `google/gemini-2.0-flash-001` model
  - Updated `.env` with `OPENROUTER_MODEL` configuration

- **Forensic Logging System**: Implemented comprehensive `[FORENSIC]` logging
  - Strategy input logging at start of generation
  - LLM blueprint result logging after OpenRouter response
  - SiliconFlow image prompt logging before image generation
  - HTML autopsy path logging when saving debug files

- **HTML Autopsy Export**: Debug functionality for HTML inspection
  - Saves final HTML to `public/generated-images/debug_last_run.html` before screenshot
  - Ensures parent directory creation for reliability
  - Enables inspection of generated HTML content for debugging

### Changed
- **HtmlInfographicStrategy Refactor**: Complete overhaul of AI integration
  - Replaced `GoogleGenerativeAI` with `OpenAI` SDK configured for OpenRouter
  - Updated base URL to `https://openrouter.ai/api/v1`
  - Added required headers: `HTTP-Referer` and `X-Title`
  - Refactored `generateBlueprint()` to use `openai.chat.completions.create()`
  - Enhanced system prompt to explicitly request JSON-only output

### Technical Details
- **Files Modified**:
  - `src/image-gen/strategies/html-infographic.strategy.ts` - Complete strategy refactor
  - `.env` - Added OpenRouter model configuration
  - `package.json` - Added `openai` dependency

- **Verification**: All changes verified with `test-themed-generation.ts` script
  - Exit code: 0 (Success)
  - All forensic logs confirmed active
  - HTML autopsy file creation confirmed
  - Image generation working without rate limit errors
