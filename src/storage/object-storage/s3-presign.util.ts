import { createHash, createHmac } from 'crypto';

export interface S3PresignConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmac(key: Buffer | string, input: string): Buffer {
  return createHmac('sha256', key).update(input).digest();
}

function deriveSigningKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function toAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function createS3SignedUrl(
  method: 'GET' | 'PUT',
  objectKey: string,
  config: S3PresignConfig,
  expiresSeconds = 900,
  contentType?: string
): string {
  const now = new Date();
  const { amzDate, dateStamp } = toAmzDate(now);
  const endpoint = new URL(config.endpoint);
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const host = endpoint.host;
  const canonicalUri = config.forcePathStyle
    ? `/${config.bucket}/${encodedKey}`
    : `/${encodedKey}`;
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': contentType ? 'content-type;host' : 'host'
  });
  const canonicalHeaders = contentType
    ? `content-type:${contentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const canonicalRequest = [
    method,
    canonicalUri,
    query.toString(),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const signingKey = deriveSigningKey(config.secretAccessKey, dateStamp, config.region);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  query.set('X-Amz-Signature', signature);
  return `${endpoint.protocol}//${host}${canonicalUri}?${query.toString()}`;
}
