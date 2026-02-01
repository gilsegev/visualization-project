
import { DataVizStrategy } from '../src/image-gen/strategies/data-viz.strategy';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { BrowserService } from '../src/image-gen/browser.service';
import { ImageTask } from '../src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';

async function generateCharts() {
    const logger = new Logger('ChartGeneratorScript');
    logger.log('Initializing Services...');

    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    await browserService.onModuleInit(); // Ensure browser is launched

    // @ts-ignore
    const strategy = new DataVizStrategy(localStorage, browserService);

    // Manually trigger onModuleInit or similar if it existed, but here we might need to be careful about 
    // lifecycle methods. DataVizStrategy implements OnModuleDestroy but not Init, 
    // however it does lazy loading of browser in ensureBrowser.

    const tasks: ImageTask[] = [
        {
            id: 'test-pie-1',
            type: 'data_viz',
            refined_prompt: 'Market Share Distribution 2023',
            payload: {
                chartType: 'pie',
                data: [
                    { label: 'Company A', value: 40 },
                    { label: 'Company B', value: 30 },
                    { label: 'Company C', value: 20 },
                    { label: 'Others', value: 10 }
                ]
            }
        },
        {
            id: 'test-bar-1',
            type: 'data_viz',
            refined_prompt: 'Quarterly Sales Performance',
            payload: {
                chartType: 'bar',
                data: [
                    { label: 'Q1', value: 120000 },
                    { label: 'Q2', value: 145000 },
                    { label: 'Q3', value: 110000 },
                    { label: 'Q4', value: 180000 }
                ]
            }
        },
        {
            id: 'test-line-1',
            type: 'data_viz',
            refined_prompt: 'User Growth 2020-2024',
            payload: {
                chartType: 'line', // VChart uses "line" usually, let's assume it maps correctly or commonSpec handles it. 
                // The commonSpec logic checks for 'pie', otherwise defaults to axes. 
                // We need to ensuring 'line' works in the template logic or adds line-specifics.
                // Looking at existing code: 
                // chartType: '${payload.chartType || 'bar'}'
                // If I pass 'line', it sets type: 'line'. 
                // VChart spec 'line' type usually works with xField/yField same as bar.
                // So this should work.
                data: [
                    { label: '2020', value: 5000 },
                    { label: '2021', value: 12000 },
                    { label: '2022', value: 25000 },
                    { label: '2023', value: 45000 },
                    { label: '2024', value: 80000 }
                ]
            }
        }
    ];

    try {
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            logger.log(`Generating chart for task ${task.id}...`);
            const url = await strategy.generate(task, i);
            logger.log(`Chart generated: ${url}`);
        }
    } catch (error) {
        logger.error('Error generating charts:', error);
    } finally {
        await browserService.onModuleDestroy();
    }
}

generateCharts();
