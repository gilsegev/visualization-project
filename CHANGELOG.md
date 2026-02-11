# Changelog

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
