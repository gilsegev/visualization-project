# Observability Dashboard Render Fix (2026-02-18)

## Issue
The observability page loaded raw template bindings (e.g. `{{ selectedTask... }}`) and did not hydrate.

## Root Cause
`public/dashboard/index.html` included TypeScript-only syntax inside browser JavaScript:
- `reduce((sum, t: any) => ...)`

This caused a runtime parse error, preventing Vue from mounting.

## Fix
Replaced invalid browser syntax with valid JavaScript:
- `reduce((sum, t) => ...)`

Patched lines in:
- `public/dashboard/index.html`

## Verification
- Page script validation via headless Playwright check returned `NO_PAGE_ERRORS`.
- UI now renders evaluated bindings instead of raw `{{ ... }}` placeholders.
