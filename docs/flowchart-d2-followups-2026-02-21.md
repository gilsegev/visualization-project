# Flowchart D2 Follow-ups (2026-02-21)

## Included fixes
- Strengthened flowchart routing so dense process flows route to D2 path reliably.
- Added D2 CLI failover in `D2DiagramStrategy`:
  - If `d2` binary is missing (`ENOENT`), generate a styled fallback SVG instead of failing the task.
- Updated fallback flowchart styling:
  - Wrapped, centered header text to prevent side truncation.
  - Dynamic box width based on text length.
  - Rounded dashed borders and tinted backgrounds.
  - Sketch-like font stack (with `Patrick Hand` import) to better match D2 example style.
- Fixed fallback SVG rendering defects:
  - Corrected dynamic canvas height usage in background rect.
  - Corrected `font-family` serialization so browser applies the intended font stack.

## Data-viz stability fix
- Updated `DataVizStrategy` to load VChart runtime with fallback order:
  1. `public/assets/vchart.js`
  2. `node_modules/@visactor/vchart/build/index.min.js`
  3. `node_modules/@visactor/vchart/build/index.js`
- This removes hard dependency on `public/assets/vchart.js` and prevents `ENOENT` failures for chart tasks.

