import { DocumentAnalysisService } from '../src/documents/analysis';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const service = new DocumentAnalysisService();
  const sample = [
    'INTRODUCTION',
    'This lesson explains bait and lures for beginner anglers in practical terms.',
    'LIVE BAIT',
    'Use live bait when fish are cautious and scent is a strong trigger.',
    'LURES',
    'Use lures to cover water quickly and provoke reaction strikes.'
  ].join('\n\n');

  const a1 = service.analyzeFromPlainText(sample);
  const a2 = service.analyzeFromPlainText(sample);

  assert(a1.paragraphs.length >= 4, 'Expected paragraph extraction');
  assert(a1.sections.length >= 1, 'Expected section extraction');
  assert(a1.anchors.length >= 1, 'Expected static anchors');
  assert(a1.anchors[0].anchor_id === a2.anchors[0].anchor_id, 'Anchor map must be deterministic');

  const windows = service.buildContextWindows(a1.paragraphs, a1.anchors, 2048);
  assert(windows.length === a1.anchors.length, 'Each anchor should have one context window');
  assert(windows.every((w) => w.before_chars <= 2048 && w.after_chars <= 2048), 'Context windows must stay bounded');

  const shortDoc = service.analyzeFromPlainText('A\n\nB\n\nC');
  assert(shortDoc.used_fallback_anchor_mode, 'Expected fallback anchor mode for low-signal content');

  console.log('[phase4-analysis-validation] PASS');
}

run();
