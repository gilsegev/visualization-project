Goal: Force Playwright into a rigid, non-emulated 1200×1200px state with zero browser chrome interference.

    1. The "Primitive" Playwright Config (BrowserService.ts):
    Replace your launch and viewport logic with this ultra-stable configuration:
    TypeScript

    const browser = await playwright.chromium.launch({
      headless: true,
      args: [
        '--disable-lcd-text', 
        '--disable-dev-shm-usage',
        '--force-device-scale-factor=1', // Force 1:1 pixel parity
        '--no-sandbox'
      ]
    });

    const context = await browser.newContext({
    viewport: { width: 1200, height: 1200 },
    deviceScaleFactor: 1
    });

    const page = await context.newPage();


    **2. The "Clip-Only" Capture (BrowserService.ts)**:
    Abandon element-level locators temporarily. Use a hard-clipped screenshot that forces $(0,0)$ as the only valid origin:

    TypeScript

    await page.screenshot({
      path: '...',
      clip: { x: 0, y: 0, width: 1200, height: 1200 }, // Forces capture of the top-left 1200px block
      omitBackground: true,
      scale: 'css' // Ensures no high-DPI scaling occurs
    });

    3. The "Anti-Elastic" CSS (Strategy TS):
    Inject this into the styleTag to ensure the html element itself is the exact size of the capture:
    CSS

    :root, html, body {
      width: 1200px !important;
      height: 1200px !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: none !important;
    }

    4. Verification Run:

        Run test-wellness-hub.ts.

        Requirement: The agent must confirm the Terminal Log shows [FORENSIC] Viewport locked to 1200x1200px with clip-at-zero.