import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { BrowserService } from '../browser.service';

@Injectable()
export class DataVizStrategy extends BaseImageStrategy {
  constructor(
    private readonly localStorage: LocalStorageService,
    private readonly browserService: BrowserService
  ) {
    super();
  }

  protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
    const payload = task.payload as any;
    // Implementation of Prompt 9: Use 'format' from payload, or fallback to 'exportType'
    const exportType = 'exportType' in task ? task.exportType : 'static';
    const format = payload.format || exportType;
    const isAnimated = format === 'animated';

    this.logger.log(`[DEBUG] Task ${task.id}: Starting data viz (${payload.chartType}) - Mode: ${format}`);

    // Data Normalizer
    let chartData = payload.data || [];
    if (!Array.isArray(chartData) && typeof chartData === 'object') {
      if (Array.isArray(chartData.labels) && Array.isArray(chartData.values)) {
        chartData = chartData.labels.map((label: any, i: number) => ({
          label: label,
          value: chartData.values[i]
        }));
      }
    }

    if (isAnimated) {
      // Prompt 9: "Perform two captures"

      // 1. Poster (Static Screenshot of final frame)
      this.logger.log(`[DEBUG] Task ${task.id}: Generating Poster (Static)...`);
      const posterUrl = await this.captureStatic(task, payload, chartData, index);

      // 2. Video (Full Animation)
      this.logger.log(`[DEBUG] Task ${task.id}: Generating Video (Animated)...`);
      const videoUrl = await this.captureVideo(task, payload, chartData, index);

      return { url: videoUrl, posterUrl };

    } else {
      // Static Only
      // Prompt 9: "Perform a standard screenshot"
      const url = await this.captureStatic(task, payload, chartData, index);
      return { url };
    }
  }

  private getHtmlContent(task: ImageTask, payload: any, chartData: any[], isAnimated: boolean): string {
    const vChartLibPath = path.resolve(process.cwd(), 'public/assets/vchart.js');
    const vChartLib = fs.readFileSync(vChartLibPath, 'utf8');

    // Construct the HTML with VChart spec
    // Reusing the robust spec logic from Prompt 8
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <script>${vChartLib}</script>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0f172a; }
          #chart-container { width: 1024px; height: 1024px; font-family: 'Inter', sans-serif; }
        </style>
      </head>
      <body>
        <div id="chart-container"></div>
        <script>
    const isAnimated = ${isAnimated};
    const commonSpec = {
      type: '${payload.chartType || 'bar'}',
      data: {
        values: ${JSON.stringify(chartData)}
      },
      background: '#0f172a',
      color: [
        '#00f5ff', '#b400ff', '#ff0055', '#f5d90a', '#39ff14'
      ],
      title: {
        visible: true,
        text: '${task.refined_prompt.replace(/'/g, "\\'")}',
        textStyle: { 
            fontSize: 32, 
            fontWeight: 'bold', 
            fill: '#e2e8f0', 
            fontFamily: 'Inter, sans-serif'
        },
        padding: { bottom: 20 }
      },
      legends: { 
        visible: true, 
        orient: 'bottom',
        item: {
            label: {
                style: {
                    fill: '#94a3b8', 
                    fontSize: 14
                }
            }
        }
      },
      // Animation Logic
      animation: isAnimated,
      animationAppear: {
        duration: 1500,
        easing: 'cubicOut',
        oneByOne: true
      },
      
      // Axes - Empty default, will be populated for cartesian
      axes: []
    };

    let spec = {};
    const type = '${payload.chartType}';
    
    if (type === 'pie' || type === 'donut') {
       spec = {
          ...commonSpec,
          categoryField: 'label',
          valueField: 'value',
          outerRadius: 0.8,
          innerRadius: type === 'donut' ? 0.5 : 0,
          label: {
              visible: true,
              style: {
                  fill: '#e2e8f0'
              }
          },
          axes: [] // GUARD: No axes for pie
       };
    } else if (type === 'funnel') {
       spec = {
          ...commonSpec,
          categoryField: 'label',
          valueField: 'value',
          label: {
              visible: true,
              style: {
                  fill: '#e2e8f0'
              }
          },
          axes: [] // GUARD: No axes for funnel
       };
    } else {
       // Cartesian types (Bar, Line)
       spec = {
          ...commonSpec,
          xField: 'label',
          yField: 'value',
          axes: [
            {
                orient: 'left',
                visible: true,
                domainLine: { visible: false },
                grid: {
                    visible: true,
                    style: {
                        lineDash: [4, 4],
                        stroke: '#334155',
                        lineWidth: 1
                    }
                },
                label: {
                    style: {
                        fill: '#94a3b8',
                        fontSize: 12
                    }
                }
            },
            {
                orient: 'bottom',
                visible: true,
                domainLine: { visible: false },
                label: {
                    visible: true,
                    style: {
                        fill: '#94a3b8',
                        fontSize: 12,
                        fontWeight: 'bold'
                    }
                }
            }
          ]
       };

       if (type === 'line') {
          spec.point = {
              style: {
                  fill: '#0f172a',
                  stroke: '#00f5ff',
                  lineWidth: 2,
                  size: 8,
                  shadowBlur: 10,
                  shadowColor: '#00f5ff'
              }
          };
          spec.line = {
              style: {
                  lineWidth: 4,
                  shadowBlur: 10,
                  shadowColor: '#00f5ff'
              }
          };
       } else { // Bar
          spec.bar = {
              state: {
                  hover: { fill: '#00d0ff' }
              },
              style: {
                  cornerRadius: [4, 4, 0, 0],
                  shadowBlur: 15,
                  shadowColor: '#00f5ff' // Neon Glow on Marks only
              }
          };
       }
    }

    const VChartClass = (typeof VChart !== 'undefined' && VChart.default) ? VChart.default : VChart;
    const vchart = new VChartClass(spec, { dom: 'chart-container' });
    vchart.renderSync();
        </script>
      </body>
      </html>
    `;
  }

  private async captureStatic(task: ImageTask, payload: any, chartData: any[], index?: number): Promise<string> {
    // Prompt 9: "If static, it will set animation: false in the spec."
    const htmlContent = this.getHtmlContent(task, payload, chartData, false);

    const { context, page } = await this.browserService.getNewPage();

    try {
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#chart-container canvas', { timeout: 10000 });
      // Buffer for render
      await page.waitForTimeout(500);

      const buffer = await page.locator('#chart-container').screenshot();
      const fileName = `task-${index ?? 'unknown'}-data_viz.png`;
      const url = await this.localStorage.upload(buffer, fileName);
      return url;
    } finally {
      await page.close();
      await context.close();
    }
  }

  private async captureVideo(task: ImageTask, payload: any, chartData: any[], index?: number): Promise<string> {
    // Prompt 9: "If animated... Perform a Playwright video recording... of the full 2-second animation"
    const htmlContent = this.getHtmlContent(task, payload, chartData, true);

    const videoDir = path.resolve(process.cwd(), 'videos');
    const videoOptions = { recordVideo: { dir: videoDir, size: { width: 1024, height: 1024 } } };

    const { context, page } = await this.browserService.getNewPage(videoOptions);

    try {
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#chart-container canvas', { timeout: 10000 });

      // Wait for animation duration (1500) + buffer (500) = 2000ms
      await page.waitForTimeout(2000);

      // Close to flush video
      await page.close();
      await context.close();

      const videoPath = await page.video()?.path();
      if (!videoPath) throw new Error('Video file not found');

      const promptFileName = `task-${index ?? 'unknown'}-data_viz.mp4`;
      const buffer = fs.readFileSync(videoPath);
      const url = await this.localStorage.upload(buffer, promptFileName);

      return url;
    } catch (e) {
      // Check if already closed
      await page.close().catch(() => { });
      await context.close().catch(() => { });
      throw e;
    }
  }
}
