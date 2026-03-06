import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  assert(includes('src/storage/postgres-storage.service.ts', 'async rebuildDocumentArtifactIndex('), 'artifact index rebuild method missing');
  assert(includes('src/storage/postgres-storage.service.ts', "artifactType: 'artifact_index_json'"), 'artifact_index_json persistence missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'async getDocumentArtifactIndexForUser('), 'artifact index read method missing');
  assert(includes('src/storage/postgres-storage.service.ts', 'async getDocumentJobSourceForUser('), 'source object key resolver missing');

  assert(includes('src/documents/intake/document-intake.controller.ts', "@Get(':jobId/artifact-index')"), 'artifact-index route missing');
  assert(includes('src/documents/intake/document-intake.service.ts', 'async getArtifactIndex('), 'artifact-index service missing');
  assert(includes('src/documents/intake/document-intake.service.ts', 'getSignedDownloadUrl'), 'deep-link signed url resolver missing');

  assert(includes('src/worker/document-queue.worker.service.ts', 'eventType: \'artifact_written\''), 'artifact_written events missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'objectKey: input.objectKey'), 'artifact_written object key metadata missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'byteSize: input.byteSize'), 'artifact_written byte size metadata missing');
  assert(includes('src/worker/document-queue.worker.service.ts', "artifactType: 'failure_report_json'"), 'failure report artifact missing');

  assert(includes('src/observability/observability.gateway.ts', 'object_key'), 'gateway object_key metadata missing');
  assert(includes('src/observability/observability.gateway.ts', 'byte_size'), 'gateway byte_size metadata missing');

  console.log('[phase6-step3-artifact-index-validation] PASS');
}

run();
