Goal: Collapse the competing coordinate systems into a single root and verify the bounding box of the #main-wrapper against the viewport (0,0).

1. The "Boring" CSS Reset (Strategy TS):

    Replace the existing html/body style injection in HtmlInfographicStrategy.ts with this simplified, non-absolute block:
    CSS

    /* KILL ALL POSITIONED ROOTS EXCEPT WRAPPER */
    html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 1200px !important;
        height: 1200px !important;
        overflow: hidden !important;
        display: block !important; /* Remove flex centering */
        position: static !important; /* Force back to natural flow */
    }
    #main-wrapper {
        position: relative !important; /* This is now the ONLY origin */
        width: 1200px !important;
        height: 1200px !important;
        margin: 0 !important;
        padding: 0 !important;
        top: 0 !important;
        left: 0 !important;
    }
    /* REMOVE FIXED BACKGROUNDS */
    [style*="position: fixed"] { display: none !important; }

2. The "Box Audit" (BrowserService.ts):

    Before taking the screenshot, execute this diagnostic and log the results:
    TypeScript

    const metrics = await page.evaluate(() => {
        const wrapper = document.getElementById("main-wrapper");
        const rect = wrapper.getBoundingClientRect();
        return {
            wrapperTop: rect.top,
            wrapperLeft: rect.left,
            bodyMargin: window.getComputedStyle(document.body).margin,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            viewportW: window.innerWidth,
            viewportH: window.innerHeight
        };
    });
    console.log('[FORENSIC] Bounding Box Audit:', metrics);

3. Explicit Screenshot Clipping:

    Update the page.screenshot call to force a clip starting at the absolute top-left:
    TypeScript

    await page.screenshot({
        path: '...',
        clip: { x: 0, y: 0, width: 1200, height: 1200 },
        omitBackground: true
    });

4. The "Visual Boundary" Test:

    Temporarily inject these outlines into the CSS to see which box is shifting:
    html { outline: 4px solid red !important; }
    body { outline: 4px solid blue !important; }
    #main-wrapper { outline: 4px solid green !important; }

5. Execution:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide the Bounding Box Audit logs. If wrapperTop or wrapperLeft is anything other than 0, we have found the shift.