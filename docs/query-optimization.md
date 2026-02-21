# Query Optimization (SearchBroker)

## What was implemented

- Added `QueryOptimizer` class at `src/image-gen/services/query-optimizer.ts`.
- Integrated it into `SourcedImageStrategy`:
  - Brief -> LLM keyword expansion (`openai/gpt-4o-mini`) with a strict prompt for visual stock-photo language.
  - Fallback -> existing heuristic query expansion.
  - Global quality token injection on every query:
    - `high-quality, curated, minimalist, non-corporate, professional photography`

## Unsplash parameter updates

- `orientation: landscape`
- `order_by: relevant`
- `content_filter: high`
- `per_page: 10`
- candidate cap increased to 10

## Observability updates

- Added explicit log for expanded queries:
  - `Expanded queries: ...`
- Extended query config log to include:
  - `order_by`

## Performance guardrail

- LLM query expansion now runs with a fast timeout budget (`1900ms`) and falls back automatically to heuristic expansion.

