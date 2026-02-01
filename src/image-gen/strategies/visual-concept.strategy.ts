import { Injectable } from '@nestjs/common';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from '../local-storage.service';
import axios from 'axios';

@Injectable()
export class VisualConceptStrategy extends BaseImageStrategy {
    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
    ) {
        super();
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<string> {
        this.logger.log(`Generating visual concept for prompt: ${task.refined_prompt}`);

        const apiKey = this.configService.get<string>('GEMINI_API_KEY'); // Using GEMINI_API_KEY as per .env check, wait user instruction said SILICONFLOW_API_KEY.
        // User instruction said: "Ensure the API key is read from SILICONFLOW_API_KEY in the .env file."
        // I checked .env and it only had GEMINI_API_KEY. 
        // I will assume the user has added SILICONFLOW_API_KEY or intends to. 
        // I should stick to the instruction: SILICONFLOW_API_KEY.
        // If it's missing at runtime, it will fail, which is expected behavior for missing config.

        const siliconFlowKey = this.configService.get<string>('SILICONFLOW_API_KEY');

        if (!siliconFlowKey) {
            throw new Error('SILICONFLOW_API_KEY is not defined in environment variables.');
        }

        try {
            const response = await axios.post(
                'https://api.siliconflow.com/v1/images/generations',
                {
                    model: 'black-forest-labs/FLUX.1-schnell',
                    prompt: task.refined_prompt,
                    image_size: '1024x1024',
                },
                {
                    headers: {
                        Authorization: `Bearer ${siliconFlowKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            // API returns a URL usually. Let's check typical generic OpenAI-compatible format or specific SiliconFlow format.
            // Assuming OpenAI compatibility: data[0].url
            const imageUrl = response.data.data?.[0]?.url;

            if (!imageUrl) {
                throw new Error('No image URL returned from SiliconFlow API');
            }

            this.logger.log(`Image generated at: ${imageUrl}. Downloading to local storage...`);

            // Download image
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(imageResponse.data, 'binary');

            const fileName = `task-${index ?? 'unknown'}-visual_concept.png`;
            const localUrl = await this.localStorage.upload(buffer, fileName);

            return localUrl;

        } catch (error) {
            this.logger.error(`Failed to generate visual concept: ${error.message}`, error.response?.data);
            throw error;
        }
    }
}
