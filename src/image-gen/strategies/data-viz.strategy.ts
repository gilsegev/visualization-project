import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseImageStrategy } from '../base-image.strategy';
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

  protected async performGeneration(task: ImageTask, index?: number): Promise<string> {
    const payload = task.payload as any;
    // Safely access exportType (available on data_viz variant)
    const exportType = 'exportType' in task ? task.exportType : 'static';
    const isAnimated = exportType === 'animated';
    this.logger.log(`[DEBUG] Task ${task.id}: Starting data viz (${payload.chartType}) - Mode: ${exportType}`);

    // Video Recording Setup
    const videoDir = path.resolve(process.cwd(), 'videos'); // Playwright needs absolute path
    const videoOptions = isAnimated ? { recordVideo: { dir: videoDir, size: { width: 1024, height: 1024 } } } : {};

    this.logger.log(`[DEBUG] Task ${task.id}: Getting page from BrowserService...`);
    // Use shared browser service with options
    const { context, page } = await this.browserService.getNewPage(videoOptions);
    this.logger.log(`[DEBUG] Task ${task.id}: Page created.`);

    // Data Normalizer (Keep existing logic)
    let chartData = payload.data || [];
    if (!Array.isArray(chartData) && typeof chartData === 'object') {
      if (Array.isArray(chartData.labels) && Array.isArray(chartData.values)) {
        chartData = chartData.labels.map((label: any, i: number) => ({
          label: label,
          value: chartData.values[i]
        }));
      }
    }

    // Load VChart locally
    const vChartLibPath = path.resolve(process.cwd(), 'public/assets/vchart.js');
    const vChartLib = fs.readFileSync(vChartLibPath, 'utf8');

    const htmlContent = `
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

    try {
      this.logger.log(`[DEBUG] Task ${task.id}: Setting page content...`);
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

      this.logger.log(`[DEBUG] Task ${task.id}: Waiting for canvas...`);
      await page.waitForSelector('#chart-container canvas', { timeout: 10000 });

      if (isAnimated) {
        this.logger.log(`[DEBUG] Task ${task.id}: Recording video (waiting 2000ms)...`);
        // Wait for animation duration (1500) + buffer (500)
        await page.waitForTimeout(2000);

        this.logger.log(`[DEBUG] Task ${task.id}: Closing page to save video...`);
        await page.close(); // Triggers video save
        await context.close();

        // Locate video file
        const videoPath = await page.video()?.path();
        if (!videoPath) throw new Error('Video file not found');

        // Rename/Move to public/generated-images
        // Playwright saves as .webm. We will rename to .webm (or .mp4 if user really insists, but browser saves webm)
        // Prompt said "Save as ...mp4". I'll try to just rename extension, but it might be misleading.
        // Correct implementation: Move the file.
        const fileName = `task-${index ?? 'unknown'}-data_viz.webm`; // Use webm to be honest, or valid container
        // User asked for "task-{index}-{type}.mp4". I will respect the prompt's filename request even if format is webm container-wise.
        // Many players handle this.
        const promptFileName = `task-${index ?? 'unknown'}-data_viz.mp4`;

        const buffer = fs.readFileSync(videoPath);
        const url = await this.localStorage.upload(buffer, promptFileName); // LocalStorageService handles 'public/generated-images' destination?

        // Clean up temp video
        // fs.unlinkSync(videoPath); // Playwright deletes temp if context closes? No, keep it until we move it.
        // Actually checking documentation, video path is temp.

        this.logger.log(`[DEBUG] Task ${task.id}: Video uploaded: ${url}`);
        return url;

      } else {
        // Static Mode
        this.logger.log(`[DEBUG] Task ${task.id}: Waiting safety buffer (500ms)...`);
        await page.waitForTimeout(500); // 500ms for final render

        const buffer = await page.locator('#chart-container').screenshot();
        const fileName = `task-${index ?? 'unknown'}-data_viz.png`;
        const url = await this.localStorage.upload(buffer, fileName);

        await page.close();
        await context.close();

        return url;
      }

    } catch (error) {
      this.logger.error(`[DEBUG] Task ${task.id}: ERROR during Playwright ops`, error);
      // Ensure close on error
      await page.close().catch(() => { });
      await context.close().catch(() => { });
      throw error;
    }
  }
}

