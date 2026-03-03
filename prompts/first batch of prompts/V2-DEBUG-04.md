Goal: Force all spoke elements to be visible, correctly layered, and safely contained within the viewport.

1. Force Visibility (Strategy CSS):

    Update the styleTag.textContent injection in HtmlInfographicStrategy.ts.

    Action: Add an even more aggressive visibility reset:
    CSS

    .spoke-container, .spoke-container *, [id^="slot_"] {
        visibility: visible !important;
        opacity: 1 !important;
        display: block !important; /* Force out of any hidden states */
    }
    #main-wrapper {
        background-color: #FAF9F6 !important; /* Ensure background doesn't hide spokes */
        overflow: visible !important; /* Allow spokes to breathe during math check */
    }

2. Spoke "Safe Zone" Math (Strategy TS):

    In the spoke loop, reduce the radius further to 30% to ensure large text cards don't hit the screen edges.

    Action: Ensure the clone.classList.remove('hidden', 'opacity-0', 'invisible') is called immediately after cloning the master spoke.

3. Background Layering (Strategy TS):

    Find the logic that injects the bgDiv (the abstract background texture).

    Action: Explicitly set the background div to z-index: -1 !important;. This prevents it from "swallowing" the spokes if it was accidentally placed in the same stacking context.

4. High-Res Snapshot Verification:

    The agent must check the Dimensions of the generated PNG. If it isn't exactly 1200×1200 pixels, the math will always be skewed.

5. Final Hub Test:

    Re-run test-wellness-hub.ts.

    Requirement: The agent must provide the HTML snippet of one generated spoke from debug_last_run.html to prove the left/top styles are present and the hidden classes are gone.