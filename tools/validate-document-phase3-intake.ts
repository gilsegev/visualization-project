import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function contains(filePath: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8').includes(snippet);
}

function run(): void {
  assert(contains('src/documents/intake/document-intake.controller.ts', "@Controller('documents/jobs')"), 'Missing documents/jobs controller');
  assert(contains('src/documents/intake/document-intake.controller.ts', "@Post(':jobId/finalize')"), 'Missing finalize route');
  assert(contains('src/documents/intake/document-intake.controller.ts', "@Get(':jobId/status')"), 'Missing status route');
  assert(contains('src/documents/intake/document-intake.controller.ts', "@Get(':jobId/download-url')"), 'Missing download route');
  assert(contains('src/documents/intake/document-intake.service.ts', 'getSignedUploadUrl('), 'Missing signed upload URL usage');
  assert(contains('src/documents/intake/document-intake.validation.ts', "'.docx'"), 'Missing .docx extension validation');
  assert(contains('src/documents/intake/document-intake.validation.ts', 'DOC_MAX_MB'), 'Missing DOC_MAX_MB size validation');
  assert(contains('src/documents/intake/document-intake.validation.ts', 'doc_version_hash'), 'Missing doc_version_hash validation');

  console.log('[phase3-intake-validation] PASS');
}

run();
