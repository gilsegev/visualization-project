Goal: Visually and mathematically prove the location of the layout root and force the screenshot to align with it.

1. The "Outline" Visual Test (Strategy TS):
In HtmlInfographicStrategy.ts, inject these high-visibility outlines. This is the only way to see which container is "shifting":
CSS

html { outline: 10px solid red !important; outline-offset: -10px; }
body { outline: 10px solid blue !important; outline-offset: -20px; }
#main-wrapper { outline: 10px solid green !important; outline-offset: -30px; }

    Finding Requirement: In the resulting image, if you see a White/Transparent gap between the edge of the PNG and the Red/Blue/Green lines, we have confirmed the browser is padding the viewport.

2. The "Metrics Dump" (BrowserService.ts):
Before the screenshot, log this exact object to the console:
TypeScript

const metrics = await page.evaluate(() => {
  const wrapper = document.getElementById("main-wrapper");
  const rect = wrapper.getBoundingClientRect();
  return {
    wrapper_top: rect.top,
    wrapper_left: rect.left,
    window_scroll: { x: window.scrollX, y: window.scrollY },
    body_style: window.getComputedStyle(document.body).display,
    viewport: { w: window.innerWidth, h: window.innerHeight }
  };
});
console.log('[FORENSIC] Metrics Dump:', JSON.stringify(metrics));

3. The "Boring Browser" Lockdown:

    Action: Ensure the HtmlInfographicStrategy.ts has REMOVED position: absolute from html and body. They must be position: static !important;.

    Action: Add await page.evaluate(() => window.scrollTo(0,0)); immediately before the screenshot.

4. Execution:

    Run test-wellness-hub.ts.

    Requirement: The agent must provide the Metrics Dump string and the image.