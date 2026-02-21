import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Theme } from '../themes.config';

@Injectable()
export class TemplateStampingService {
    private readonly logger = new Logger(TemplateStampingService.name);

    /**
     * Loads an HTML template and stamps it with the provided data.
     * @param templateId The ID of the template (e.g., 'hub_radial')
     * @param data The data to inject into the template
     * @param theme Optional theme to apply
     * @returns The stamped HTML string
     */
    public stamp(templateId: string, data: any, theme?: Theme): string {
        // Updated directory to point to "html templates"
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates', 'html templates');

        let fileName = `${templateId}.html`;

        // Mappings for specific IDs to filenames if they differ
        if (templateId === 'hub_radial' || templateId === 'hub') {
            fileName = 'Hub.html';
        } else if (templateId === 'versus_split' || templateId === 'versus') {
            fileName = 'versus.html';
        } else if (templateId === 'steps' || templateId === 'step_list' || templateId === 'step_journey') {
            const itemCount = Array.isArray(data?.items) ? data.items.length : 0;
            fileName = itemCount > 5 ? 'multi-step.html' : 'steps.html';
            this.logger.log(`Step template routing: items=${itemCount} -> ${fileName}`);
        } else if (templateId === 'story_frame') {
            fileName = 'story_frame.html';
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

        let stampedHtml = templateContent.replace(placeholder, () => replacement);

        // --- THEME INJECTION ---
        if (theme) {
            this.logger.log(`Injecting theme: ${theme.font_name}`);
            const fontImport = /^https?:\/\//i.test(theme.font_family)
                ? `@import url('${theme.font_family}');`
                : '';
            const themeCss = `
	<style id="injected-theme">
		${fontImport}
		:root {
			--bg-primary: ${theme.background_main.startsWith('#') ? `radial-gradient(circle at center, ${theme.background_main} 0%, ${theme.background_main} 100%)` : theme.background_main};
			--accent-primary: ${theme.primary_accent};
			--accent-secondary: ${theme.secondary_accent || theme.primary_accent};
			--text-primary: ${theme.text_main};
			--text-secondary: ${theme.text_secondary || theme.text_main};
			--font-main: '${theme.font_name}', sans-serif;
            --font: '${theme.font_name}', sans-serif;
			--font-size-heading: ${theme.font_size_heading || '2rem'};
			--font-size-body: ${theme.font_size_body || '1rem'};
			--glass-bg: ${theme.glass_color || 'rgba(255, 255, 255, 0.85)'};
            --bg: var(--bg-primary);
            --text: var(--text-primary);
            --muted: var(--text-secondary);
            --accent: var(--accent-primary);
            --border: var(--text-primary);
            --winner-bg: color-mix(in srgb, var(--accent-primary) 15%, white);
		}
	</style>
`;
            stampedHtml = stampedHtml.replace('</head>', `${themeCss}</head>`);
        }

        if (data.radius) {
            // Inject config override before the end of body
            const overrideScript = `<script>if(typeof CONFIG !== 'undefined') { CONFIG.radius = ${data.radius}; }</script>`;
            stampedHtml = stampedHtml.replace('</body>', `${overrideScript}</body>`);
        }

        return stampedHtml;
    }
}
