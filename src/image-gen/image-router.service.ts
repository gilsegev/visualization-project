import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { ImageTask, ImageTaskSchema } from './image-task.schema';
import { z } from 'zod';

@Injectable()
export class ImageRouterService {
    private readonly logger = new Logger(ImageRouterService.name);
    private model: GenerativeModel;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            this.logger.warn('GEMINI_API_KEY not found in environment variables');
        }
        const genAI = new GoogleGenerativeAI(apiKey || '');
        this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }

    async classify(content: string): Promise<ImageTask[]> {
        this.logger.log(`Classifying content: "${content}"`);
        const prompt = `
      You are an AI that classifies user intent into image generation tasks.
      Analyze the following user request and break it down into a list of specific image tasks.
      
      The available task types are:
      - 'visual_concept': For general images, stock photos, concepts.
      - 'data_viz': For charts, graphs, data visualization. Payload must include 'chartType' (e.g., 'bar', 'line', 'pie') and 'data'.
      - 'math_formula': For equations, mathematical expressions. Payload must include 'latex'.
      - 'beautify_slide': For design layouts or slide improvements.

      User Request: "${content}"

      Output STRICT JSON ONLY. The output must be an array of objects matching this schema:
      Array<{
        type: "visual_concept" | "data_viz" | "math_formula" | "beautify_slide",
        id: string (UUID v4),
        refined_prompt: string (optimized prompt for an image generator),
        payload: object (specific structure for data_viz or math_formula, or empty object for others)
      }>

      Example for "Show sales chart":
      [
        {
          "type": "data_viz",
          "id": "uuid...",
          "refined_prompt": "Bar chart showing sales data",
          "payload": { "chartType": "bar", "data": [...] }
        }
      ]
    `;
        try {
            const result = await this.model.generateContent(prompt);
            const responseText = result.response.text();

            // Clean up markdown code blocks if present
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

            this.logger.debug(`Raw LLM Response: ${cleanedText}`);

            const parsed = JSON.parse(cleanedText);

            // Validate with Zod
            const validated = z.array(ImageTaskSchema).parse(parsed);

            return validated;
        } catch (error) {
            this.logger.error('Failed to classify or parse image tasks', error);
            throw new InternalServerErrorException('Failed to process image tasks');
        }
    }
}
