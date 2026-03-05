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
    'Night scene photo of shoreline angler preparing tackle.'
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
  assert(viz.some((v) => v.type === 'data_viz') || viz.some((v) => v.type === 'sourced_image') || viz.some((v) => v.type === 'infographic'), 'Type mapping missing');
  console.log('[phase5-planning-validation] PASS');
}

run();
