import { DocumentObjectKeyLayout } from '../src/storage/object-storage/object-key-layout';
import { createS3SignedUrl } from '../src/storage/object-storage/s3-presign.util';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function run(): void {
  const jobId = 'job-123';
  assert(
    DocumentObjectKeyLayout.inputSource({ jobId }) === 'documents/job-123/input/source.docx',
    'Input key layout mismatch'
  );
  assert(
    DocumentObjectKeyLayout.analysisJson({ jobId }, 'anchor-map.json') === 'documents/job-123/analysis/anchor-map.json',
    'Analysis key layout mismatch'
  );
  assert(
    DocumentObjectKeyLayout.asset({ jobId }, 'asset-1.png') === 'documents/job-123/assets/asset-1.png',
    'Asset key layout mismatch'
  );
  assert(
    DocumentObjectKeyLayout.outputFinal({ jobId }) === 'documents/job-123/output/final.docx',
    'Output key layout mismatch'
  );

  const url = createS3SignedUrl(
    'PUT',
    DocumentObjectKeyLayout.inputSource({ jobId }),
    {
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      endpoint: 'https://example.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'doc-bucket',
      forcePathStyle: true
    },
    600,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  assert(url.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'Missing algorithm query param');
  assert(url.includes('X-Amz-Signature='), 'Missing signature query param');
  assert(url.includes('/doc-bucket/documents/job-123/input/source.docx'), 'Signed URL path mismatch');
  console.log('[phase1-storage-validation] PASS');
}

run();
