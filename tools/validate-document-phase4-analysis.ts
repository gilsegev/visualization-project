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
  assert(
    windows
      .filter((w) => w.window_mode === 'bounded')
      .every((w) => w.before_chars <= 2048 && w.after_chars <= 2048),
    'Bounded context windows must stay within radius'
  );

  const shortDoc = service.analyzeFromPlainText('A\n\nB\n\nC');
  assert(shortDoc.used_fallback_anchor_mode, 'Expected fallback anchor mode for low-signal content');

  const sequenceDoc = [
    'PROCESS',
    'Step 1. Prepare your setup and inspect your line.',
    'Step 2. Cast upstream and let bait drift naturally.',
    'Step 3. Watch line movement and set hook on tension.',
    'Step 4. Land fish safely and release if required.'
  ].join('\n\n');
  const seq = service.analyzeFromPlainText(sequenceDoc);
  const step2 = seq.anchors.find((a) => seq.paragraphs[a.paragraph_index]?.text.startsWith('Step 2.'));
  assert(!!step2, 'Expected anchor for sequence paragraph');
  const seqWindow = service.buildContextWindows(seq.paragraphs, [step2!], 60)[0];
  assert(seqWindow.window_mode === 'sequence_expanded', 'High-sequence anchors should use sequence-expanded windows');
  assert(seqWindow.content.includes('Step 1.'), 'Expanded sequence window must include start of sequence');
  assert(seqWindow.content.includes('Step 4.'), 'Expanded sequence window must include end of sequence');

  const withSignals = seq.paragraphs.some((p) => p.has_sequence || p.has_data || p.has_entity);
  assert(withSignals, 'Expected deterministic signal extraction metadata');

  console.log('[phase4-analysis-validation] PASS');
}

run();
