const http = require('http');
const { assertRuntimeEnv } = require('../runtime-env-validate');

const PORT = Number(process.env.IQC_PORT || process.env.CLIP_SCORER_PORT || 4310);
const HOST = process.env.IQC_HOST || process.env.CLIP_SCORER_HOST || '0.0.0.0';
const MODEL = process.env.IQC_CLIP_MODEL || process.env.CLIP_SCORER_MODEL || 'Xenova/clip-vit-base-patch32';
const STRICT_MODE = String(process.env.IQC_CLIP_STRICT_MODE || process.env.CLIP_STRICT_MODE || 'true').toLowerCase() === 'true';
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = String(
  process.env.IQC_VISION_MODEL || process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
).trim();
process.env.IQC_PORT = String(PORT);
process.env.OPENROUTER_MODEL = OPENROUTER_MODEL;
process.env.OPENROUTER_VISION_MODEL = String(process.env.OPENROUTER_VISION_MODEL || process.env.IQC_VISION_MODEL || OPENROUTER_MODEL).trim();
assertRuntimeEnv('iqc');

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
  const isFishing = /\b(angler|fish|fishing|hook|lake|river|boat|dock|shore)\b/.test(lower);
  const isReleaseScene = /\b(release|releasing|catch and release|wet hands|handling)\b/.test(lower);

  if (isFishing) {
    negatives.push('an alligator or crocodile in a swamp');
    negatives.push('an indoor scene unrelated to fishing activity');
    negatives.push('a city street scene with no water and no fishing gear');
    if (isReleaseScene) {
      negatives.push('fishing rods and gear only, with no person releasing a fish');
      negatives.push('a person holding an unrelated object outdoors');
    }
  }
  if (/\b(ddr|ram|memory|motherboard|pc|computer|cpu|gpu)\b/.test(lower)) {
    negatives.push('an animal outdoors');
    negatives.push('a person in nature');
    negatives.push('a scenic landscape photo');
  }

  return [...new Set(negatives)];
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

async function clipScore(imageUrl, brief) {
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

  const strictScore = STRICT_MODE
    ? clamp(positiveScore * (1 - strongestNegative), 0, 1)
    : clamp(positiveScore, 0, 1);
  const strongestNegEntry = negativesScored.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0))[0];
  return {
    score: strictScore,
    positiveScore: clamp(positiveScore, 0, 1),
    strongestNegative: clamp(strongestNegative, 0, 1),
    strongestNegativeLabel: strongestNegEntry?.label || null,
  };
}

function extractJson(raw) {
  const trimmed = String(raw || '').replace(/```json|```/g, '').trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch {
    return null;
  }
}

