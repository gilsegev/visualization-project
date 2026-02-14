Goal: Eliminate resolution incompatibility by forcing 1:1 pixel parity between the code and the browser.

1. Browser Service Lockdown (TS):

    In BrowserService.ts, locate the screenshotHtml or the hub's specific page generation path.

    Action: Update the setViewport call to be explicit:
    await page.setViewport({ width: 1200, height: 1200, deviceScaleFactor: 1 });.

2. Strategy CSS "Anti-Zoom" (TS):

    Update the styleTag.textContent injection in HtmlInfographicStrategy.ts:
    CSS

    html, body {
        width: 1200px !important;
        height: 1200px !important;
        margin: 0 !important;
        padding: 0 !important;
        zoom: 1 !important;
        -moz-transform: scale(1);
        -moz-transform-origin: 0 0;
    }
    #main-wrapper {
        width: 1200px !important;
        height: 1200px !important;
        position: relative !important;
        overflow: hidden !important;
    }

3. Forensic "Red Dot" Confirmation:

    Keep the Red Dot at 600px, 600px. If the dot is not at the exact pixel-center of the final PNG, the browser is still scaling the image.

4. Verification:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide the physical dimensions of the generated PNG file (e.g., right-click properties or identify command). It MUST be exactly 1200×1200.