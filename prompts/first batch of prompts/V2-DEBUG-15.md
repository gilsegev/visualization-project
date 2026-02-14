Goal: Force the main-wrapper to be perfectly flush with the top-left corner (0,0) of the PNG to eliminate the "Down and Left" shift.

1. Nuclear CSS Reset (Strategy TS):

    Update the styleTag.textContent injection in HtmlInfographicStrategy.ts.

    Action: Inject this aggressive reset block at the very top of the style string:
    CSS

    * { 
        margin: 0 !important; 
        padding: 0 !important; 
        box-sizing: border-box !important; 
    }
    html, body {
        width: 1200px !important;
        height: 1200px !important;
        overflow: hidden !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        background: transparent !important;
    }
    #main-wrapper {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 1200px !important;
        height: 1200px !important;
        transform: none !important; /* Ensure no accidental parent scaling */
    }

2. Browser Render Confirmation (TS):

    In the spoke loop, add a log for the center coordinate once more:
    [FORENSIC] Center Hub Positioned at: top: 50%, left: 50%.

3. Viewport "Clipping" Test:

    In BrowserService.ts, ensure omitBackground: true is set in the screenshot options to reveal if the "shift" is moving the content outside of the transparent 1200×1200px frame.

4. Verification:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide a physical measurement of the Red Dot's distance from the top-left corner of the PNG. It MUST be exactly 600px down and 600px right.