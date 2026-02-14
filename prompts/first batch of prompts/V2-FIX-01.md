Goal: Bypass the viewport-based screenshot and capture the #main-wrapper element directly as a physical object to eliminate all "Phantom Padding."

1. Switch to Element-Level Screenshot (BrowserService.ts):

    Locate the screenshot logic in BrowserService.ts.

    Action: Instead of page.screenshot(), use locator().screenshot().
    TypeScript

    // Find the wrapper explicitly
    const wrapper = page.locator('#main-wrapper');
    // Capture ONLY the wrapper, ignoring the body/html/viewport defaults
    await wrapper.screenshot({ 
        path: '...', 
        omitBackground: true,
        animations: 'disabled'
    });

2. Force Overflow Containment (Strategy CSS):

    In HtmlInfographicStrategy.ts, update the styleTag injection:
    CSS

    #main-wrapper {
        width: 1200px !important;
        height: 1200px !important;
        position: relative !important;
        overflow: hidden !important; /* Ensure nothing leaks out to trigger scrollbars */
        background-color: var(--bg-page) !important;
    }

3. Cleanup Diagnostic Junk:

    Action: Remove the Red/Blue/Green outlines and the "Red Dot" from the strategy. We no longer need them to find the shift; we are now fixing the capture method.

4. Verification:

    Run test-wellness-hub.ts.

    Success Criteria: The resulting PNG should be exactly 1200×1200px with the Hub center perfectly anchored, regardless of how the browser normally "offsets" the body.