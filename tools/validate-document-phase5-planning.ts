import { DocumentAnalysisService } from '../src/documents/analysis';
import { VisualManifestPlannerService } from '../src/documents/planning';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const analysis = new DocumentAnalysisService().analyzeFromPlainText([
    'FISHING BASICS',
    'Beginners can start with simple worm bait and bobber setup for still water.',
    'Beginners can start with simple worm bait and bobber setup for still water.',
    'Alert distribution by severity in the last 30 days shows trend shifts.',
    'Night scene photo of shoreline angler preparing tackle.',
    'Step 1. Attach bobber to line.',
    'Step 2. Hook worm and cast to target lane.',
    'Step 3. Watch drift and set hook when line dips.'
  ].join('\n\n'));

  const planner = new VisualManifestPlannerService();
  const manifest = planner.buildManifest({
    jobId: 'job-5',
    title: 'Phase 5 Plan',
    paragraphs: analysis.paragraphs,
    sections: analysis.sections,
    anchors: analysis.anchors,
    maxAssets: 2
  });

  const result = planner.validateManifest(manifest);
  assert(result.valid, `Manifest should be valid: ${result.errors.join('; ')}`);
  const viz = manifest.lessons[0].visualizations;
  assert(viz.length <= 2, 'Asset cap was not enforced');
  assert(new Set(viz.map((v) => `${v.type}|${v.description}`)).size === viz.length, 'Dedupe failed');
  assert(viz.every((v) => !!v.prompt_template), 'Prompt templates must be populated');

  const richManifest = planner.buildManifest({
    jobId: 'job-5b',
    title: 'Phase 5 Plan Rich',
    paragraphs: analysis.paragraphs,
    sections: analysis.sections,
    anchors: analysis.anchors,
    maxAssets: 10
  });
  const rich = richManifest.lessons[0].visualizations;
  assert(rich.some((v) => v.type === 'data_viz'), 'Expected data_viz mapping');
  assert(rich.some((v) => v.type === 'sourced_image'), 'Expected sourced_image mapping');
  const dataPrompt = rich.find((v) => v.type === 'data_viz')?.prompt_template || '';
  const sourcePrompt = rich.find((v) => v.type === 'sourced_image')?.prompt_template || '';
  assert(dataPrompt !== sourcePrompt, 'data_viz and sourced_image prompts must be distinct');

  const flow = rich.find((v) => v.type === 'flowchart');
  if (flow) {
    assert(flow.mermaid_valid === true, 'Flowchart visuals must pass mermaid validation');
    assert(!!flow.mermaid_code && flow.mermaid_code.includes('flowchart'), 'Flowchart mermaid code missing');
  } else {
    assert(
      rich.some((v) => v.type === 'aesthetic_anchor' && v.fallback_reason === 'mermaid_validation_failed_after_single_retry'),
      'Flowchart fallback should be explicit when mermaid validation fails'
    );
  }

  console.log('[phase5-planning-validation] PASS');
}

run();
