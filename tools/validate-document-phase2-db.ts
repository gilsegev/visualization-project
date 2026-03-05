import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function has(source: string, snippet: string): boolean {
  return source.includes(snippet);
}

function run(): void {
  const filePath = path.resolve(process.cwd(), 'src/storage/postgres-storage.service.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  assert(has(source, 'CREATE TABLE IF NOT EXISTS document_jobs'), 'Missing document_jobs table DDL');
  assert(has(source, 'CREATE TABLE IF NOT EXISTS document_assets'), 'Missing document_assets table DDL');
  assert(has(source, 'CREATE TABLE IF NOT EXISTS document_artifacts'), 'Missing document_artifacts table DDL');

  assert(has(source, 'CREATE UNIQUE INDEX IF NOT EXISTS ux_document_jobs_user_request_hash'), 'Missing idempotency index');
  assert(has(source, 'CREATE INDEX IF NOT EXISTS idx_document_jobs_queue_pull'), 'Missing queue pull index');
  assert(has(source, 'CREATE INDEX IF NOT EXISTS idx_document_assets_job_status'), 'Missing asset status index');
  assert(has(source, 'CREATE INDEX IF NOT EXISTS idx_document_artifacts_job_created'), 'Missing artifact index');

  assert(has(source, 'async enqueueDocumentJob('), 'Missing enqueueDocumentJob method');
  assert(has(source, 'async claimNextQueuedDocumentJob('), 'Missing claimNextQueuedDocumentJob method');
  assert(has(source, 'async updateDocumentJobState('), 'Missing updateDocumentJobState method');
  assert(has(source, 'async upsertDocumentAsset('), 'Missing upsertDocumentAsset method');
  assert(has(source, 'async upsertDocumentArtifact('), 'Missing upsertDocumentArtifact method');

  console.log('[phase2-db-validation] PASS');
}

run();
