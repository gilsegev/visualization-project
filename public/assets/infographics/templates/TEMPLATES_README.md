# Infographic Template Standard (Visual Systems Designer)

This directory contains SVG templates for the Infographic Engine. All templates must adhere to the **Visual Systems Designer Standard** to ensure dynamic injection works correctly.

## File Registry
Update `templates.json` when adding new files:
```json
{
    "narrative_key": {
        "file": "filename.svg",
        "name": "Human Readable Name",
        "maxSlots": 4
    }
}
```

## SVG Structure Requirements
Templates must use standard CSS classes and IDs for dynamic text replacement and icon injection.

### Slots (IDs)
For each step `n` (1-indexed):
- `id="title_n"`: The main heading for the step.
- `id="desc_n"`: The sub-detail text.
- `id="icon_n"`: (Optional) A grouping element (`<g>` or `<circle>`) where an icon will be injected.

### Semantic Classes
Use these classes for consistent styling (future CSS injection):
- `.step`: Grouping for a single logical step.
- `.step-title`: Text element for the title.
- `.step-detail`: Text element for the description.
- `.connector`: Lines or paths connecting steps.

## Capacity
Always define `maxSlots` in the registry. The engine *will* truncate content that exceeds this limit.
