import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService, SignedUrlOptions } from './object-storage.interface';
import { createS3SignedUrl, S3PresignConfig } from './s3-presign.util';

@Injectable()
export class R2ObjectStorageService implements ObjectStorageService {
  private readonly cfg: S3PresignConfig;

  constructor(private readonly config: ConfigService) {
    this.cfg = {
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY', ''),
      endpoint: this.config.get<string>('S3_ENDPOINT', ''),
      region: this.config.get<string>('S3_REGION', 'auto'),
      bucket: this.config.get<string>('S3_BUCKET', ''),
      forcePathStyle: String(this.config.get<string>('S3_FORCE_PATH_STYLE', 'true')).toLowerCase() === 'true'
    };
  }

  getSignedUploadUrl(objectKey: string, options?: SignedUrlOptions): string {
    return createS3SignedUrl('PUT', objectKey, this.cfg, options?.expiresSeconds || 900, options?.contentType);
  }

  getSignedDownloadUrl(objectKey: string, options?: SignedUrlOptions): string {
    return createS3SignedUrl('GET', objectKey, this.cfg, options?.expiresSeconds || 900);
  }
}
