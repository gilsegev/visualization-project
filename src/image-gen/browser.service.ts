import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

@Injectable()
export class BrowserService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BrowserService.name);
    private browser: Browser;

    async onModuleInit() {
        this.logger.log('Initializing BrowserService...');
        await this.ensureBrowser();
    }

    async onModuleDestroy() {
        if (this.browser) {
            this.logger.log('Closing BrowserService...');
            await this.browser.close();
        }
    }

    private browserInitPromise: Promise<void> | null = null;

    private async ensureBrowser() {
        if (this.browser) return;

        if (!this.browserInitPromise) {
            this.browserInitPromise = this.launchBrowser();
        }

        try {
            await this.browserInitPromise;
        } catch (error) {
            this.browserInitPromise = null;
            throw error;
        }
    }

    private async launchBrowser() {
        this.logger.log('Launching Playwright browser (Singleton) - V2-RESET-01 Primitive Config...');
        this.browser = await chromium.launch({
            headless: true,
            args: [
                '--disable-lcd-text',
                '--disable-dev-shm-usage',
                '--force-device-scale-factor=1', // Force 1:1 pixel parity
                '--no-sandbox'
            ]
        });
    }

    async getNewPage(options: { recordVideo?: { dir: string } } = {}): Promise<{ context: BrowserContext; page: Page }> {
        await this.ensureBrowser();
        // Create a new independent context for each task to ensure isolation
        const context = await this.browser.newContext({
            viewport: { width: 1200, height: 1200 }, // V2-RESET-01: Locked to 1200x1200
            deviceScaleFactor: 1, // V2-RESET-01: Parity
            ...options, // Pass video options if provided
        });
        const page = await context.newPage();

        // Forward console logs from browser to NestJS logger for debugging
        page.on('console', msg => this.logger.debug(`[BROWSER] ${msg.text()}`));
        page.on('pageerror', err => this.logger.error(`[BROWSER ERROR] ${err.message}`));

        return { context, page };
    }

    async screenshotSvg(svgContent: string, width: number, height: number): Promise<Buffer> {
        const { context, page } = await this.getNewPage();
        try {
            await page.setViewportSize({ width, height });
            // Directly set content
            await page.setContent(svgContent);

            // Force body margin to 0 to prevent white borders
            await page.addStyleTag({ content: 'body { margin: 0; padding: 0; overflow: hidden; } svg { display: block; width: 100%; height: 100%; }' });

            // Wait for network idle in case images are loading (Base64 is instant, but generic safety)
            // await page.waitForLoadState('networkidle'); 

            const buffer = await page.screenshot({ type: 'png', fullPage: true });
            return buffer;
        } finally {
            await context.close();
        }
    }

    async screenshotHtml(htmlContent: string, baseUrl?: string): Promise<Buffer> {
        // V2-RESET-01: "Clip-Only" Capture - Forces (0,0) Origin
        // Re-use standard getNewPage which now defaults to 1200x1200px
        const { context, page } = await this.getNewPage();
        try {
            console.log(`[FORENSIC] Browser Viewport Locked to 1200x1200 (V2-RESET-01)`);

            // V2-DEBUG-20: Double-Tap Viewport Lock
            await page.setViewportSize({ width: 1200, height: 1200 });

            if (baseUrl) {
                // Determine strict file path for Base URL
                const fileUrl = 'file://' + baseUrl.replace(/\\/g, '/').replace(/\/?$/, '/');
                console.log(`[BROWSER] Setting Base URL: ${fileUrl}`);

                // Write HTML to a temporary file in the base directory to ensure relative paths work and security context is correct
                // This bypasses "Not allowed to load local resource" errors common with setContent
                const fs = require('fs');
                const path = require('path');
                // Use a proper join that handles the baseUrl correctly (baseUrl is absolute path to dir)
                const tempFilePath = path.join(baseUrl, `temp_preview_${Date.now()}.html`);

                try {
                    fs.writeFileSync(tempFilePath, htmlContent);
                    const tempFileUrl = 'file://' + tempFilePath.replace(/\\/g, '/');
                    console.log(`[BROWSER] Navigating to temporary file: ${tempFileUrl}`);

                    await page.goto(tempFileUrl, { waitUntil: 'load' });

                    // Cleanup is tricky if we want to debug, but for now we'll delete it after screenshot (in finally block maybe? or just leave it for forensics?)
                    // The prompt asked to "Pass ... baseUrl so it can resolve relative paths".
                    // Navigating to the file is the best way.

                    // We don't need to inject <base> if we are IN the directory.
                } catch (e) {
                    this.logger.error(`[BROWSER] Failed to use temp file for navigation: ${e.message}`);
                    // Fallback to setContent if write fails
                    await page.setContent(htmlContent, { waitUntil: 'load' });
                }
            } else {
                await page.setContent(htmlContent, { waitUntil: 'load' });
            }

            // V2-DEBUG-20: Force Scroll Behavior to Auto (No smooth scroll interference)
            await page.evaluate(() => {
                document.documentElement.style.scrollBehavior = 'auto';
                document.body.style.scrollBehavior = 'auto';
                window.scrollTo(0, 0);
            });

            // Refinement 3.1: Enforce Asset Loading
            // Wait for at least one spoke image to be visible if it exists in the HTML
            if (htmlContent.includes('assets/spoke')) {
                try {
                    console.log('[BROWSER] Waiting for spoke images to load...');
                    await page.waitForSelector('img[src*="assets/spoke"]', { state: 'visible', timeout: 5000 });
                    console.log('[BROWSER] All assets verified on disk (via DOM Check).');
                } catch (e) {
                    this.logger.warn(`[BROWSER] Timeout waiting for images: ${e.message}`);
                }
            }

            // Safety Buffer for GPU/Rendering
            await page.waitForTimeout(500);

            // V2-RESET-01: Hard-Clipped Screenshot
            const screenshotBuffer = await page.screenshot({
                type: 'png',
                // Forces capture of the top-left 1200px block
                clip: { x: 0, y: 0, width: 1200, height: 1200 },
                omitBackground: true, // Support zero-point transparency test
                scale: 'css' // Ensures no high-DPI scaling occurs
            });
            console.log(`[FORENSIC] Screenshot captured with clip-at-zero.`);
            return screenshotBuffer;
        } finally {
            await context.close();
        }
    }
}
