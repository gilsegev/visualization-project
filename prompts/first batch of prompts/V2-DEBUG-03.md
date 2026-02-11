Goal: Force the system to use the new template and ensure the Hub center is visually dominant.

1. Forced File Refresh (FileSystem):

    The agent must delete the dist folder and the contents of public/generated-images/ before the next run.

    Action: Manually verify that public/assets/infographics/templates/hub_radial.html has no flex classes in the main container before starting the server.

2. The "Overlord" CSS Block (Strategy):

    In HtmlInfographicStrategy.ts, inject this Ultra-Priority CSS block into the styleTag.textContent:
    CSS

    /* FORCE CLEARANCE */
    #main-wrapper, .absolute.inset-0 { 
        display: block !important; 
        flex: none !important; 
        position: relative !important;
        width: 1200px !important;
        height: 1200px !important;
    }

    /* SPOKE PRECISION */
    .spoke-container {
        position: absolute !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 320px !important; /* Fixed width to prevent collapsing */
        z-index: 20 !important;
    }

    /* CENTER VISIBILITY */
    #hub-center {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        width: 400px !important;
        height: 400px !important;
        background: #FAF9F6 !important;
        border: 6px solid var(--theme-accent) !important;
        z-index: 1000 !important; /* Ensure it is on top of everything */
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 50% !important;
    }

3. Direct DOM Math Verification (TS):

    Add a console.log inside the spoke loop: [FORENSIC] Final Style for Spoke ${index}: left=${x}%, top=${y}%.

    Verification: In the debug_last_run.html, open it and check if the style attribute on the spoke matches the console log.

4. The "Single Source" Run:

    Run only the test-wellness-hub.ts.

    Validation:

        [ ] Does the terminal show [FORENSIC] HTML AUTOPSY SAVED?

        [ ] Is the center_topic text visible in the center of the hub?

        [ ] Are the spokes radiating from a 34% radius?