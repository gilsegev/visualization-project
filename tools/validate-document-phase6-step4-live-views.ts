import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  const dashboard = 'public/dashboard/index.html';
  assert(includes(dashboard, 'Active Jobs'), 'DOC JOBS active jobs panel missing');
  assert(includes(dashboard, 'Stage Waterfall'), 'DOC JOBS stage waterfall panel missing');
  assert(includes(dashboard, 'Failures'), 'DOC JOBS failures panel missing');
  assert(includes(dashboard, 'Throughput'), 'DOC JOBS throughput panel missing');
  assert(includes(dashboard, 'Quality'), 'DOC JOBS quality panel missing');
  assert(includes(dashboard, 'Artifact Index Links'), 'DOC JOBS artifact index links panel missing');
  assert(includes(dashboard, "fetchWithAuth(`/documents/jobs/${encodeURIComponent(id)}/artifact-index`"), 'artifact-index API fetch missing');
  assert(includes(dashboard, 'const activeDocumentJobs = computed(() => {'), 'activeDocumentJobs computed missing');
  assert(includes(dashboard, 'const docStageWaterfallRows = computed(() => {'), 'docStageWaterfallRows computed missing');
  assert(includes(dashboard, 'const docFailureSummary = computed(() => {'), 'docFailureSummary computed missing');
  assert(includes(dashboard, 'const throughputSummary = computed(() => {'), 'throughputSummary computed missing');
  assert(includes(dashboard, 'const qualitySummary = computed(() => {'), 'qualitySummary computed missing');
  console.log('[phase6-step4-live-views-validation] PASS');
}

run();
