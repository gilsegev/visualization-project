import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as sharp from 'sharp';

type ResizeMode = 'contain' | 'fill';

interface ScreenshotHtmlOptions {
    width?: number;
    height?: number;
    resizeMode?: ResizeMode;
    scale?: number;
}

@Injectable()
export class BrowserService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BrowserService.name);
    private browser: Browser;
    private browserReady = false;

    async onModuleInit() {
        this.logger.log('Initializing BrowserService...');
        try {
            await this.ensureBrowser();
            this.browserReady = true;
        } catch (error) {
            this.browserReady = false;
            this.logger.error(`Browser init failed; rendering endpoints will fail until fixed: ${error?.message || error}`);
        }
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
        if (!this.browser) {
            throw new Error('Browser is unavailable. Install Playwright Chromium in runtime image.');
        }
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

    async screenshotHtml(htmlContent: string, baseUrl?: string, options: ScreenshotHtmlOptions = {}): Promise<Buffer> {
        // Default to 1200x1200 if not specified
        const width = options.width || 1200;
        const height = options.height || 1200;
        const requestedResizeMode = options.resizeMode || 'contain';
        const scale = Number.isFinite(options.scale) && (options.scale as number) > 0
            ? Math.max(1, Math.round(options.scale as number))
            : 1;

        // Re-use standard getNewPage
        // Note: getNewPage currently hardcodes 1200x1200 in newContext, but we override it immediately with setViewportSize.
        const { context, page } = await this.getNewPage();

        try {
            console.log(`[FORENSIC] Browser Viewport set to ${width}x${height}`);

            // Set Viewport
            await page.setViewportSize({ width, height });

            if (baseUrl) {
                // Determine strict file path for Base URL
                const fileUrl = 'file://' + baseUrl.replace(/\\/g, '/').replace(/\/?$/, '/');
                console.log(`[BROWSER] Setting Base URL: ${fileUrl}`);

                // Write HTML to a temporary file in the base directory to ensure relative paths work and security context is correct
                const fs = require('fs');
                const path = require('path');
                const tempFilePath = path.join(baseUrl, `temp_preview_${Date.now()}.html`);

                try {
                    fs.writeFileSync(tempFilePath, htmlContent);
                    const tempFileUrl = 'file://' + tempFilePath.replace(/\\/g, '/');
                    console.log(`[BROWSER] Navigating to temporary file: ${tempFileUrl}`);

                    await page.goto(tempFileUrl, { waitUntil: 'load' });
                } catch (e) {
                    this.logger.error(`[BROWSER] Failed to use temp file for navigation: ${e.message}`);
                    await page.setContent(htmlContent, { waitUntil: 'load' });
                }
            } else {
                await page.setContent(htmlContent, { waitUntil: 'load' });
            }

            // Force Scroll Behavior to Auto
            await page.evaluate(() => {
                document.documentElement.style.scrollBehavior = 'auto';
                document.body.style.scrollBehavior = 'auto';
                window.scrollTo(0, 0);
            });

            // Enforce Asset Loading
            if (htmlContent.includes('assets/')) {
                try {
                    console.log('[BROWSER] Waiting for local assets to load...');
                    // Generic wait for any image with src containing 'assets/'
                    await page.waitForSelector('img[src*="assets/"]', { state: 'visible', timeout: 5000 });
                } catch (e) {
                    // It's possible there are no images or they loaded instantly
                    this.logger.warn(`[BROWSER] Timeout waiting for assets (non-critical if none present): ${e.message}`);
                }
            }

            // Safety Buffer
            await page.waitForTimeout(500);

            // Capture full canvas bounds first, then downscale.
            const canvasBounds = await page.evaluate(() => {
                // Avoid clipping content that overflows fixed canvases/templates.
                const canvas = document.getElementById('canvas') as HTMLElement | null;
                if (canvas) canvas.style.overflow = 'visible';
                if (document.body) document.body.style.overflow = 'visible';

                const baseNode = canvas || document.body || document.documentElement;
                const baseRect = baseNode.getBoundingClientRect();

                let minX = baseRect.left + window.scrollX;
                let minY = baseRect.top + window.scrollY;
                let maxX = baseRect.right + window.scrollX;
                let maxY = baseRect.bottom + window.scrollY;

                const nodes = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
                for (const el of nodes) {
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

                    const rect = el.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) continue;

                    const left = rect.left + window.scrollX;
                    const top = rect.top + window.scrollY;
                    const right = rect.right + window.scrollX;
                    const bottom = rect.bottom + window.scrollY;

                    minX = Math.min(minX, left);
                    minY = Math.min(minY, top);
                    maxX = Math.max(maxX, right);
                    maxY = Math.max(maxY, bottom);
                }

                const x = Math.max(0, Math.floor(minX));
                const y = Math.max(0, Math.floor(minY));
                const width = Math.max(1, Math.ceil(maxX - minX));
                const height = Math.max(1, Math.ceil(maxY - minY));

                return { x, y, width, height };
            });

            const renderWidth = canvasBounds.width;
            const renderHeight = canvasBounds.height;

            console.log(`[RENDER] Setting Viewport for Canonical Render: ${renderWidth}x${renderHeight}`);
            await page.setViewportSize({
                width: Math.max(Math.ceil(canvasBounds.x + renderWidth), width),
                height: Math.max(Math.ceil(canvasBounds.y + renderHeight), height)
            });

            const screenshotBuffer = await page.screenshot({
                type: 'png',
                clip: {
                    x: canvasBounds.x,
                    y: canvasBounds.y,
                    width: Math.round(renderWidth),
                    height: Math.round(renderHeight)
                },
                omitBackground: true
            });

            const targetWidth = options.width || renderWidth;
            const targetHeight = options.height || renderHeight;
            const finalWidth = targetWidth * scale;
            const finalHeight = targetHeight * scale;

            // Resize when dimensions differ or a high-DPI scale export is requested
            if ((targetWidth !== renderWidth || targetHeight !== renderHeight) || scale > 1) {
                const sourceAspect = renderWidth / renderHeight;
                const targetAspect = targetWidth / targetHeight;
                const aspectDelta = Math.abs(sourceAspect - targetAspect) / Math.max(targetAspect, 0.0001);
                const resolvedResizeMode: ResizeMode = aspectDelta > 0.2 ? 'contain' : requestedResizeMode;

                console.log(`[SHARP] Resizing from ${renderWidth}x${renderHeight} to ${finalWidth}x${finalHeight} using mode=${resolvedResizeMode} scale=${scale}`);
                const fit = resolvedResizeMode === 'fill' ? 'fill' : 'contain';
                return await sharp(screenshotBuffer)
                    .resize(finalWidth, finalHeight, {
                        fit,
                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                    })
                    .png()
                    .toBuffer();
            }

            console.log(`[FORENSIC] Screenshot captured at ${renderWidth}x${renderHeight} (Full Fidelity).`);
            return screenshotBuffer;
        } finally {
            await context.close();
        }
    }
}
