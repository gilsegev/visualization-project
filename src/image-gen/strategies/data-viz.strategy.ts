import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { BrowserService } from '../browser.service';
import { ObservabilityGateway } from '../../observability/observability.gateway';

@Injectable()
export class DataVizStrategy extends BaseImageStrategy {
  private readonly chartEngine = String(process.env.CHART_ENGINE || 'echarts').trim().toLowerCase();
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
    private readonly browserService: BrowserService,
    private readonly observability: ObservabilityGateway
  ) {
    super();
  }

  protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
    const startedAt = Date.now();
    const payload = task.payload as any;
    const metadata = (task as any)?.metadata || {};
    // Implementation of Prompt 9: Use 'format' from payload, or fallback to 'exportType'
    const exportType = 'exportType' in task ? task.exportType : 'static';
    const format = payload.format || exportType;
    const isAnimated = format === 'animated';
    const renderer = this.shouldUseD3(task, payload) ? 'd3' : (this.chartEngine === 'echarts' ? 'echarts' : 'vchart');

    this.logger.log(`[DEBUG] Task ${task.id}: Starting data viz (${payload.chartType}) - Mode: ${format}`);

    // Data Normalizer
    let chartData = payload.data || [];
    if (!Array.isArray(chartData) && typeof chartData === 'object') {
      if (Array.isArray(chartData.labels) && Array.isArray(chartData.values)) {
        const values = chartData.values;
        chartData = chartData.labels.map((label: any, i: number) => ({
          label: label,
          value: values[i]
        }));
      }
    }

    const rowCount = Array.isArray(chartData) ? chartData.length : 0;
    const labelsPreview = Array.isArray(chartData)
      ? chartData.slice(0, 6).map((row: any) => String(row?.label ?? '')).filter(Boolean).join(', ')
      : '';
    this.observability.emitLog(
      'info',
      `Chart config: type=${String(payload.chartType || 'bar')} format=${format} rows=${rowCount}${labelsPreview ? ` labels=${labelsPreview}` : ''}`,
      'DataViz',
      task.id
    );
    this.observability.emitLog(
      'info',
      `Chart styling decision renderer=${renderer} family=${String(metadata?.chart_family || 'default')} role=${String(metadata?.chart_role || 'comparison')}`,
      'DataViz',
      task.id,
      undefined,
      {
        metadata: {
          chart_theme_id: metadata?.chart_theme_id || null,
          style_profile_id: metadata?.style_profile_id || null,
          chart_role: metadata?.chart_role || null,
          chart_family: metadata?.chart_family || null,
          renderer_hint: metadata?.renderer_hint || null,
          renderer_selected: renderer,
        }
      }
    );

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
          chart_data_points: rowCount,
          chart_labels_preview: labelsPreview,
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
          chart_data_points: rowCount,
          chart_labels_preview: labelsPreview,
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
    if (this.shouldUseD3(task, payload)) {
      return this.getD3HtmlContent(task, payload, chartData);
    }
    if (this.chartEngine === 'echarts') {
      return this.getEChartsHtmlContent(task, payload, chartData, isAnimated);
    }
    return this.getVChartHtmlContent(task, payload, chartData, isAnimated);
  }

  private shouldUseD3(task: ImageTask, payload: any): boolean {
    const metadata = (task as any)?.metadata || {};
    const rendererHint = String(metadata?.renderer_hint || payload?.renderer_hint || '').toLowerCase();
    const chartFamily = String(metadata?.chart_family || payload?.chart_family || '').toLowerCase();
    return this.normalizeChartType(String(payload?.chartType || 'bar')) === 'bar'
      && (rendererHint === 'd3' || chartFamily === 'editorial_spotlight_bar');
  }

  private getD3HtmlContent(task: ImageTask, payload: any, chartData: any[]): string {
    const theme = this.buildCourseChartTheme(task);
    const d3Runtime = this.loadD3Lib();
    const title = String(payload?.title || task.refined_prompt || 'Chart');
    const subtitle = String(payload?.y_axis_label || '').trim()
      || (String(payload?.value_format || '').trim().toLowerCase() === 'percent' ? 'Percent share' : '')
      || (String(payload?.value_suffix || '').trim() ? `Values in ${String(payload?.value_suffix || '').trim()}` : '');
    const rows = (Array.isArray(chartData) ? chartData : [])
      .map((row) => ({ label: String(row?.label ?? ''), value: Number(row?.value ?? 0) }))
      .filter((row) => row.label && Number.isFinite(row.value));
    const paper = this.hexToRgba(theme.accentPrimary, 0.05);
    const mutedBar = this.hexToRgba(theme.accentPrimary, 0.45);
    const track = this.hexToRgba(theme.textSecondary, 0.12);
    const rule = this.hexToRgba(theme.textSecondary, 0.18);
    const grid = this.hexToRgba(theme.textSecondary, 0.14);
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <script>${d3Runtime}</script>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: ${paper}; }
          #chart-container { width: 1024px; height: 1024px; background: ${theme.background}; border: 1px solid ${theme.containerBorder}; border-radius: 18px; overflow: hidden; font-family: ${theme.fontFamily}; }
          text { font-family: ${theme.fontFamily}; }
        </style>
      </head>
      <body>
        <div id="chart-container"></div>
        <script>
          window.__chartReady = false;
          const rows = ${JSON.stringify(rows)};
          const w = 1024, h = 1024, m = { top: 220, right: 118, bottom: 92, left: 236 };
          const title = ${JSON.stringify(title)};
          const subtitle = ${JSON.stringify(subtitle)};
          const max = d3.max(rows, d => d.value) || 1;
          const focus = rows.reduce((best, row) => row.value > (best?.value ?? -Infinity) ? row : best, null);
          const svg = d3.select('#chart-container').append('svg').attr('width', w).attr('height', h);
          svg.append('rect').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h).attr('fill', '${theme.background}');
          svg.append('rect').attr('x', 46).attr('y', 54).attr('width', 6).attr('height', 74).attr('rx', 3).attr('fill', '${theme.accentPrimary}');
          svg.append('text').attr('x', 74).attr('y', 82).attr('fill', '${theme.textSecondary}').attr('font-size', 15).attr('font-weight', 700).text('Editorial Spotlight');
          svg.append('text').attr('x', 74).attr('y', 122).attr('fill', '${theme.textPrimary}').attr('font-size', 36).attr('font-weight', 800).text(title);
          if (subtitle) svg.append('text').attr('x', 74).attr('y', 154).attr('fill', '${theme.textSecondary}').attr('font-size', 16).attr('font-weight', 600).text(subtitle);
          svg.append('line').attr('x1', 74).attr('x2', w - 74).attr('y1', 182).attr('y2', 182).attr('stroke', '${rule}').attr('stroke-width', 1.5);
          const x = d3.scaleLinear().domain([0, max * 1.12]).nice().range([m.left, w - m.right]);
          const y = d3.scaleBand().domain(rows.map(d => d.label)).range([m.top, h - m.bottom]).padding(0.3);
          svg.append('g').attr('transform', 'translate(0,' + (h - m.bottom) + ')').call(d3.axisBottom(x).ticks(4).tickSize(-(h - m.top - m.bottom)))
            .call(g => g.select('.domain').remove())
            .call(g => g.selectAll('.tick line').attr('stroke', '${grid}').attr('stroke-dasharray', '4 8'))
            .call(g => g.selectAll('text').attr('fill', '${theme.textSecondary}').attr('font-size', 12).attr('font-weight', 600))
            .call(g => g.selectAll('.tick').filter(d => Number(d) === 0).remove());
          svg.selectAll('text.label').data(rows).enter().append('text')
            .attr('x', m.left - 18).attr('y', d => (y(d.label) || 0) + y.bandwidth() / 2 + 5).attr('text-anchor', 'end')
            .attr('fill', d => d.label === focus?.label ? '${theme.textPrimary}' : '${theme.textSecondary}')
            .attr('font-size', 18).attr('font-weight', d => d.label === focus?.label ? 800 : 700).text(d => d.label);
          svg.selectAll('rect.track').data(rows).enter().append('rect')
            .attr('x', m.left).attr('y', d => y(d.label)).attr('width', w - m.left - m.right).attr('height', y.bandwidth()).attr('rx', 18).attr('fill', '${track}');
          svg.selectAll('rect.bar').data(rows).enter().append('rect')
            .attr('x', m.left).attr('y', d => y(d.label)).attr('width', d => Math.max(8, x(d.value) - m.left)).attr('height', y.bandwidth()).attr('rx', 18)
            .attr('fill', d => d.label === focus?.label ? '${theme.accentPrimary}' : '${mutedBar}');
          svg.selectAll('text.value').data(rows).enter().append('text')
            .attr('x', d => Math.min(w - m.right + 8, x(d.value) + 12)).attr('y', d => (y(d.label) || 0) + y.bandwidth() / 2 + 6)
            .attr('fill', '${theme.textPrimary}').attr('font-size', 24).attr('font-weight', 800).text(d => d.value);
          window.__chartReady = true;
        </script>
      </body>
      </html>
    `;
  }

  private getEChartsHtmlContent(task: ImageTask, payload: any, chartData: any[], isAnimated: boolean): string {
    const theme = this.buildCourseChartTheme(task);
    const chartRuntime = this.loadEChartsLib();
    const normalizedType = this.normalizeChartType(String(payload?.chartType || 'bar'));
    const chartTitle = String(payload?.title || task.refined_prompt || 'Chart');
    const option = this.buildEChartsOption(
      normalizedType,
      chartTitle,
      chartData,
      theme,
      isAnimated,
      String(payload?.y_axis_label || '').trim() || null,
      String(payload?.value_format || '').trim().toLowerCase() === 'percent' ? 'percent' : 'count',
      String(payload?.value_suffix || '').trim().slice(0, 3),
    );

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <script>${chartRuntime}</script>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${theme.background}; }
          #chart-container { width: 1024px; height: 1024px; font-family: ${theme.fontFamily}; box-sizing: border-box; border: 1px solid ${theme.containerBorder}; border-radius: 14px; overflow: hidden; background: ${theme.background}; }
        </style>
      </head>
      <body>
        <div id="chart-container"></div>
        <script>
          window.__chartReady = false;
          const option = ${JSON.stringify(option)};
          const container = document.getElementById('chart-container');
          const chart = echarts.init(container, null, { renderer: 'svg' });
          chart.setOption(option, true);
          const markReady = () => { window.__chartReady = true; };
          if (${isAnimated}) {
            chart.on('finished', markReady);
            setTimeout(markReady, 2200);
          } else {
            setTimeout(markReady, 150);
          }
          window.addEventListener('resize', () => chart.resize());
        </script>
      </body>
      </html>
    `;
  }

  private getVChartHtmlContent(task: ImageTask, payload: any, chartData: any[], isAnimated: boolean): string {
    const theme = this.buildCourseChartTheme(task);
    const vChartLib = this.loadVChartLib();

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
    window.__chartReady = false;
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
        text: ${JSON.stringify(String(payload?.title || task.refined_prompt))},
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
      animation: isAnimated,
      animationAppear: {
        duration: 1500,
        easing: 'cubicOut',
        oneByOne: true
      },
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
          axes: []
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
          axes: []
       };
    } else {
       const baseValues = ${JSON.stringify(chartData)};
       if (THEME.multicolorByDatum) {
          commonSpec.data.values = baseValues.map((d, idx) => ({ ...d, color_slot: 'c' + (idx % THEME.palette.length) }));
       }
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
       } else {
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
    window.__chartReady = true;
        </script>
      </body>
      </html>
    `;
  }

  private normalizeChartType(type: string): 'bar' | 'line' | 'pie' | 'funnel' {
    const raw = String(type || '').toLowerCase();
    if (raw.includes('line')) return 'line';
    if (raw.includes('pie') || raw.includes('donut')) return 'pie';
    if (raw.includes('funnel')) return 'funnel';
    return 'bar';
  }

  private buildEChartsOption(
    type: 'bar' | 'line' | 'pie' | 'funnel',
    title: string,
    chartData: any[],
    theme: ReturnType<DataVizStrategy['buildCourseChartTheme']>,
    isAnimated: boolean,
    yAxisLabel: string | null,
    valueFormat: 'percent' | 'count',
    valueSuffix: string,
  ): Record<string, any> {
    const rows = Array.isArray(chartData) ? chartData : [];
    const labels = rows.map((row) => String(row?.label ?? ''));
    const values = rows.map((row) => Number(row?.value ?? 0));
    const maxValue = values.length ? Math.max(...values) : 0;
    const minValue = values.length ? Math.min(...values) : 0;
    const trendMin = Math.max(0, Math.floor(minValue * 0.85));
    const trendMax = maxValue > 0 ? Math.ceil(maxValue * 1.12) : undefined;
    const focusIndex = values.length ? values.indexOf(maxValue) : -1;
    const barFocusColor = theme.accentPrimary;
    const barSecondaryColors = [
      this.hexToRgba(theme.accentPrimary, 0.62),
      this.hexToRgba(theme.accentPrimary, 0.48),
      this.hexToRgba(theme.accentPrimary, 0.34),
      this.hexToRgba(theme.accentPrimary, 0.24),
    ];
    const seriesData = rows.map((row, idx) => ({
      value: Number(row?.value ?? 0),
      name: String(row?.label ?? ''),
      itemStyle: theme.multicolorByDatum
        ? { color: theme.palette[idx % theme.palette.length] }
        : idx === focusIndex
          ? { color: barFocusColor }
          : type === 'bar'
            ? { color: barSecondaryColors[Math.min(idx, barSecondaryColors.length - 1)] }
            : undefined,
    }));

    const base: Record<string, any> = {
      backgroundColor: theme.background,
      animation: isAnimated,
      animationDuration: 1400,
      animationEasing: 'cubicOut',
      color: theme.palette,
      title: {
        text: title,
        subtext: type === 'bar' && yAxisLabel ? yAxisLabel : '',
        top: 20,
        left: 'center',
        textStyle: {
          color: theme.textPrimary,
          fontFamily: theme.fontFamily.replace(/'/g, ''),
          fontSize: type === 'line' ? 32 : type === 'bar' ? 31 : 30,
          fontWeight: 700,
        },
        subtextStyle: {
          color: theme.textSecondary,
          fontFamily: theme.fontFamily.replace(/'/g, ''),
          fontSize: 13,
          fontWeight: 600,
        },
        itemGap: 10,
      },
      tooltip: {
        trigger: type === 'pie' || type === 'funnel' ? 'item' : 'axis',
        backgroundColor: this.hexToRgba(theme.background, 0.98),
        borderColor: theme.containerBorder,
        borderWidth: 1,
        valueFormatter: (value: number) => {
          if (valueFormat === 'percent') return `${value}%`;
          return valueSuffix ? `${value}${valueSuffix}` : `${value}`;
        },
        textStyle: {
          color: theme.textPrimary,
          fontFamily: theme.fontFamily.replace(/'/g, ''),
        },
      },
      legend: {
        show: false,
        bottom: 18,
        left: 'center',
        textStyle: {
          color: theme.textSecondary,
          fontFamily: theme.fontFamily.replace(/'/g, ''),
        },
      },
      textStyle: {
        fontFamily: theme.fontFamily.replace(/'/g, ''),
      },
    };

    if (type === 'pie') {
      return {
        ...base,
        graphic: [{
          type: 'text',
          left: 'center',
          top: '44%',
          style: {
            text: rows[focusIndex]?.name || '',
            fill: theme.textSecondary,
            font: `600 14px ${theme.fontFamily.replace(/'/g, '')}`,
            textAlign: 'center',
          },
        }, {
          type: 'text',
          left: 'center',
          top: '48%',
          style: {
            text: focusIndex >= 0 ? `${values[focusIndex]}${valueSuffix || (valueFormat === 'percent' ? '%' : '')}` : '',
            fill: theme.textPrimary,
            font: `700 24px ${theme.fontFamily.replace(/'/g, '')}`,
            textAlign: 'center',
          },
        }],
        series: [{
          type: 'pie',
          radius: ['42%', '72%'],
          center: ['50%', '50%'],
          top: 96,
          bottom: 82,
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: theme.background,
            borderWidth: 4,
            borderRadius: 8,
          },
          label: {
            color: theme.textPrimary,
            formatter: '{b}\n{d}%',
            fontSize: 13,
            fontWeight: 600,
          },
          labelLine: {
            lineStyle: {
              color: theme.textSecondary,
            },
          },
          data: seriesData,
        }],
      };
    }

    if (type === 'funnel') {
      return {
        ...base,
        series: [{
          type: 'funnel',
          top: 120,
          left: '14%',
          width: '72%',
          bottom: 92,
          minSize: '20%',
          maxSize: '92%',
          gap: 10,
          sort: 'descending',
          label: {
            show: true,
            position: 'inside',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 14,
            formatter: (params: any) => `${params?.name || ''}\n${params?.value ?? ''}${valueSuffix || (valueFormat === 'percent' ? '%' : '')}`,
          },
          labelLine: { show: false },
          itemStyle: {
            borderColor: theme.background,
            borderWidth: 3,
            borderRadius: 6,
          },
          emphasis: {
            label: { color: '#ffffff' },
          },
          data: seriesData,
        }],
      };
    }

    return {
      ...base,
      grid: {
        left: type === 'line' ? 78 : 82,
        right: type === 'line' ? 72 : 48,
        top: type === 'line' ? 120 : 132,
        bottom: type === 'line' ? 80 : 88,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          color: theme.textSecondary,
          fontSize: type === 'line' ? 14 : 14,
          fontWeight: 600,
          interval: 0,
          rotate: labels.some((label) => String(label).length > 12) ? 20 : 0,
        },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: type === 'line' ? this.hexToRgba(theme.textSecondary, 0.45) : this.hexToRgba(theme.textSecondary, 0.38), width: 1 } },
      },
      yAxis: {
        type: 'value',
        min: type === 'line' ? trendMin : undefined,
        max: type === 'line' ? trendMax : undefined,
        name: yAxisLabel || undefined,
        nameTextStyle: {
          color: theme.textPrimary,
          fontSize: type === 'bar' ? 13 : 12,
          fontWeight: type === 'bar' ? 600 : 400,
          padding: [0, 0, 12, 0],
        },
        axisLabel: {
          color: theme.textSecondary,
          fontSize: type === 'line' ? 13 : 12,
          margin: 12,
          formatter: valueFormat === 'percent'
            ? '{value}%'
            : (valueSuffix ? `{value}${valueSuffix}` : '{value}'),
        },
        splitLine: {
          lineStyle: {
            color: type === 'line' ? this.hexToRgba(theme.textSecondary, 0.22) : this.hexToRgba(theme.textSecondary, 0.16),
            type: type === 'line' ? [3, 6] : [2, 8],
          },
        },
        splitNumber: type === 'bar' ? 4 : undefined,
      },
      series: [
        type === 'line'
          ? {
              type: 'line',
              smooth: false,
              data: seriesData.map((row) => row.value),
              symbol: 'circle',
              symbolSize: (theme.pointSize || 8) + 3,
              lineStyle: {
                width: (theme.lineStrokeWidth || 3) + 0.8,
                color: theme.accentPrimary,
                cap: 'round',
                join: 'round',
              },
              areaStyle: {
                color: this.hexToRgba(theme.accentPrimary, 0.16),
              },
              itemStyle: {
                color: theme.accentPrimary,
                borderColor: theme.background,
                borderWidth: (theme.pointStrokeWidth || 2) + 1,
                shadowBlur: 10,
                shadowColor: this.hexToRgba(theme.accentPrimary, 0.18),
              },
              label: {
                show: true,
                position: 'top',
                distance: 10,
                color: theme.textPrimary,
                fontSize: 14,
                fontWeight: 700,
                backgroundColor: this.hexToRgba(theme.background, 0.92),
                borderRadius: 8,
                padding: [3, 6, 3, 6],
                formatter: valueFormat === 'percent'
                  ? '{c}%'
                  : (valueSuffix ? `{c}${valueSuffix}` : '{c}'),
              },
            }
          : {
              type: 'bar',
              data: seriesData,
              barWidth: rows.length <= 4 ? '46%' : '52%',
              itemStyle: {
                borderRadius: [16, 16, 0, 0],
                borderColor: theme.barStroke || theme.accentPrimary,
                borderWidth: theme.barStrokeWidth || 0,
                shadowBlur: theme.pseudo3dBars ? 10 : 12,
                shadowOffsetX: theme.pseudo3dBars ? 4 : 0,
                shadowOffsetY: theme.pseudo3dBars ? 4 : 8,
                shadowColor: theme.pseudo3dBars ? 'rgba(0,0,0,0.15)' : this.hexToRgba(theme.accentPrimary, 0.16),
              },
              label: theme.valueLabel || rows.length <= 6
                ? {
                    show: true,
                    position: 'top',
                    color: theme.textPrimary,
                    fontSize: 14,
                    fontWeight: 700,
                    distance: 8,
                    backgroundColor: this.hexToRgba(theme.background, 0.98),
                    borderRadius: 10,
                    padding: [4, 7, 4, 7],
                    formatter: valueFormat === 'percent'
                      ? '{c}%'
                      : (valueSuffix ? `{c}${valueSuffix}` : '{c}'),
                  }
                : undefined,
            },
      ],
    };
  }

  private loadChartRuntime(): string {
    if (this.chartEngine === 'echarts') {
      return this.loadEChartsLib();
    }
    return this.loadVChartLib();
  }

  private loadEChartsLib(): string {
    const candidates = [
      path.resolve(process.cwd(), 'public/assets/echarts.min.js'),
      path.resolve(process.cwd(), 'node_modules/echarts/dist/echarts.min.js'),
      path.resolve(process.cwd(), 'node_modules/echarts/dist/echarts.js'),
    ];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        if (content && content.length > 1000) {
          this.logger.log(`[DataViz] Loaded ECharts runtime from: ${candidate}`);
          return content;
        }
      } catch {
        // try next candidate
      }
    }

    throw new Error('ECharts runtime not found. Expected public/assets/echarts.min.js or node_modules/echarts/dist/echarts.min.js');
  }

  private loadD3Lib(): string {
    const candidates = [
      path.resolve(process.cwd(), 'public/assets/d3.min.js'),
      path.resolve(process.cwd(), 'node_modules/d3/dist/d3.min.js'),
      path.resolve(process.cwd(), 'node_modules/d3/dist/d3.js'),
    ];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        if (content && content.length > 1000) {
          this.logger.log(`[DataViz] Loaded D3 runtime from: ${candidate}`);
          return content;
        }
      } catch {}
    }
    throw new Error('D3 runtime not found. Expected public/assets/d3.min.js or node_modules/d3/dist/d3.min.js');
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
    const tokens = metadata?.chart_style_tokens || metadata?.document_chart_style_decision?.tokens;
    if (tokens?.surface && tokens?.color && tokens?.type && tokens?.axis && tokens?.mark) {
      return {
        background: tokens.surface.background,
        textPrimary: tokens.color.textPrimary,
        textSecondary: tokens.color.textSecondary,
        gridColor: tokens.color.grid || this.hexToRgba(tokens.color.textSecondary, tokens.axis.gridOpacity ?? 0.25),
        accentPrimary: tokens.color.emphasis || tokens.color.palette?.[0] || '#2B6CB0',
        accentSecondary: tokens.color.palette?.[1] || tokens.color.emphasis || '#2F855A',
        palette: Array.isArray(tokens.color.palette) && tokens.color.palette.length ? tokens.color.palette : ['#2B6CB0', '#2F855A', '#D69E2E'],
        fontFamily: `'${String(tokens.type.titleFamily || tokens.type.bodyFamily || 'Inter').replace(/'/g, '')}', sans-serif`,
        containerBorder: this.hexToRgba(tokens.color.emphasis || tokens.surface.border, 0.28),
        gridOpacity: tokens.axis.gridOpacity ?? 0.25,
        barStroke: tokens.color.emphasis || tokens.color.palette?.[0] || '#2B6CB0',
        barStrokeWidth: 0,
        lineStrokeWidth: tokens.mark.lineWidth ?? 3,
        pointStrokeWidth: 2,
        pointSize: tokens.mark.pointSize ?? 8,
        valueLabel: !!tokens.mark.valueLabels,
        multicolorByDatum: !!tokens.mark.multicolorByDatum,
        pseudo3dBars: !!tokens.mark.pseudo3dBars,
      };
    }
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

    const background = customTheme?.background_main || '#FCFCFA';
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
      await page.waitForFunction(() => (window as any).__chartReady === true, undefined, { timeout: 10000 });
      await page.waitForTimeout(80);

      const buffer = await page.locator('#chart-container').screenshot();
      const fileName = `task-${task.id}-data_viz.png`;
      const url = await this.localStorage.upload(buffer, fileName);
      this.observability.emitLog('info', `Rendered static chart -> ${fileName}`, 'DataViz', task.id);
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
      await page.waitForFunction(() => (window as any).__chartReady === true, undefined, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Close to flush video
      await page.close();
      await context.close();

      const videoPath = await page.video()?.path();
      if (!videoPath) throw new Error('Video file not found');

      const promptFileName = `task-${task.id}-data_viz.mp4`;
      const buffer = fs.readFileSync(videoPath);
      const url = await this.localStorage.upload(buffer, promptFileName);
      this.observability.emitLog('info', `Rendered animated chart -> ${promptFileName}`, 'DataViz', task.id);

      return url;
    } catch (e) {
      // Check if already closed
      await page.close().catch(() => { });
      await context.close().catch(() => { });
      throw e;
    }
  }
}
