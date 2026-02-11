Goal: Force the Hub into a strict coordinate system by removing flexbox interference and locking the transform origins.

1. Template Structural "De-Flexing" (HTML):

    Open hub_radial.html.

    Locate the div with class absolute inset-0 flex items-center justify-center.

    Action: Remove the flex, items-center, and justify-center classes. It must simply be class="absolute inset-0". This allows absolute positioning to work.

    Action: Add z-index: 10; to this container.

2. Center Anchor Lockdown (HTML/CSS):

    Locate #hub-center.

    Action: Ensure it has these specific inline styles or CSS rules: position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100;. This ensures it is the "Top Layer" and mathematically centered.

3. Spoke Injection Refactor (TS):

    In HtmlInfographicStrategy.ts, update the hub_radial injection loop:

        Math Origin: Use const angle = (index / total) * 2 * Math.PI - (Math.PI / 2); (the - Math.PI / 2 starts the first spoke at 12 o'clock).

        Direct Injection: Use clone.style.position = 'absolute';, clone.style.left = \${x}%`;, clone.style.top = `${y}%`;`.

        Centering: You MUST add clone.style.transform = 'translate(-50%, -50%)'; to every spoke clone so the center of the card is at the coordinate, not the top-left corner.

4. Viewport Discipline:

    Add a console.log in the BrowserService or strategy to confirm the screenshot is being taken at exactly 1200x1200px. Any other aspect ratio will "oval" the hub.

🔍 Verification Checklist for the Agent

    [ ] Does debug_last_run.html show position: absolute on the spoke containers?

    [ ] Is the "NBA" or placeholder text 100% gone from the center?

    [ ] Are there exactly 3-8 spokes visible in the debug file