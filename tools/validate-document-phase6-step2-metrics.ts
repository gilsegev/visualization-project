import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  assert(includes('src/storage/postgres-storage.service.ts', 'stage_duration_ms'), 'stage duration aggregate missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'stage_duration_p95_ms'), 'stage duration p95 missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'stage_duration_p99_ms'), 'stage duration p99 missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'retry_events_total'), 'retry counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'anchor_fallback_total'), 'anchor fallback counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'insertion_collision_total'), 'insertion collision counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'version_hash_mismatch_total'), 'version hash mismatch counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'flowchart_mermaid_invalid_total'), 'mermaid invalid counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'flowchart_mermaid_self_correct_total'), 'mermaid self-correct counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'flowchart_mermaid_fallback_total'), 'mermaid fallback counter missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'doc_jobs_inflight'), 'doc jobs inflight gauge missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'doc_jobs_queued'), 'doc jobs queued gauge missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'doc_assets_inflight'), 'doc assets inflight gauge missing');

  assert(includes('src/worker/document-queue.worker.service.ts', "eventType: 'retry_scheduled'"), 'worker retry event missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'Document stage completed: analyzing'), 'analyzing completion timer missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'Document stage completed: generating_assets'), 'generating_assets completion timer missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'Document stage completed: inserting'), 'inserting completion timer missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'Document stage completed: packaging'), 'packaging completion timer missing');

  console.log('[phase6-step2-metrics-validation] PASS');
}

run();
