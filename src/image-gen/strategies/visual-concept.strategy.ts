import { Injectable } from '@nestjs/common';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from '../local-storage.service';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as pLimit from 'p-limit';

@Injectable()
export class VisualConceptStrategy extends BaseImageStrategy {
    // Static axios instance with persistent agent
    private static readonly axiosInstance: AxiosInstance = axios.create({
        httpsAgent: new https.Agent({ keepAlive: true }),
        timeout: 45000, // 45s strict timeout
    });

    // Strategy-specific concurrency limit
    private readonly imageLimit = pLimit(8);

    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
    ) {
        super();
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<string> {
        // Wrap generation in concurrency limit
        return this.imageLimit(async () => {
            this.logger.log(`Generating visual concept for prompt: ${task.refined_prompt}`);

            const siliconFlowKey = this.configService.get<string>('SILICONFLOW_API_KEY');
            if (!siliconFlowKey) {
                throw new Error('SILICONFLOW_API_KEY is not defined in environment variables.');
            }

            let attempts = 0;
            const maxAttempts = 2; // Prompt: "single retry attempt" -> 2 attempts total

            while (attempts < maxAttempts) {
                try {
                    attempts++;
                    const response = await VisualConceptStrategy.axiosInstance.post(
                        'https://api.siliconflow.com/v1/images/generations',
                        {
                            model: 'black-forest-labs/FLUX.2-pro',
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

                    const imageUrl = response.data.data?.[0]?.url;
                    if (!imageUrl) {
                        throw new Error('No image URL returned from SiliconFlow API');
                    }

                    this.logger.log(`Image generated at: ${imageUrl}. Downloading to local storage (stream)...`);

                    const imageResponse = await VisualConceptStrategy.axiosInstance.get(imageUrl, {
                        responseType: 'stream',
                        timeout: 30000, // Keep 30s for download
                    });

                    const fileName = `task-${index ?? 'unknown'}-visual_concept.png`;
                    const localUrl = await this.localStorage.uploadStream(imageResponse.data, fileName);

                    return localUrl;

                } catch (error) {
                    if (attempts >= maxAttempts) {
                        this.logger.error(`Failed to generate visual concept after ${maxAttempts} attempts: ${error.message}`, error.response?.data);
                        throw error;
                    }
                    this.logger.warn(`[VisualConceptStrategy] Socket error detected. Retrying task ${task.id} (Attempt ${attempts + 1})...`);
                    // Wait before retrying (backoff: 1s, 2s, 3s...)
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }
        });
    }
}
