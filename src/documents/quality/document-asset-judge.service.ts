import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

export type AssetJudgeVerdict = {
  enabled: boolean;
  passed: boolean;
  score: number | null;
  reason: string;
  model: string | null;
  concerns: string[];
};

@Injectable()
export class DocumentAssetJudgeService {
  private readonly logger = new Logger(DocumentAssetJudgeService.name);
  private readonly openai: OpenAI | null;
  private readonly model: string;
  private readonly threshold: number;

  constructor() {
    const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
    this.openai = apiKey
      ? new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
          defaultHeaders: {
            'HTTP-Referer': 'https://visualization-project.local',
            'X-Title': 'Visualization Project Asset Judge',
          },
        })
      : null;
    this.model = String(process.env.DOC_ASSET_JUDGE_MODEL || 'openai/gpt-4o-mini').trim();
    this.threshold = Math.max(1, Math.min(100, Number(process.env.DOC_ASSET_JUDGE_MIN_SCORE || 60)));
  }

  async judge(input: {
    imageBytes: Buffer;
    extension: string;
    visualType: string;
    prompt: string;
  }): Promise<AssetJudgeVerdict> {
    if (!this.openai) {
      return {
        enabled: false,
        passed: true,
        score: null,
        reason: 'judge_disabled_no_openrouter_api_key',
        model: null,
        concerns: [],
      };
    }
    try {
      const mime = this.mimeType(input.extension);
      const base64 = input.imageBytes.toString('base64');
      const userPrompt = [
        'Assess this generated visualization quality.',
        `Target visual type: ${String(input.visualType || '').trim().toLowerCase()}`,
        `Prompt intent: ${String(input.prompt || '').trim()}`,
        'Return JSON only with keys: score (0-100), pass (boolean), reason (string), concerns (string[]).',
        'Focus on: semantic relevance, readability, text gore/gibberish, placeholder artifacts, and chart/diagram fidelity.',
      ].join('\n');
      const completion: any = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        max_tokens: 320,
        response_format: { type: 'text' },
        messages: [
          {
            role: 'system',
            content: 'You are a strict visual quality judge for generated document assets.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
      });
      const raw = String(completion?.choices?.[0]?.message?.content || '').trim();
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned || '{}');
      const score = Number(parsed?.score);
      const normalizedScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
      const concerns = Array.isArray(parsed?.concerns)
        ? parsed.concerns.map((v: any) => String(v || '').trim()).filter(Boolean).slice(0, 8)
        : [];
      const passed = Boolean(parsed?.pass) && normalizedScore >= this.threshold;
      return {
        enabled: true,
        passed,
        score: normalizedScore,
        reason: String(parsed?.reason || '').trim() || (passed ? 'judge_pass' : 'judge_failed'),
        model: this.model,
        concerns,
      };
    } catch (error: any) {
      this.logger.warn(`Asset judge failed; allowing asset by fallback policy: ${error?.message || error}`);
      return {
        enabled: true,
        passed: true,
        score: null,
        reason: `judge_error_fallback_allow:${String(error?.message || error)}`,
        model: this.model,
        concerns: [],
      };
    }
  }

  private mimeType(ext: string): string {
    const key = String(ext || '').trim().toLowerCase();
    if (key === '.jpg' || key === '.jpeg') return 'image/jpeg';
    if (key === '.webp') return 'image/webp';
    return 'image/png';
  }
}

