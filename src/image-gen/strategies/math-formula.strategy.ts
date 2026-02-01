import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { BrowserService } from '../browser.service';

@Injectable()
export class MathFormulaStrategy extends BaseImageStrategy {
    constructor(
        private readonly localStorage: LocalStorageService,
        private readonly browserService: BrowserService
    ) {
        super();
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        this.logger.log(`Generating math formula for: ${task.refined_prompt}`);
        const payload = task.payload as any;
        const latex = payload.latex || task.refined_prompt; // Fallback if latex is in prompt

        const { page } = await this.browserService.getNewPage();

        try {
            // Load local MathJax
            const mathJaxPath = path.resolve(process.cwd(), 'public/assets/mathjax.js');
            // Check if file exists, if not fall back to CDN (safety net)
            let scriptContent = '';
            if (fs.existsSync(mathJaxPath)) {
                scriptContent = fs.readFileSync(mathJaxPath, 'utf8');
            } else {
                this.logger.warn('Local MathJax not found, using CDN fallback');
                // We'll rely on script tag injection for CDN if local fails, but since we downloaded it...
                // Let's simplified: just read it. If it fails, error out.
                throw new Error('MathJax asset not found at public/assets/mathjax.js');
            }

            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body, html { 
                            margin: 0; padding: 0; width: 100%; height: 100%; 
                            display: flex; justify-content: center; align-items: center;
                            background: #ffffff; 
                        }
                        #math-container { 
                            font-size: 4em; /* Large, clear text */
                            color: #000000;
                            padding: 40px;
                        }
                    </style>
                    <script>
                        window.MathJax = {
                            tex: { inlineMath: [['$', '$'], ['\\(', '\\)']] },
                            svg: { fontCache: 'global' },
                            startup: {
                                pageReady: () => {
                                    return MathJax.startup.defaultPageReady().then(() => {
                                        window.mathJaxReady = true;
                                    });
                                }
                            }
                        };
                    </script>
                    <script>${scriptContent}</script>
                </head>
                <body>
                    <div id="math-container">
                        $$ ${latex} $$
                    </div>
                </body>
                </html>
            `;

            await page.setContent(htmlContent, { waitUntil: 'networkidle' });

            // Wait for MathJax to signal readiness
            await page.waitForFunction('window.mathJaxReady === true', { timeout: 10000 });

            // Extra safety buffer for rendering
            await page.waitForTimeout(200);

            const buffer = await page.screenshot({ clip: { x: 0, y: 0, width: 1024, height: 1024 } });

            const fileName = `task-${index ?? 'unknown'}-math.png`;
            const url = await this.localStorage.upload(buffer, fileName);
            return { url };

        } finally {
            await page.close();
            await page.context().close();
        }
    }
}
