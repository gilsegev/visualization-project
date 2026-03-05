import {
  DOCUMENT_MANIFEST_VERSION,
  assertDocumentJobTransition,
  canTransitionDocumentJobState,
  createDocVersionHash
} from '../src/documents';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  assert(DOCUMENT_MANIFEST_VERSION === 1, 'Manifest version must be 1');

  assert(canTransitionDocumentJobState('queued', 'analyzing'), 'queued -> analyzing should be valid');
  assert(canTransitionDocumentJobState('inserting', 'packaging'), 'inserting -> packaging should be valid');
  assert(!canTransitionDocumentJobState('queued', 'packaging'), 'queued -> packaging should be invalid');

  assertDocumentJobTransition('planning', 'generating_assets');
  let invalidRaised = false;
  try {
    assertDocumentJobTransition('completed', 'queued');
  } catch {
    invalidRaised = true;
  }
  assert(invalidRaised, 'Invalid transition should throw');

  const hashA = createDocVersionHash({
    sourceObjectKey: 'documents/job-1/input/source.docx',
    eTag: 'etag-a',
    sizeBytes: 1234,
    uploadedAtIso: '2026-03-04T00:00:00.000Z'
  });
  const hashB = createDocVersionHash({
    sourceObjectKey: 'documents/job-1/input/source.docx',
    eTag: 'etag-a',
    sizeBytes: 1234,
    uploadedAtIso: '2026-03-04T00:00:00.000Z'
  });
  const hashC = createDocVersionHash({
    sourceObjectKey: 'documents/job-1/input/source.docx',
    eTag: 'etag-b',
    sizeBytes: 1234,
    uploadedAtIso: '2026-03-04T00:00:00.000Z'
  });

  assert(hashA === hashB, 'DOC_VERSION_HASH should be deterministic');
  assert(hashA !== hashC, 'DOC_VERSION_HASH should change when source metadata changes');
  console.log('[phase0-validation] PASS');
}

run();
