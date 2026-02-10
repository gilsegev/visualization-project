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
        this.logger.log('Launching Playwright browser (Singleton)...');
        this.browser = await chromium.launch({ headless: true });
    }

    async getNewPage(options: { recordVideo?: { dir: string } } = {}): Promise<{ context: BrowserContext; page: Page }> {
        await this.ensureBrowser();
        // Create a new independent context for each task to ensure isolation
        const context = await this.browser.newContext({
            viewport: { width: 1200, height: 1200 },
            deviceScaleFactor: 3,
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
        // Reuse getNewPage with high DPI setting for Retina quality as requested
        const { context, page } = await this.getNewPage({ deviceScaleFactor: 3.0 } as any);
        try {
            // Set viewport to 1200x1200 as requested
            await page.setViewportSize({ width: 1200, height: 1200 });

            // [DEBUG: RENDER] - Prompt 47
            this.logger.debug(`[DEBUG: RENDER] Viewport=1200x1200, Scale=3.0`);

            await page.setContent(htmlContent);

            // Wait for network idle to ensure any external resources (fonts, etc) load. 
            // Although templates use CDN tailwind/fonts, so network required.
            await page.waitForLoadState('networkidle');

            // Screenshot. "Focus on .hub-container or .list-container"
            // We can try to locate specific container or just full page.
            // Prompt says: "Focus the screenshot on the .hub-container or .list-container specifically"

            // Try step_list container first (it's .max-w-3xl usually, see template)
            // Or hub_radial container (.relative w-[900px]...)
            // Let's try locating a generic container wrapper if present, or fallback to body/fullPage.
            // Based on templates:
            // Hub: body > div.relative.w-[900px]
            // Step: body > div.max-w-3xl

            let element = await page.$('.relative.w-\\[900px\\]'); // Hub
            if (!element) {
                element = await page.$('.max-w-3xl'); // Step list
            }

            if (element) {
                return await element.screenshot({ type: 'png' });
            } else {
                // Fallback to full page if container not found
                return await page.screenshot({ type: 'png', fullPage: true });
            }
        } finally {
            await context.close();
        }
    }
}
