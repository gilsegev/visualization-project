import { DocumentAnalysisService } from '../src/documents/analysis';
import { VisualManifestPlannerService } from '../src/documents/planning';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  process.env.DOC_PLANNING_USE_LLM = 'false';
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
  const manifest = await planner.buildManifest({
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

  const richManifest = await planner.buildManifest({
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

  const customManifest = await planner.buildManifest({
    jobId: 'job-5c',
    title: 'Context Window Route',
    paragraphs: [{
      xml_path_id: '/w:document/w:body/w:p[1]',
      paragraph_hash: 'p1',
      text: 'General process overview',
      index: 0,
      has_sequence: false,
      has_data: false,
      has_entity: false,
      text_density: 0.4,
      sequence_group_id: null,
    }],
    sections: [{
      section_id: 'section-1',
      heading: 'Overview',
      paragraph_start: 0,
      paragraph_end: 0,
    }],
    anchors: [{
      anchor_id: 'anchor-1-test',
      xml_path_id: '/w:document/w:body/w:p[1]',
      paragraph_hash: 'p1',
      paragraph_index: 0,
      confidence: 0.7,
      reason: 'paragraph_length_signal',
    }],
    contextWindows: [{
      anchor_id: 'anchor-1-test',
      before_chars: 0,
      after_chars: 0,
      content: 'Step 1. Prepare line. Step 2. Cast safely. Step 3. Set hook.',
      paragraph_start_index: 0,
      paragraph_end_index: 0,
      window_mode: 'bounded',
    }],
    maxAssets: 1
  });
  const customType = customManifest.lessons[0].visualizations[0]?.type;
  assert(customType === 'flowchart' || customType === 'aesthetic_anchor', 'Context window should drive procedural routing');

  const mixedDoc = new DocumentAnalysisService().analyzeFromPlainText([
    'ScribeFlow Integration Test Document',
    'Introduction. The goal of this document is to provide a Gold Standard test case.',
    'Step 1: Calibrate the CNC machine. Step 2: Secure the workpiece. Step 3: Load the G-code file. Step 4: Verify spindle speed.',
    'Results. Q1: 12 units per hour. Q2: 20 units per hour. Q3: 18 units per hour.',
    'Atmospheric Context. The workshop glowed with warm amber light and cedar-scented smoke drifted near the bench.'
  ].join('\n\n'));
  const mixedManifest = await planner.buildManifest({
    jobId: 'job-5d',
    title: 'Mixed Intent Doc',
    paragraphs: mixedDoc.paragraphs,
    sections: mixedDoc.sections,
    anchors: mixedDoc.anchors,
    contextWindows: mixedDoc.context_windows,
    maxAssets: 6
  });
  const mixedVisuals = mixedManifest.lessons[0].visualizations;
  assert(mixedVisuals.some((v) => v.type === 'flowchart' || v.type === 'aesthetic_anchor'), 'Expected procedural route in mixed doc');
  assert(mixedVisuals.some((v) => v.type === 'data_viz'), 'Expected data route in mixed doc');
  assert(mixedVisuals.some((v) => v.type === 'sourced_image'), 'Expected atmospheric route in mixed doc');
  const flowcharts = mixedVisuals.filter((v) => v.type === 'flowchart');
  assert(flowcharts.length <= 1, 'Overlap dedupe should avoid duplicate flowcharts for one sequence range');
  for (const f of flowcharts) {
    assert(String(f.description || '').length <= 500, 'Flowchart description should be capped');
  }

  console.log('[phase5-planning-validation] PASS');
}

void run();
