import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  assert(includes('src/worker/document-queue.worker.service.ts', "artifactType: 'quality_report_json'"), 'quality_report_json artifact missing');
  assert(includes('src/worker/document-queue.worker.service.ts', "eventType: 'quality_scored'"), 'quality_scored event missing');
  assert(includes('src/worker/document-queue.worker.service.ts', "verdict: qualityVerdict"), 'quality verdict computation missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'async updateDocumentJobQualitySummary('), 'DB quality summary upsert missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'quality_verdict'), 'recent jobs quality verdict query missing');
  assert(includes('public/dashboard/index.html', "option value=\"needs_review\""), 'dashboard needs_review filter missing');
  assert(includes('public/dashboard/index.html', "option value=\"fail\""), 'dashboard fail filter missing');
  assert(includes('public/dashboard/index.html', 'docQualityFilter'), 'dashboard quality filter model missing');
  console.log('[phase6-step5-quality-scorecards-validation] PASS');
}

run();
