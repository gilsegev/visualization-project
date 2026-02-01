import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { BrowserService } from '../browser.service';

@Injectable()
export class BeautifySlideStrategy extends BaseImageStrategy {
    constructor(
        private readonly localStorage: LocalStorageService,
        private readonly browserService: BrowserService
    ) {
        super();
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<string> {
        this.logger.log(`Generating slide for: ${task.refined_prompt}`);

        // Extract content from payload or prompt
        // Payload might be empty or contain title/bullets
        // We'll analyze refined_prompt if payload is empty to guess content
        const title = task.refined_prompt.split(':')[0] || 'Educational Slide';
        const content = task.refined_prompt.split(':').slice(1).join(':').trim() || task.refined_prompt;

        // Split content into bullets if it looks like a list
        const bullets = content.split('. ').map(s => s.trim()).filter(s => s.length > 0);

        const { page } = await this.browserService.getNewPage();

        try {
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
                        
                        body, html { 
                            margin: 0; padding: 0; width: 100%; height: 100%; 
                            font-family: 'Inter', sans-serif;
                            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                            display: flex; justify-content: center; align-items: center;
                        }
                        
                        .slide-container {
                            width: 900px;
                            height: 600px; /* Aspect 3:2 within 1024x1024 frame? No, task says "capture a 1024x1024 screenshot" */
                            /* Let's make the slide fill the square or be a card within it */
                            /* Prompt: "Center the formula... center the slide?" */
                            /* Let's make a beautiful square slide */
                            width: 1024px;
                            height: 1024px;
                            background: white;
                            display: flex;
                            flex-direction: column;
                            padding: 80px;
                            box-sizing: border-box;
                            position: relative;
                            overflow: hidden;
                        }

                        /* Decorative elements */
                        .accent-shape {
                            position: absolute;
                            top: 0; right: 0;
                            width: 400px; height: 400px;
                            background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
                            border-radius: 0 0 0 100%;
                            opacity: 0.1;
                            z-index: 0;
                        }
                        
                        .bottom-shape {
                            position: absolute;
                            bottom: 0; left: 0;
                            width: 300px; height: 300px;
                            background: linear-gradient(45deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%);
                            border-radius: 0 100% 0 0;
                            opacity: 0.1;
                            z-index: 0;
                        }

                        h1 {
                            font-size: 64px;
                            font-weight: 800;
                            color: #2d3748;
                            margin-bottom: 40px;
                            z-index: 1;
                            line-height: 1.2;
                            border-left: 12px solid #667eea;
                            padding-left: 30px;
                        }

                        ul {
                            list-style: none;
                            padding: 0;
                            margin: 0;
                            z-index: 1;
                        }

                        li {
                            font-size: 32px;
                            color: #4a5568;
                            margin-bottom: 24px;
                            padding-left: 40px;
                            position: relative;
                            line-height: 1.5;
                        }

                        li::before {
                            content: "•";
                            color: #667eea;
                            font-weight: bold;
                            position: absolute;
                            left: 0;
                            font-size: 1.2em;
                        }
                    </style>
                </head>
                <body>
                    <div class="slide-container">
                        <div class="accent-shape"></div>
                        <div class="bottom-shape"></div>
                        <h1>${title}</h1>
                        <ul>
                            ${bullets.map(b => `<li>${b}</li>`).join('')}
                        </ul>
                    </div>
                </body>
                </html>
            `;

            await page.setContent(htmlContent, { waitUntil: 'networkidle' });

            // Fonts might take a moment
            await page.waitForTimeout(500);

            const buffer = await page.screenshot({ clip: { x: 0, y: 0, width: 1024, height: 1024 } });

            const fileName = `task-${index ?? 'unknown'}-slide.png`;
            return await this.localStorage.upload(buffer, fileName);

        } finally {
            await page.close();
            await page.context().close();
        }
    }
}
