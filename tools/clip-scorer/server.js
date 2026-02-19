const http = require('http');

const PORT = Number(process.env.CLIP_SCORER_PORT || 4310);
const HOST = process.env.CLIP_SCORER_HOST || '0.0.0.0';
const MODEL = process.env.CLIP_SCORER_MODEL || 'Xenova/clip-vit-base-patch32';

let classifierPromise = null;

async function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const transformers = await import('@xenova/transformers');
      return transformers.pipeline('zero-shot-image-classification', MODEL);
    })();
  }
  return classifierPromise;
}

async function score(imageUrl, brief) {
  const classifier = await getClassifier();
  const labels = [brief, 'irrelevant image'];
  const output = await classifier(imageUrl, labels);
  const items = Array.isArray(output) ? output : [];
  const match = items.find((i) => i && i.label === brief) || items[0] || {};
  const value = Number(match.score || 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/score') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      try {
        const payload = raw ? JSON.parse(raw) : {};
        const imageUrl = String(payload.imageUrl || '').trim();
        const brief = String(payload.brief || '').trim();
        if (!imageUrl || !brief) {
          return send(res, 400, { ok: false, error: 'imageUrl and brief are required' });
        }
        const startedAt = Date.now();
        const clipScore = await score(imageUrl, brief);
        return send(res, 200, {
          ok: true,
          score: clipScore,
          latency_ms: Date.now() - startedAt,
          model: MODEL,
        });
      } catch (error) {
        return send(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
      }
    });
    return;
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[clip-scorer] listening on http://${HOST}:${PORT}`);
});
