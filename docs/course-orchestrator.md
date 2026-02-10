# Course Orchestrator & Batch Visualization

This feature enables the generation of multiple infographics for a full course or lesson in a single batch job, ensuring visual consistency across all generated images.

## Features

- **High-Density Art Directive**: The Architect defines a 30-40 word "global style anchor" covering lighting, texture, and composition, which is prepended to every image prompt for deep visual harmony.
- **Intelligent Template Mapping**: The Architect maps each visualization to the most appropriate template (e.g., `step_stone` for cycles, `bento_grid` for collections) based on content analysis.
- **Contrast Safety**: Ensures that theme colors selected by the Architect maintain high legibility (text vs background).
- **Concurrent Processing**: Parallelizes image generation using `p-limit` (concurrency 2) to optimize performance while respecting API rate limits.
- **Resilient Generation**: Implements exponential backoff for Gemini API calls to handle `429 Resource Exhausted` errors during high-concurrency jobs.
- **Organized Storage**: Automatically creates course-specific subdirectories (e.g., `public/generated-images/courses/{course_id}/`) to group related images.

## API Endpoint

### `POST /v1/course-visualizations`

Accepts a course job definition and triggers the orchestration process.

**Request Body (`CourseJob`):**
```json
{
  "course_id": "string",
  "course_metadata": {
    "title": "string",
    "global_style_guide": {
      "philosophy": "string",
      "image_style": "string",
      "palette": ["#HEX"]
    }
  },
  "visualizations": [
    {
      "id": "string",
      "title": "string",
      "description": "string"
    }
  ]
}
```

**Response (`BatchResult`):**
```json
{
  "course_id": "string",
  "global_style_anchor": "string",
  "images": [
    {
      "visualization_id": "string",
      "url": "string"
    }
  ]
}
```

## Testing

A test script is available at `scripts/test-full-course-run.ts`. It loads a sample visualization set and triggers the orchestrator.

```bash
npx ts-node scripts/test-full-course-run.ts
```
