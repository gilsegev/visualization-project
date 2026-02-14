Goal: Run three controlled experiments to identify coordinate distortion and transform overwriting.

1. The Red Dot (Center Calibration):

    In HtmlInfographicStrategy.ts, immediately after the spoke loop, inject a 10×10px red circular div at top: 50%; left: 50%.

    Forensic Log: [FORENSIC] Center Calibration Dot Injected.

2. The Transform Consolidation:

    Search the code and the hub_radial.html for any instance of transform.

    Action: Ensure the only transform applied to .spoke-container is done in the TypeScript loop as a single string: element.style.transform = "translate(-50%, -50%)";.

3. Viewport Dump:

    In BrowserService.ts, right before the screenshot, add:
    const dimensions = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, bodyW: document.body.offsetWidth }));
    console.log('[FORENSIC] Actual Render Dimensions: ', dimensions);

4. Execution:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide the screenshot and the Actual Render Dimensions log.