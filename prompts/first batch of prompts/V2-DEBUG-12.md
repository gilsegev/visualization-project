Goal: Eliminate CSS variable scoping issues by moving all radial math into the inline styles of the spoke containers.

1. Strategy Logic Pivot (TS):

    In HtmlInfographicStrategy.ts, locate the hub_radial injection loop.

    Action: Instead of setting --total on the parent, set it on every individual spoke clone.

    The Inline Style "Kill Shot":
    TypeScript

    const total = blueprint.items.length;
    // Set variables directly on the clone for absolute local scope
    clone.style.setProperty('--i', index.toString());
    clone.style.setProperty('--total', total.toString());
    // Re-enforce the center anchor
    clone.style.position = 'absolute';
    clone.style.top = '50%';
    clone.style.left = '50%';

2. Template Variable Reset (HTML):

    Open hub_radial.html.

    Action: Remove --total from the :root or any other CSS block.

    Action: Ensure the .spoke-container CSS only uses var(--i) and var(--total) within its transform property.

3. Cleanup & Calibration:

    Action: Remove the "Red Dot" experiment code from the strategy.

    Action: Keep the "Consolidated Transform" string from Experiment 2 to ensure we don't overwrite the centering logic.

4. Verification:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide an HTML snippet of one spoke from the debug_last_run.html showing style="--i: 1; --total: 6; ...".