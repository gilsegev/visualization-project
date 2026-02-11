Goal: Utilize the new minimalist Hub template to verify the mathematical alignment engine and data mapping.

1. Template Deployment:

    Replace the content of hub_radial.html with the provided "Rigid Engineering" HTML.

    Verify: Ensure the .spoke-template is outside the #item-wrapper to avoid cloning issues.

2. Strategy Refactor (TS):

    Update HtmlInfographicStrategy.ts to target this new structure.

    Cloning: const masterSpoke = document.querySelector('.spoke-template .spoke-container');

    Math Origin: Ensure the loop uses a 35% radius and applies transform: translate(-50%, -50%) as an inline style to every clone.

    Data Mapping: Directly populate #slot_title_center and then loop through blueprint.items for the spokes.

3. Forensic Logging:

    Log the total number of spokes being appended: [FORENSIC] Appending ${blueprint.items.length} spokes to DOM.

    Log the final debug_last_run.html save path.

4. Verification Test:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide the SVG/HTML coordinate map from the console logs to prove the left/top values are being calculated correctly.