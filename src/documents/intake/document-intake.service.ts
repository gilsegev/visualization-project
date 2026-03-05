import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createDocVersionHash } from '../contracts/doc-version-hash';
import { DocumentObjectKeyLayout, R2ObjectStorageService } from '../../storage/object-storage';
import { PostgresStorageService } from '../../storage/postgres-storage.service';
import { CreateDocumentJobDto, DocumentJobStatusResponse } from './document-intake.types';
import { docxMimeType, validateCreateDocumentJobPayload, validateDocVersionHash } from './document-intake.validation';

@Injectable()
export class DocumentIntakeService {
  constructor(
    private readonly storage: PostgresStorageService,
    private readonly objectStorage: R2ObjectStorageService
  ) {}

  createJobDraft(body: CreateDocumentJobDto) {
    validateCreateDocumentJobPayload(body);
    const jobId = randomUUID();
    const uploadedAtIso = new Date().toISOString();
    const sourceObjectKey = DocumentObjectKeyLayout.inputSource({ jobId });
    const docVersionHash = createDocVersionHash({
      sourceObjectKey,
      sizeBytes: Number(body.file_size_bytes),
      uploadedAtIso
    });
    return { jobId, sourceObjectKey, docVersionHash, uploadedAtIso };
  }

  getUploadUrl(jobId: string): { upload_url: string; object_key: string } {
    const objectKey = DocumentObjectKeyLayout.inputSource({ jobId });
    const upload_url = this.objectStorage.getSignedUploadUrl(objectKey, {
      expiresSeconds: 900,
      contentType: docxMimeType()
    });
    return { upload_url, object_key: objectKey };
  }

  async finalizeUpload(userId: number, body: CreateDocumentJobDto & { job_id: string; doc_version_hash: string }) {
    validateCreateDocumentJobPayload(body);
    validateDocVersionHash(body.doc_version_hash);
    const sourceObjectKey = DocumentObjectKeyLayout.inputSource({ jobId: body.job_id });
    await this.storage.enqueueDocumentJob({
      jobId: body.job_id,
      userId,
      requestHash: body.request_hash || null,
      sourceObjectKey,
      docVersionHash: body.doc_version_hash,
      metadata: {
        file_name: body.file_name,
        file_size_bytes: Number(body.file_size_bytes),
        file_mime_type: body.file_mime_type
      }
    });
    return { message: 'Document job queued', job_id: body.job_id };
  }

  async getStatus(userId: number, jobId: string): Promise<DocumentJobStatusResponse> {
    const row = await this.storage.getDocumentJobStatusForUser(jobId, userId);
    if (!row) throw new NotFoundException('Document job not found');
    return row;
  }

  async getDownloadUrl(userId: number, jobId: string): Promise<{ download_url: string }> {
    const key = await this.storage.getDocumentArtifactKeyForUser(jobId, userId, 'final_docx');
    if (!key) throw new NotFoundException('Final document not available yet');
    return { download_url: this.objectStorage.getSignedDownloadUrl(key, { expiresSeconds: 900 }) };
  }
}
