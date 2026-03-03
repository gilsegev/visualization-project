Goal: Implement an exhaustive, multi-stage logging and state-capture system to pinpoint exactly where layout "shifting" occurs.

1. Phase-Based Terminal Logging:
Use console.log with the [FORENSIC] prefix for these six distinct stages in HtmlInfographicStrategy.ts:

    Stage 1 (LLM Output): Log the raw JSON string received from OpenRouter before parsing.

    Stage 2 (DOM Initial): Log the total number of [id^="slot_"] elements found in the template before any injection.

    Stage 3 (Asset State): Log the length of the itemImages array. Specifically log: [FORENSIC] Image Index 0 exists: ${!!itemImages[0]}.

    Stage 4 (Math & Injection): For every item in the loop, log:

        [FORENSIC] Item Index: ${i}

        [FORENSIC] Calculated: Left: ${x}%, Top: ${y}%

        [FORENSIC] Applied Transform: ${clone.style.transform}

    Stage 5 (CSS Audit): Log the entire string being injected into the styleTag.textContent.

    Stage 6 (Final Serialization): Log the first 500 characters and the last 500 characters of the finalHtml string.

2. The "State Dump" Debug File:
Instead of just the HTML, the debug_last_run.html must now include a Metadata Header:

    At the very top of the finalHtml, inject a hidden <script id="forensic-metadata"> tag containing the full blueprint JSON.

    This allows us to open the debug file and verify if the data in the DOM matches what the LLM intended.

3. Browser Environment Capture:
In BrowserService.ts, log the following during the screenshotHtml call:

    [FORENSIC] Browser Viewport Set To: ${width}x${height}

    [FORENSIC] Page Content Loaded: ${page.url()}

    [FORENSIC] Evaluation: document.body.offsetWidth (This reveals if the browser is "squishing" the 1200px frame).

4. Execution & Reporting:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide the Full Terminal Log from [FORENSIC] Stage 1 to Stage 6.