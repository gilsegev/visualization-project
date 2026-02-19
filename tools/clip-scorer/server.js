const http = require('http');

const PORT = Number(process.env.CLIP_SCORER_PORT || 4310);
const HOST = process.env.CLIP_SCORER_HOST || '0.0.0.0';
const MODEL = process.env.CLIP_SCORER_MODEL || 'Xenova/clip-vit-base-patch32';
const STRICT_MODE = String(process.env.CLIP_STRICT_MODE || 'true').toLowerCase() === 'true';

const DEFAULT_NEGATIVE_LABELS = [
  'an unrelated image',
  'a generic stock photo not matching the prompt',
  'a different subject in a similar environment',
  'an indoor office scene',
  'an abstract artwork',
  'a close-up object product shot',
  'a wild animal in nature',
  'a landscape with no main subject action',
];

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

function buildNegativeLabels(brief) {
  const lower = String(brief || '').toLowerCase();
  const negatives = [...DEFAULT_NEGATIVE_LABELS];

  // Domain-specific hard negatives to reduce semantic near-miss matches.
  if (/\b(angler|fish|fishing|release|hook|lake|river|boat)\b/.test(lower)) {
    negatives.push('an alligator or crocodile in a swamp');
    negatives.push('fishing rods and gear only, with no person releasing a fish');
    negatives.push('a person holding an unrelated object outdoors');
  }
  if (/\b(ddr|ram|memory|motherboard|pc|computer|cpu|gpu)\b/.test(lower)) {
    negatives.push('an animal outdoors');
    negatives.push('a person in nature');
    negatives.push('a scenic landscape photo');
  }

  return [...new Set(negatives)];
}

async function score(imageUrl, brief) {
  const classifier = await getClassifier();
  const negatives = buildNegativeLabels(brief);
  const labels = [brief, ...negatives];
  const output = await classifier(imageUrl, labels);
  const items = Array.isArray(output) ? output : [];
  const positive = items.find((i) => i && i.label === brief) || { score: 0 };
  const negativesScored = items.filter((i) => i && i.label !== brief);
  const strongestNegative = negativesScored.reduce((max, i) => {
    const n = Number(i?.score || 0);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  const positiveScore = Number(positive?.score || 0);
  if (!Number.isFinite(positiveScore)) {
    return { score: 0, positiveScore: 0, strongestNegative: 0, strongestNegativeLabel: null };
  }

  // Strict score penalizes near-miss images: high positive but also high competing negative.
  const strictScore = STRICT_MODE
    ? Math.max(0, Math.min(1, positiveScore * (1 - strongestNegative)))
    : Math.max(0, Math.min(1, positiveScore));

  const strongestNegEntry = negativesScored.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0))[0];
  return {
    score: strictScore,
    positiveScore: Math.max(0, Math.min(1, positiveScore)),
    strongestNegative: Math.max(0, Math.min(1, strongestNegative)),
    strongestNegativeLabel: strongestNegEntry?.label || null,
  };
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
        const result = await score(imageUrl, brief);
        return send(res, 200, {
          ok: true,
          score: result.score,
          positive_score: result.positiveScore,
          strongest_negative_score: result.strongestNegative,
          strongest_negative_label: result.strongestNegativeLabel,
          strict_mode: STRICT_MODE,
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
