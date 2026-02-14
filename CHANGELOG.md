# Changelog

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
