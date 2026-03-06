import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  assert(includes('src/observability/observability.gateway.ts', 'documents?:'), 'live_stats documents payload missing');
  assert(includes('src/observability/observability.gateway.ts', 'getDocumentQueueHealthStats'), 'document queue stats not wired');
  assert(includes('src/observability/observability.gateway.ts', 'artifact_type_counts'), 'artifact counts not exposed');
  assert(includes('src/observability/observability.gateway.ts', 'emitDocumentEvent('), 'canonical document event emitter missing');
  assert(includes('src/observability/observability.gateway.ts', 'event_type'), 'event_type not included in structured logs');
  assert(includes('src/observability/observability.gateway.ts', 'doc_job_id'), 'doc_job_id not included in structured logs');
  assert(includes('src/observability/observability.gateway.ts', 'getDocumentObservabilityMetrics'), 'document observability metrics not wired');
  assert(includes('src/storage/postgres-storage.service.ts', 'async getDocumentQueueHealthStats('), 'storage method missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'async getRecentDocumentJobs('), 'recent jobs method missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'async getDocumentArtifactTypeCounts('), 'artifact count method missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'async getDocumentObservabilityMetrics('), 'document metrics method missing');
  assert(includes('src/documents/intake/document-intake.service.ts', "context: 'DocumentIntake'") || includes('src/documents/intake/document-intake.service.ts', "'DocumentIntake'"), 'document intake logs missing');
  assert(includes('src/documents/intake/document-intake.service.ts', 'emitDocumentEvent'), 'document intake canonical events missing');
  assert(includes('public/dashboard/index.html', 'FLOWCHART FALLBACKS'), 'dashboard flowchart fallback metric card missing');
  assert(includes('public/dashboard/index.html', 'documentObsMetrics'), 'dashboard document metrics binding missing');
  console.log('[phase6-observability-validation] PASS');
}

run();
