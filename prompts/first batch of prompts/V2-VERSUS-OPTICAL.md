Goal: Deploy the "Balanced Axis" template and implement dynamic string truncation for long values.

1. Template Update:

    Replace versus_split.html with the provided code using the 54% optical anchor and clamp() font-scaling.

2. Logical Safety (HtmlInfographicStrategy.ts):

    Font Scaling Check: If a slot_title string exceeds 20 characters, the agent should programmatically set its style to font-size: 3.5rem to prevent line-breaks from pushing the entire container off-screen.

    Value Truncation: For .val-text slots, if the comparison text exceeds 120 characters, append an ellipsis (...) to maintain the vertical alignment grid.

3. Execution:

    Run test-v2-diversity.ts.

    Requirement: The image must show visible background imagery and titles that are centered between the top edge and the VS badge.