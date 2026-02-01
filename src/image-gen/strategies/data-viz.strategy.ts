import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { chromium, Browser, BrowserContext } from 'playwright';

@Injectable()
export class DataVizStrategy extends BaseImageStrategy implements OnModuleDestroy {
  private browser: Browser;
  private context: BrowserContext;

  constructor(private readonly localStorage: LocalStorageService) {
    super();
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private browserInitPromise: Promise<void> | null = null;

  private async ensureBrowser() {
    if (this.browser) return;

    if (!this.browserInitPromise) {
      this.browserInitPromise = this.launchBrowser();
    }

    try {
      await this.browserInitPromise;
    } catch (error) {
      this.browserInitPromise = null;
      throw error;
    }
  }

  private async launchBrowser() {
    this.logger.log('Launching Playwright browser...');
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: { width: 1024, height: 1024 },
      deviceScaleFactor: 1,
    });
  }

  protected async performGeneration(task: ImageTask, index?: number): Promise<string> {
    const payload = task.payload as any;
    this.logger.log(`[DEBUG] Task ${task.id}: Starting data viz (${payload.chartType})`);

    this.logger.log(`[DEBUG] Task ${task.id}: Ensuring browser...`);
    await this.ensureBrowser();
    this.logger.log(`[DEBUG] Task ${task.id}: Browser ready.`);

    this.logger.log(`[DEBUG] Task ${task.id}: Creating new page...`);
    const page = await this.context.newPage();
    this.logger.log(`[DEBUG] Task ${task.id}: Page created.`);

    page.on('console', msg => this.logger.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => this.logger.error(`[BROWSER ERROR] ${err.message}`));

    // Template loading VisActor (VChart) from CDN
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="https://unpkg.com/@visactor/vchart/build/index.min.js"></script>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #fff; }
          #chart-container { width: 1024px; height: 1024px; font-family: 'Helvetica Neue', Arial, sans-serif; }
        </style>
      </head>
      <body>
        <div id="chart-container"></div>
        <script>
          const commonSpec = {
            type: '${payload.chartType || 'bar'}',
            data: {
              values: ${JSON.stringify(payload.data || [])}
            },
            title: {
              visible: true,
              text: '${task.refined_prompt.replace(/'/g, "\\'")}',
              textStyle: { fontSize: 24, fontWeight: 'bold' }
            },
            legends: { visible: true, orient: 'bottom' },
            animation: false,
            color: ['#003f5c', '#58508d', '#bc5090', '#ff6361', '#ffa600']
          };

          let spec = {};
          if ('${payload.chartType}' === 'pie') {
             spec = {
                ...commonSpec,
                categoryField: 'label',
                valueField: 'value',
             };
          } else {
             spec = {
                ...commonSpec,
                xField: 'label',
                yField: 'value',
                axes: [
                    { orient: 'left', visible: true }, 
                    { orient: 'bottom', visible: true, label: { visible: true } }
                ]
             };
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
      this.logger.log(`[DEBUG] Task ${task.id}: Content set (domcontentloaded).`);

      this.logger.log(`[DEBUG] Task ${task.id}: Waiting for canvas selector...`);
      await page.waitForSelector('#chart-container canvas', { timeout: 10000 });
      this.logger.log(`[DEBUG] Task ${task.id}: Canvas found.`);

      this.logger.log(`[DEBUG] Task ${task.id}: Waiting safety buffer (500ms)...`);
      await page.waitForTimeout(500);

      this.logger.log(`[DEBUG] Task ${task.id}: Taking screenshot...`);
      const buffer = await page.locator('#chart-container').screenshot();
      this.logger.log(`[DEBUG] Task ${task.id}: Screenshot taken.`);

      const fileName = `task-${index ?? 'unknown'}-data_viz.png`;
      const url = await this.localStorage.upload(buffer, fileName);
      this.logger.log(`[DEBUG] Task ${task.id}: Upload complete: ${url}`);
      return url;

    } catch (error) {
      this.logger.error(`[DEBUG] Task ${task.id}: ERROR during Playwright ops`, error);
      throw error;
    } finally {
      this.logger.log(`[DEBUG] Task ${task.id}: Closing page...`);
      await page.close();
      this.logger.log(`[DEBUG] Task ${task.id}: Page closed.`);
    }
  }
}
