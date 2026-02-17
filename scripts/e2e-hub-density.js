const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const COUNTS = [5, 8, 10, 12];
const HUB_TEMPLATE_PATH = path.join(
  process.cwd(),
  'public',
  'assets',
  'infographics',
  'templates',
  'html templates',
  'Hub.html'
);

function makeSvgDataUri(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#ffffff"/></linearGradient></defs><circle cx="80" cy="80" r="78" fill="url(#g)"/><text x="80" y="90" text-anchor="middle" font-size="36" font-family="Arial" fill="#1f2937">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildPayload(count) {
  return {
    center: {
      title: `HUB ${count}`,
      description: `Density test with ${count} spokes.`,
      image_url: makeSvgDataUri('C', '#f59e0b'),
    },
    items: Array.from({ length: count }, (_, i) => ({
      title: `Spoke ${i + 1}`,
      description: `This is a test description for spoke number ${i + 1}.`,
      image_url: makeSvgDataUri(String(i + 1), i % 2 === 0 ? '#10b981' : '#0ea5e9'),
    })),
  };
}

function stampHubHtml(template, payload) {
  const placeholder = '/* INSERT_JSON_HERE */ null';
  return template.replace(placeholder, JSON.stringify(payload, null, 2));
}

async function run() {
  if (!fs.existsSync(HUB_TEMPLATE_PATH)) {
    throw new Error(`Hub template missing: ${HUB_TEMPLATE_PATH}`);
  }

  const template = fs.readFileSync(HUB_TEMPLATE_PATH, 'utf8');
  const outDir = path.join(process.cwd(), 'public', 'generated-images', 'e2e-hub-density');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
  const results = [];

  for (const count of COUNTS) {
    const payload = buildPayload(count);
    const html = stampHubHtml(template, payload);
    const htmlPath = path.join(outDir, `hub-${count}.html`);
    const pngPath = path.join(outDir, `hub-${count}.png`);

    fs.writeFileSync(htmlPath, html, 'utf8');
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: pngPath, fullPage: true });

    const metrics = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.spoke-anchor .content-card'));
      const hub = document.getElementById('hub-center').getBoundingClientRect();
      const intersects = (a, b, pad = 0) =>
        !(
          a.right - pad < b.left + pad ||
          a.left + pad > b.right - pad ||
          a.bottom - pad < b.top + pad ||
          a.top + pad > b.bottom - pad
        );

      let cardOverlapPairs = 0;
      for (let i = 0; i < cards.length; i++) {
        const a = cards[i].getBoundingClientRect();
        for (let j = i + 1; j < cards.length; j++) {
          const b = cards[j].getBoundingClientRect();
          if (intersects(a, b, 8)) cardOverlapPairs++;
        }
      }

      let cardHubOverlaps = 0;
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (intersects(rect, hub, 6)) cardHubOverlaps++;
      }

      return {
        cardCount: cards.length,
        cardOverlapPairs,
        cardHubOverlaps,
      };
    });

    results.push({
      count,
      ...metrics,
      html: htmlPath,
      png: pngPath,
      pass: metrics.cardOverlapPairs === 0 && metrics.cardHubOverlaps === 0,
    });
  }

  await browser.close();

  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');

  console.table(
    results.map((r) => ({
      spokes: r.count,
      card_overlaps: r.cardOverlapPairs,
      hub_overlaps: r.cardHubOverlaps,
      pass: r.pass,
    }))
  );
  console.log(`Report: ${reportPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
