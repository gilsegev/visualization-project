import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ImageTask, ImageTaskSchema } from './image-task.schema';
import { z } from 'zod';

@Injectable()
export class ImageRouterService {
  private readonly logger = new Logger(ImageRouterService.name);
  private openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const baseURL = 'https://openrouter.ai/api/v1';

    if (apiKey) {
      this.openai = new OpenAI({
        baseURL,
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://visualization-project.com',
          'X-Title': 'Visualization Project',
        }
      });
    } else {
      this.logger.warn('OPENROUTER_API_KEY not found in environment variables');
    }
  }

  async classify(content: string): Promise<ImageTask[]> {
    this.logger.log(`Classifying content: "${content}"`);
    const systemMessage = `
      You are an AI that classifies user intent into image generation tasks.
      Analyze the following user request and break it down into a list of specific image tasks.
      
      The available task types are:
      - 'visual_concept': For general images, stock photos, concepts.
      - 'data_viz': For charts, graphs, data visualization. Payload must include 'chartType' (strictly one of: 'bar', 'line', 'pie', 'funnel'), 'data', and optionally 'format' ('static' or 'animated'). If the request implies motion/video, set format to 'animated'.
      - 'math_formula': For equations, mathematical expressions. Payload must include 'latex'.
      - 'beautify_slide': For design layouts or slide improvements.
      - 'infographic': For visual explanations, timelines, processes, or structured narratives.
    `;

    const userMessage = `
      User Request: "${content}"

      Output STRICT JSON ONLY. The output must be an array of objects matching this schema:
      Array<{
        type: "visual_concept" | "data_viz" | "math_formula" | "beautify_slide" | "infographic",
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
          "payload": { "chartType": "bar", "data": [...], "format": "static" }
        }
      ]
    `;

    try {
      if (!this.openai) {
        throw new Error('OpenRouter API Key not configured');
      }

      const completion = await this.openai.chat.completions.create({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' }
      });

      const responseText = completion.choices[0].message.content;
      this.logger.debug(`Raw LLM Response: ${responseText}`);

      const parsed = JSON.parse(responseText);

      // Validate with Zod
      const validated = z.array(ImageTaskSchema).parse(parsed);

      return validated;
    } catch (error) {
      this.logger.error('Failed to classify or parse image tasks', error);
      throw new InternalServerErrorException('Failed to process image tasks');
    }
  }
}
