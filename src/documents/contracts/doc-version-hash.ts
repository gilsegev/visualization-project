import { createHash } from 'crypto';

export interface DocVersionHashInput {
  sourceObjectKey: string;
  eTag?: string;
  sizeBytes: number;
  uploadedAtIso: string;
}

export function createDocVersionHash(input: DocVersionHashInput): string {
  const payload = JSON.stringify({
    sourceObjectKey: input.sourceObjectKey,
    eTag: input.eTag || '',
    sizeBytes: input.sizeBytes,
    uploadedAtIso: input.uploadedAtIso
  });
  return createHash('sha256').update(payload).digest('hex');
}
