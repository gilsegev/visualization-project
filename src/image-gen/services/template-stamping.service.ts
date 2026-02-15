
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TemplateStampingService {
    private readonly logger = new Logger(TemplateStampingService.name);

    /**
     * Loads an HTML template and stamps it with the provided data.
     * @param templateId The ID of the template (e.g., 'hub_radial')
     * @param data The data to inject into the template
     * @returns The stamped HTML string
     */
    public stamp(templateId: string, data: any): string {
        // Updated directory to point to "html templates"
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates', 'html templates');

        let fileName = `${templateId}.html`;

        // Mappings for specific IDs to filenames if they differ
        if (templateId === 'hub_radial' || templateId === 'hub') {
            fileName = 'Hub.html';
        } else if (templateId === 'versus_split' || templateId === 'versus') {
            fileName = 'versus.html';
        } else if (templateId === 'steps' || templateId === 'step_list') {
            fileName = 'steps.html';
        }

        const filePath = path.join(templatesDir, fileName);
        this.logger.log(`Resolved template path: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            this.logger.error(`Template not found: ${filePath}`);
            throw new Error(`Template not found: ${templateId}`);
        }

        const templateContent = fs.readFileSync(filePath, 'utf-8');

        // The placeholder specific to our templates
        const placeholder = '/* INSERT_JSON_HERE */ null';
        // Data Mapping: blueprint.center_topic -> template.center
        if (data && data.center_topic) {
            data.center = data.center_topic;
        }

        const replacement = JSON.stringify(data, null, 2);

        if (!templateContent.includes(placeholder)) {
            this.logger.warn(`Template '${templateId}' does not contain the expected placeholder for data injection.`);
        }

        if (data.radius) {
            // Inject config override before the end of body
            const overrideScript = `<script>if(typeof CONFIG !== 'undefined') { CONFIG.radius = ${data.radius}; }</script></body>`;
            return templateContent.replace(placeholder, () => replacement).replace('</body>', overrideScript);
        }

        return templateContent.replace(placeholder, () => replacement);
    }
}
