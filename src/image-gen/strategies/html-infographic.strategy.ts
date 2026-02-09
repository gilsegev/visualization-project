import { Injectable, Logger } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

@Injectable()
export class HtmlInfographicStrategy extends BaseImageStrategy {
    // logger is inherited

    constructor() {
        super();
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        this.logger.log(`Starting HTML Infographic Generation for: ${task.refined_prompt}`);

        // Example: logic to select template based on prompt would go here
        // For now, we demonstrate loading the 'hub_radial' template
        const templateId = 'hub_radial';

        try {
            const templateContent = this.loadTemplate(templateId);
            this.logger.log(`Template '${templateId}' loaded successfully. Length: ${templateContent.length}`);

            // Demonstration of jsdom manipulation (requirement)
            const dom = new JSDOM(templateContent);
            const document = dom.window.document;
            const title = document.querySelector('h1');
            if (title) {
                this.logger.log(`Original Title: ${title.textContent}`);
                // Example manipulation: Update title based on prompt (mock)
                // title.textContent = "GENERATED TITLE"; 
            }

            // In a real implementation, we would now:
            // 1. Generate content via LLM
            // 2. Inject content into DOM
            // 3. Render DOM to image (using Puppeteer/Playwright/BrowserService)

            return {
                url: 'placeholder_url_until_rendering_is_implemented',
                posterUrl: 'placeholder_poster_url',
                payload: { templateId, notes: 'Template loaded and parsed successfully' }
            };

        } catch (error) {
            this.logger.error(`Error in HtmlInfographicStrategy: ${error.message}`);
            throw error;
        }
    }

    public loadTemplate(id: string): string {
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates');
        // Simple mapping or file lookup. 
        // Assuming file name matches ID for now, or use a map.
        // We have hub_radial.html and step_list.html
        let filename = `${id}.html`;

        const filePath = path.join(templatesDir, filename);

        this.logger.log(`Attempting to load template from: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Template file not found: ${filePath}`);
        }

        return fs.readFileSync(filePath, 'utf-8');
    }
}
