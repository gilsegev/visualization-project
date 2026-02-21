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
    const startedAt = Date.now();
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

      const elapsedMs = Date.now() - startedAt;
      return {
        url: videoUrl,
        posterUrl,
        payload: {
          output_dir: this.deriveOutputDirFromUrl(videoUrl),
          metrics: {
            generation_ms: elapsedMs.toFixed(2),
            total_ms: elapsedMs.toFixed(2),
          },
          image_prompts: [task.refined_prompt],
          blueprint_prompt: task.refined_prompt,
          chart_type: payload.chartType || 'bar',
          format,
        }
      };

    } else {
      // Static Only
      // Prompt 9: "Perform a standard screenshot"
      const url = await this.captureStatic(task, payload, chartData, index);
      const elapsedMs = Date.now() - startedAt;
      return {
        url,
        payload: {
          output_dir: this.deriveOutputDirFromUrl(url),
          metrics: {
            generation_ms: elapsedMs.toFixed(2),
            total_ms: elapsedMs.toFixed(2),
          },
          image_prompts: [task.refined_prompt],
          blueprint_prompt: task.refined_prompt,
          chart_type: payload.chartType || 'bar',
          format,
        }
      };
    }
  }

  private deriveOutputDirFromUrl(url: string): string | undefined {
    if (!url || typeof url !== 'string') return undefined;
    const marker = '/generated-images/';
    const idx = url.indexOf(marker);
    if (idx < 0) return undefined;
    const relative = url.slice(idx + marker.length).replace(/\\/g, '/');
    const parts = relative.split('/').filter(Boolean);
    if (parts.length <= 1) return '.';
    return parts.slice(0, -1).join('/');
  }

  private getHtmlContent(task: ImageTask, payload: any, chartData: any[], isAnimated: boolean): string {
    const theme = this.buildCourseChartTheme(task);
    const vChartLib = this.loadVChartLib();

    // Construct the HTML with VChart spec
    // Reusing the robust spec logic from Prompt 8
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <script>${vChartLib}</script>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${theme.background}; }
          #chart-container { width: 1024px; height: 1024px; font-family: ${theme.fontFamily}; }
        </style>
      </head>
      <body>
        <div id="chart-container"></div>
        <script>
    const THEME = ${JSON.stringify(theme)};
    const isAnimated = ${isAnimated};
    const commonSpec = {
      type: '${payload.chartType || 'bar'}',
      data: {
        values: ${JSON.stringify(chartData)}
      },
      background: THEME.background,
      color: THEME.palette,
      title: {
        visible: true,
        text: '${String(payload?.title || task.refined_prompt).replace(/'/g, "\\'")}',
        textStyle: { 
            fontSize: 28, 
            fontWeight: 'bold', 
            fill: THEME.textPrimary, 
            fontFamily: THEME.fontFamily
        },
        padding: { bottom: 20 }
      },
      legends: { 
        visible: true, 
        orient: 'bottom',
        item: {
            label: {
                style: {
                    fill: THEME.textSecondary, 
                    fontSize: 13
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
                        stroke: THEME.gridColor,
                        lineWidth: 1
                    }
                },
                label: {
                    style: {
                        fill: THEME.textSecondary,
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
                        fill: THEME.textSecondary,
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
                  fill: THEME.background,
                  stroke: THEME.accentPrimary,
                  lineWidth: 2,
                  size: 8,
                  shadowBlur: 0
              }
          };
          spec.line = {
              style: {
                  lineWidth: 3,
                  shadowBlur: 0
              }
          };
       } else { // Bar
          spec.bar = {
              state: {
                  hover: { fill: THEME.accentSecondary }
              },
              style: {
                  cornerRadius: [6, 6, 0, 0]
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

  private loadVChartLib(): string {
    const candidates = [
      path.resolve(process.cwd(), 'public/assets/vchart.js'),
      path.resolve(process.cwd(), 'node_modules/@visactor/vchart/build/index.min.js'),
      path.resolve(process.cwd(), 'node_modules/@visactor/vchart/build/index.js'),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        if (content && content.length > 1000) {
          this.logger.log(`[DataViz] Loaded VChart runtime from: ${candidate}`);
          return content;
        }
      } catch {
        // try next candidate
      }
    }

    throw new Error('VChart runtime not found. Expected public/assets/vchart.js or node_modules/@visactor/vchart/build/index.min.js');
  }

  private buildCourseChartTheme(task: ImageTask): {
    background: string;
    textPrimary: string;
    textSecondary: string;
    gridColor: string;
    accentPrimary: string;
    accentSecondary: string;
    palette: string[];
    fontFamily: string;
  } {
    const metadata = (task as any)?.metadata || {};
    const customTheme = metadata?.custom_theme || {};
    const coursePalette = Array.isArray(metadata?.course_palette_hexes)
      ? metadata.course_palette_hexes.filter((v: any) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v))
      : [];

    const fallbackPalette = ['#2B6CB0', '#2F855A', '#D69E2E', '#DD6B20', '#4A5568'];
    const palette = (coursePalette.length ? coursePalette : fallbackPalette).slice(0, 8);

    const background = customTheme?.background_main || '#F7FAFC';
    const textPrimary = customTheme?.text_main || palette[4] || '#1A365D';
    const textSecondary = customTheme?.text_secondary || '#4A5568';
    const accentPrimary = customTheme?.primary_accent || palette[0] || '#2B6CB0';
    const accentSecondary = customTheme?.secondary_accent || palette[1] || '#2F855A';

    const fontName = customTheme?.font_name;
    const fontFamily = fontName ? `'${String(fontName).replace(/'/g, '')}', sans-serif` : `'Inter', sans-serif`;

    return {
      background,
      textPrimary,
      textSecondary,
      gridColor: this.hexToRgba(textSecondary, 0.25),
      accentPrimary,
      accentSecondary,
      palette,
      fontFamily,
    };
  }

  private hexToRgba(hex: string, alpha: number): string {
    const normalized = String(hex || '').replace('#', '').trim();
    if (!/^[0-9a-f]{3,8}$/i.test(normalized)) {
      return `rgba(74, 85, 104, ${alpha})`;
    }

    const full = normalized.length === 3
      ? normalized.split('').map((c) => c + c).join('')
      : normalized.slice(0, 6);

    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
