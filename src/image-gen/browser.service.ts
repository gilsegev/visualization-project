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

    async screenshotHtml(htmlContent: string): Promise<Buffer> {
        // V2-RESET-01: "Clip-Only" Capture - Forces (0,0) Origin
        // Re-use standard getNewPage which now defaults to 1200x1200px
        const { context, page } = await this.getNewPage();
        try {
            console.log(`[FORENSIC] Browser Viewport Locked to 1200x1200 (V2-RESET-01)`);

            // V2-DEBUG-20: Double-Tap Viewport Lock
            await page.setViewportSize({ width: 1200, height: 1200 });

            await page.setContent(htmlContent);

            // V2-DEBUG-20: Force Scroll Behavior to Auto (No smooth scroll interference)
            await page.evaluate(() => {
                document.documentElement.style.scrollBehavior = 'auto';
                document.body.style.scrollBehavior = 'auto';
                window.scrollTo(0, 0);
            });

            // Wait for network idle with timeout to prevent hangs
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
                this.logger.warn('Network idle timeout, proceeding with screenshot');
            });

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
