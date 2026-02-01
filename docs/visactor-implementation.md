# VisActor Chart Generation Implementation

This document describes the implementation of the chart generation feature using existing VisActor (VChart) libraries and Playwright.

## Overview

The chart generation system uses a headless browser (Playwright) to render charts using the VChart library and captures screenshots of the rendered charts. This approach allows for high-quality, client-side equivalent rendering on the server side.

## Components

### 1. DataVizStrategy (`src/image-gen/strategies/data-viz.strategy.ts`)

The core logic resides in `DataVizStrategy`. It implements the `ImageGeneratorStrategy` interface.

-   **Headless Browser**: Uses `playwright` to launch a headless Chromium instance.
-   **Singleton Pattern**: Implements a robust singleton pattern for the browser instance to ensure efficient resource usage and prevent race conditions during concurrent requests.
    -   `browserInitPromise` creates a lock ensuring only one browser launch sequence occurs.
-   **HTML Template**: Injects an HTML template into the page that loads VChart from a CDN (`unpkg.com`).
-   **Rendering**:
    -   Constructs a VChart spec based on the task payload (supports `pie`, `bar`, and `line` charts).
    -   Renders the chart into a container.
    -   Waits for the canvas to be ready.
-   **Capture**: Takes a screenshot of the `#chart-container` element.

### 2. LocalStorageService (`src/image-gen/local-storage.service.ts`)

Handles the storage of generated images.

-   **Directory**: Saves images to `public/generated-images`.
-   **Return**: Returns the relative URL path for the saved image.
-   **Cleanup**: (Future improvement) A cron job or lifecycle hook could be added to clean up old images.

### 3. ImageOrchestratorService (`src/image-gen/image-orchestrator.service.ts`)

Orchestrates the generation process.

-   **Concurrency**: Uses `p-limit` (set to 10) to manage concurrent task execution, preventing server overload while maximizing throughput.

## Usage

The system accepts `ImageTask` objects with type `data_viz`.

**Payload Structure:**

```typescript
{
  chartType: 'pie' | 'bar' | 'line',
  data: [
    { label: string, value: number },
    // ...
  ]
}
```

## generated-images Directory

generated images are stored in `public/generated-images`. This directory is gitignored to preventing binary bloat in the repository.
