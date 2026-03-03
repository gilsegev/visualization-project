import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { BrowserService } from '../browser.service';

@Injectable()
export class DataVizStrategy extends BaseImageStrategy {
  private readonly chartThemePresets: Record<string, {
    background: string;
    textPrimary: string;
    textSecondary: string;
    accentPrimary: string;
    accentSecondary: string;
    palette: string[];
    fontFamily: string;
    containerBorder?: string;
    gridOpacity?: number;
    barStroke?: string;
    barStrokeWidth?: number;
    lineStrokeWidth?: number;
    pointStrokeWidth?: number;
    pointSize?: number;
    valueLabel?: boolean;
    multicolorByDatum?: boolean;
    pseudo3dBars?: boolean;
  }> = {
      chart_harbor: {
        background: '#F2F6F7',
        textPrimary: '#113647',
        textSecondary: '#4B6270',
        accentPrimary: '#2F6F7E',
        accentSecondary: '#E39B6D',
        palette: ['#2F6F7E', '#4F8DA0', '#E39B6D', '#C9DCE1', '#113647'],
        fontFamily: `'Source Sans 3', 'Inter', sans-serif`,
      },
      chart_field: {
        background: '#FAF7EF',
        textPrimary: '#2A342D',
        textSecondary: '#5A635C',
        accentPrimary: '#3B7A57',
        accentSecondary: '#D7A34A',
        palette: ['#3B7A57', '#5A9B74', '#D7A34A', '#9FAE8F', '#2A342D'],
        fontFamily: `'IBM Plex Sans', 'Inter', sans-serif`,
      },
      chart_slate: {
        background: '#F4F7FB',
        textPrimary: '#1C2A3A',
        textSecondary: '#4E6075',
        accentPrimary: '#2E5FA7',
        accentSecondary: '#E0703C',
        palette: ['#2E5FA7', '#4A7EC1', '#E0703C', '#A9BBD5', '#1C2A3A'],
        fontFamily: `'Manrope', 'Inter', sans-serif`,
      },
      chart_tidepool: {
        background: '#EEF4F2',
        textPrimary: '#0F2B36',
        textSecondary: '#3C5963',
        accentPrimary: '#0F6D75',
        accentSecondary: '#D17C4C',
        palette: ['#0F6D75', '#2C8A93', '#D17C4C', '#9FC9CC', '#0F2B36'],
        fontFamily: `'Nunito Sans', 'Inter', sans-serif`,
      },
      chart_ledger: {
        background: '#F8F5EE',
        textPrimary: '#1E2A33',
        textSecondary: '#4F5C66',
        accentPrimary: '#2F5C87',
        accentSecondary: '#8B6B4A',
        palette: ['#2F5C87', '#4D7AA5', '#8B6B4A', '#B8C2CC', '#1E2A33'],
        fontFamily: `'Public Sans', 'Inter', sans-serif`,
      },
      chart_midnight_neon: {
        background: '#0A1020',
        textPrimary: '#E8F3FF',
        textSecondary: '#8DA6C6',
        accentPrimary: '#37E3FF',
        accentSecondary: '#FF8A5B',
        palette: ['#37E3FF', '#6F8CFF', '#FF8A5B', '#3DE0B8', '#FFD166', '#9B8BFF'],
        fontFamily: `'IBM Plex Sans', 'Inter', sans-serif`,
        containerBorder: 'rgba(55,227,255,0.35)',
        gridOpacity: 0.18,
        barStroke: '#9EEBFF',
        barStrokeWidth: 1.4,
        lineStrokeWidth: 3.5,
        pointStrokeWidth: 2.5,
        pointSize: 9,
        valueLabel: true,
        multicolorByDatum: true,
      },
      chart_blueprint_grid: {
        background: '#121826',
        textPrimary: '#EAF1FF',
        textSecondary: '#A7B9D3',
        accentPrimary: '#7FA7FF',
        accentSecondary: '#5BE7C4',
        palette: ['#7FA7FF', '#5BE7C4', '#FFB86C', '#B59BFF', '#FF7E9D', '#8ED081'],
        fontFamily: `'Manrope', 'Inter', sans-serif`,
        containerBorder: 'rgba(127,167,255,0.35)',
        gridOpacity: 0.25,
        barStroke: '#D3E2FF',
        barStrokeWidth: 1.2,
        lineStrokeWidth: 3.2,
        pointStrokeWidth: 2.2,
        pointSize: 8,
        valueLabel: false,
        multicolorByDatum: true,
      },
      chart_glass_chalk: {
        background: '#1A1F2A',
        textPrimary: '#F2F6FF',
        textSecondary: '#B9C4D8',
        accentPrimary: '#7CD4FF',
        accentSecondary: '#F7B267',
        palette: ['#7CD4FF', '#9EF0C7', '#F7B267', '#F48498', '#8FA6FF', '#D2C1FF'],
        fontFamily: `'Source Sans 3', 'Inter', sans-serif`,
        containerBorder: 'rgba(255,255,255,0.16)',
        gridOpacity: 0.2,
        barStroke: '#FFFFFF',
        barStrokeWidth: 1,
        lineStrokeWidth: 3,
        pointStrokeWidth: 2,
        pointSize: 8,
        valueLabel: true,
      },
      chart_candy_3d: {
        background: '#F7F4FF',
        textPrimary: '#2A2450',
        textSecondary: '#5D5A7A',
        accentPrimary: '#7D53F6',
        accentSecondary: '#FF7A59',
        palette: ['#7D53F6', '#FF7A59', '#2EC4B6', '#FFD166', '#4EA8DE', '#EF476F', '#06D6A0'],
        fontFamily: `'Nunito Sans', 'Inter', sans-serif`,
        containerBorder: 'rgba(125,83,246,0.25)',
        gridOpacity: 0.22,
        barStroke: '#FFFFFF',
        barStrokeWidth: 1.8,
        lineStrokeWidth: 3.8,
        pointStrokeWidth: 2.8,
        pointSize: 10,
        valueLabel: true,
        multicolorByDatum: true,
        pseudo3dBars: true,
      },
    };

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
          #chart-container { width: 1024px; height: 1024px; font-family: ${theme.fontFamily}; box-sizing: border-box; border: 2px solid ${theme.containerBorder}; border-radius: 14px; }
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
      colorField: THEME.multicolorByDatum ? 'color_slot' : undefined,
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
       const baseValues = ${JSON.stringify(chartData)};
       if (THEME.multicolorByDatum) {
          commonSpec.data.values = baseValues.map((d, idx) => ({ ...d, color_slot: 'c' + (idx % THEME.palette.length) }));
       }
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
                  lineWidth: THEME.pointStrokeWidth || 2,
                  size: THEME.pointSize || 8,
                  shadowBlur: 0
              }
          };
          spec.line = {
              style: {
                  lineWidth: THEME.lineStrokeWidth || 3,
                  shadowBlur: 0
              }
          };
       } else { // Bar
          spec.bar = {
              state: {
                  hover: { fill: THEME.accentSecondary }
              },
              style: {
                  cornerRadius: [6, 6, 0, 0],
                  stroke: THEME.barStroke || THEME.accentPrimary,
                  lineWidth: THEME.barStrokeWidth || 0,
                  shadowBlur: THEME.pseudo3dBars ? 8 : 0,
                  shadowOffsetX: THEME.pseudo3dBars ? 3 : 0,
                  shadowOffsetY: THEME.pseudo3dBars ? 3 : 0,
                  shadowColor: THEME.pseudo3dBars ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0)'
              }
          };
          if (THEME.valueLabel) {
            spec.label = { visible: true, style: { fill: THEME.textSecondary, fontSize: 12 } };
          }
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
    containerBorder: string;
    gridOpacity: number;
    barStroke: string;
    barStrokeWidth: number;
    lineStrokeWidth: number;
    pointStrokeWidth: number;
    pointSize: number;
    valueLabel: boolean;
    multicolorByDatum: boolean;
    pseudo3dBars: boolean;
  } {
    const metadata = (task as any)?.metadata || {};
    const chartThemeId = String(metadata?.chart_theme_id || '').trim().toLowerCase();
    if (chartThemeId && this.chartThemePresets[chartThemeId]) {
      const preset = this.chartThemePresets[chartThemeId];
      return {
        ...preset,
        gridColor: this.hexToRgba(preset.textSecondary, preset.gridOpacity ?? 0.25),
        containerBorder: preset.containerBorder || this.hexToRgba(preset.accentPrimary, 0.22),
        gridOpacity: preset.gridOpacity ?? 0.25,
        barStroke: preset.barStroke || preset.accentPrimary,
        barStrokeWidth: preset.barStrokeWidth ?? 0,
        lineStrokeWidth: preset.lineStrokeWidth ?? 3,
        pointStrokeWidth: preset.pointStrokeWidth ?? 2,
        pointSize: preset.pointSize ?? 8,
        valueLabel: preset.valueLabel ?? false,
        multicolorByDatum: preset.multicolorByDatum ?? false,
        pseudo3dBars: preset.pseudo3dBars ?? false,
      };
    }

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
      containerBorder: this.hexToRgba(accentPrimary, 0.22),
      gridOpacity: 0.25,
      barStroke: accentPrimary,
      barStrokeWidth: 0,
      lineStrokeWidth: 3,
      pointStrokeWidth: 2,
      pointSize: 8,
      valueLabel: false,
      multicolorByDatum: false,
      pseudo3dBars: false,
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
