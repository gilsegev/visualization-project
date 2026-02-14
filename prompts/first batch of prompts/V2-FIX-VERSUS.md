Goal: Refactor the versus_split infographic to use a Shared Axis Row model. This ensures that comparison points are perfectly aligned horizontally and centered vertically.

1. Template Overhaul (versus_split.html):

    Structure: Replace the independent subject-left and subject-right containers with a single #stat-rows-container centered inside the #main-wrapper.

    The Magnet Anchor: Apply the "Hub Success" logic to this container:
    CSS

    #item-wrapper {
        position: absolute;
        top: 50%;
        left: 0;
        width: 1200px;
        transform: translateY(-50%); /* This pins the middle of the text block to the middle of the image */
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    The Stat Row Grid: Define a .stat-row that uses a 3-column grid: [Value-Left] [Category-Label] [Value-Right].

        Columns: Set to 1fr 180px 1fr.

        Alignment: Use align-items: center to ensure that if one side has more text, the label and the other side stay vertically aligned.

2. TypeScript Logic Update (HtmlInfographicStrategy.ts):

    Injection Loop: Update the versus_split loop to iterate through the comparison items.

    Data Routing: * Populate the Left slot with Subject A's value.

        Populate the Center slot with the Category Label.

        Populate the Right slot with Subject B's value.

    Vertical Growth: Because the parent #item-wrapper is anchored at 50% with a -50% transform, adding more rows will now naturally push the top rows up and the bottom rows down, keeping the entire block centered.

3. Visual Polish:

    Ensure the Subject Titles (e.g., "SpaceX" and "Blue Origin") remain at the top of their respective halves, but ensure they do not overlap with the dynamic stat rows if many items are added.

4. Verification:

    Run test-v2-diversity.ts.

    Success Criteria: 1. Text appears on both the left and right sides.
    2. The Category Label is perfectly centered between them.
    3. The entire block of text is centered vertically on the 1200px canvas.