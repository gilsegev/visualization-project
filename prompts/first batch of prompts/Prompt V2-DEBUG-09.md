Goal: Restore the image assets and layout integrity for the Step-Stone and Versus templates by synchronizing IDs and enforcing high-contrast wellness styling.

1. Step-Stone ID Sync (HTML/TS):

    HTML Audit: Open step_stone.html. Ensure the "Zig-Zag" rows use #slot_img, #slot_title, and #slot_txt.

    Asset Mapping: In HtmlInfographicStrategy.ts, verify the step_stone loop correctly assigns itemImages[index] to the src of #slot_img.

    Background Force: Inject CSS to ensure .step-row containers have the solid #FAF9F6 background to match the Hub.

2. Versus Split Contrast Fix (HTML/TS):

    HTML Audit: Open versus_split.html. Ensure the left/right subjects use #slot_title_left, #slot_title_right, #slot_image_left, and #slot_image_right.

    Text Visibility: Force high-contrast deep charcoal (#1a202c) on all Versus text elements.

    Background Fix: Ensure the backgroundImage is injected with opacity: 0.2 and z-index: -1 so it doesn't wash out the text.

3. "Wellness Book" Global CSS Pass:

    Update the styleTag injection to ensure all templates inherit the solid cream background and dark text:
    CSS

    .glass-card, .step-row, .versus-container {
        background: #FAF9F6 !important;
        color: #1a202c !important;
        border: 1px solid rgba(0,0,0,0.1) !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important;
    }

4. The "Diversity" Verification:

    Re-run scripts/test-v2-diversity.ts.

    Validation Requirements:

        [ ] Step-Stone: Does every "stone" have a unique watercolor image?

        [ ] Versus: Is the text on the left/right sides clearly legible?

        [ ] Debug Logs: Do the logs confirm [FORENSIC] Mapping Versus Left: [Subject]?