async function visionScore(imageUrl, brief, domain = '', style = '') {
  if (!OPENROUTER_API_KEY) {
    return { score: 75, reason: 'OPENROUTER_API_KEY unavailable; vision gate bypassed with neutral pass score.' };
  }
  const prompt = [
    `Brief: ${brief}`,
    `Primary domain: ${domain || 'general'}`,
    `Style guide: ${style || 'Muted, clean, non-clinical educational visual.'}`,
    'If domain is fishing and image shows athletes, stadium, rugby, or team sports, set sports_scene=true.',
  ].join('\n');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://visualization-project.local',
      'X-Title': 'Visualization Project IQC',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0,
      max_tokens: 260,
      messages: [
        {
          role: 'system',
          content:
            'You are an image quality gate for sourced stock photos. Score 0-100 by rubric: semantic relevance to brief 70, visual clarity/composition 20, safety appropriateness 10. Do NOT penalize for missing brand palette, illustration style, or non-minimalist photo texture. Return JSON only: {"score": number, "reason": "short string", "sports_scene": boolean}.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`openrouter_http_${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(raw) || {};
  const score = clamp(Number(parsed?.score || 0), 0, 100);
  const reason = String(parsed?.reason || 'No reason provided').slice(0, 280);
  const sportsScene = Boolean(parsed?.sports_scene) || /athlete|stadium|team sport|rugby|soccer|football/i.test(reason);
  if (domain === 'fishing' && sportsScene) {
    return { score: 0, reason: 'Rejected by domain hardening: sports scene detected for fishing domain.' };
  }
  if (!Number.isFinite(score)) return { score: 0, reason: 'Vision gate returned non-numeric score.' };
  return { score, reason };
}

function computeComposite({
  clip,
  vision,
  clipWeight = 0.7,
  clipThreshold = 0.65,
  disableClip = false,
  disableVision = false,
}) {
  const w = clamp(Number.isFinite(clipWeight) ? clipWeight : 0.7, 0.1, 0.9);
  const visionWeight = 1 - w;
  const clipPass = disableClip || clip >= clipThreshold;
  const visionNorm = clamp(vision / 100, 0, 1);
  const visionThreshold = disableVision ? 0 : (clip >= 0.8 ? 35 : clip >= 0.7 ? 45 : clip >= 0.6 ? 55 : 65);
  const visionPass = disableVision || vision >= visionThreshold;
  return {
    weighted_score: (clip * w) + (visionNorm * visionWeight),
    clip_pass: clipPass,
    vision_pass: visionPass,
    vision_threshold: visionThreshold,
    accepted: clipPass && visionPass,
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

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, {
      ok: true,
      service: 'image-quality-control',
      clip_model: MODEL,
      vision_model: OPENROUTER_MODEL,
      vision_enabled: Boolean(OPENROUTER_API_KEY),
    });
  }

  if (req.method !== 'POST') {
    return send(res, 404, { ok: false, error: 'not found' });
  }

  try {
    const payload = await readJson(req);
    const imageUrl = String(payload.imageUrl || '').trim();

    if (req.url === '/score' || req.url === '/score/clip') {
      const brief = String(payload.brief || '').trim();
      if (!imageUrl || !brief) return send(res, 400, { ok: false, error: 'imageUrl and brief are required' });
      const startedAt = Date.now();
      const result = await clipScore(imageUrl, brief);
      const responseBody = {
        ok: true,
        score: result.score,
        positive_score: result.positiveScore,
        strongest_negative_score: result.strongestNegative,
        strongest_negative_label: result.strongestNegativeLabel,
        strict_mode: STRICT_MODE,
        latency_ms: Date.now() - startedAt,
        model: MODEL,
      };
      console.log(`[iqc] /score/clip latency=${responseBody.latency_ms}ms score=${Number(responseBody.score).toFixed(4)}`);
      return send(res, 200, responseBody);
    }

    if (req.url === '/score/vision') {
      const brief = String(payload.brief || '').trim();
      const domain = String(payload.domain || '').trim();
      const style = String(payload.style || '').trim();
      if (!imageUrl || !brief) return send(res, 400, { ok: false, error: 'imageUrl and brief are required' });
      const startedAt = Date.now();
      const result = await visionScore(imageUrl, brief, domain, style);
      const responseBody = {
        ok: true,
        score: result.score,
        reason: result.reason,
        latency_ms: Date.now() - startedAt,
        model: OPENROUTER_MODEL,
      };
      console.log(`[iqc] /score/vision latency=${responseBody.latency_ms}ms score=${Number(responseBody.score).toFixed(2)}`);
      return send(res, 200, responseBody);
    }

    if (req.url === '/score/composite') {
      const brief = String(payload.brief || '').trim();
      const domain = String(payload.domain || '').trim();
      const style = String(payload.style || '').trim();
      const clipWeight = Number(payload.clipWeight);
      const clipThreshold = Number(payload.clipThreshold);
      const disableClip = String(payload.disableClip || 'false').toLowerCase() === 'true';
      const disableVision = String(payload.disableVision || 'false').toLowerCase() === 'true';
      if (!imageUrl || !brief) return send(res, 400, { ok: false, error: 'imageUrl and brief are required' });

      const startedAt = Date.now();
      const clip = disableClip ? { score: 0.5 } : await clipScore(imageUrl, brief);
      let vision;
      try {
        vision = disableVision ? { score: 75, reason: 'Vision gate disabled by config.' } : await visionScore(imageUrl, brief, domain, style);
      } catch (error) {
        vision = { score: 75, reason: `Vision gate unavailable: ${String(error?.message || error)}` };
      }
      const composite = computeComposite({
        clip: Number(clip.score || 0),
        vision: Number(vision.score || 0),
        clipWeight,
        clipThreshold,
        disableClip,
        disableVision,
      });
      const responseBody = {
        ok: true,
        clip_score: Number(clip.score || 0),
        vision_score: Number(vision.score || 0),
        vision_reason: String(vision.reason || ''),
        ...composite,
        latency_ms: Date.now() - startedAt,
      };
      console.log(
        `[iqc] /score/composite latency=${responseBody.latency_ms}ms clip=${Number(responseBody.clip_score).toFixed(4)} vision=${Number(
          responseBody.vision_score,
        ).toFixed(2)} accepted=${responseBody.accepted}`,
      );
      return send(res, 200, responseBody);
    }
  } catch (error) {
    console.error(`[iqc] request failed path=${req.url} err=${String(error?.message || error)}`);
    return send(res, 500, { ok: false, error: String(error?.message || error) });
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[image-quality-control] listening on http://${HOST}:${PORT}`);
});
