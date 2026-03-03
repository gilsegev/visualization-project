Goal: Standardize the spoke dimensions and lock the transform origin to ensure mathematical precision.

1. Forced Spoke Geometry (Strategy CSS):

    Update the styleTag.textContent injection in HtmlInfographicStrategy.ts.

    Action: Force every spoke to have a rigid size so the math is predictable:
    CSS

    .spoke-container {
        width: 340px !important; 
        height: auto !important;
        max-height: 450px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        text-align: center !important;
        transform: translate(-50%, -50%) !important; /* THE CRITICAL FIX */
        z-index: 50 !important;
    }
    .spoke-container img {
        width: 120px !important;
        height: 120px !important;
        object-fit: contain !important;
        margin-bottom: 1rem !important;
    }

2. Circular "Clock" Math (Strategy TS):

    Re-verify the math in the spoke loop.

    Action: Ensure the starting angle is exactly -90 degrees (-π/2) so the first item is at the absolute top.

    Action: Increase radius back to 35%. With the translate(-50%, -50%) fix, this is the "Golden Ratio" for a 1200px canvas.

3. Clean the DOM (Strategy TS):

    Before appending cloned spokes, the agent must verify the #item-wrapper (or the container) is completely empty.

    Action: container.innerHTML = ''; must be called to prevent "Ghost spokes" from previous test runs.

4. High-Fidelity Validation:

    The agent must run test-wellness-hub.ts and provide the computed style of the first spoke from the debug_last_run.html (specifically the left, top, and transform values).