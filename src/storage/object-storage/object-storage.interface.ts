export interface SignedUrlOptions {
  expiresSeconds?: number;
  contentType?: string;
}

export interface ObjectStorageService {
  getSignedUploadUrl(objectKey: string, options?: SignedUrlOptions): string;
  getSignedDownloadUrl(objectKey: string, options?: SignedUrlOptions): string;
}
