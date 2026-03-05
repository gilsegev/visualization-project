import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createDocVersionHash } from '../contracts/doc-version-hash';
import { DocumentObjectKeyLayout, R2ObjectStorageService } from '../../storage/object-storage';
import { PostgresStorageService } from '../../storage/postgres-storage.service';
import { CreateDocumentJobDto, DocumentJobStatusResponse } from './document-intake.types';
import { docxMimeType, validateCreateDocumentJobPayload, validateDocVersionHash } from './document-intake.validation';
import { ObservabilityGateway } from '../../observability/observability.gateway';

@Injectable()
export class DocumentIntakeService {
  constructor(
    private readonly storage: PostgresStorageService,
    private readonly objectStorage: R2ObjectStorageService,
    private readonly observability: ObservabilityGateway
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
    this.observability.emitLog('info', `Document draft created job=${jobId}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: null, doc_job_id: jobId, file_size_bytes: Number(body.file_size_bytes) }
    });
    return { jobId, sourceObjectKey, docVersionHash, uploadedAtIso };
  }

  getUploadUrl(jobId: string): { upload_url: string; object_key: string } {
    const objectKey = DocumentObjectKeyLayout.inputSource({ jobId });
    const upload_url = this.objectStorage.getSignedUploadUrl(objectKey, {
      expiresSeconds: 900,
      contentType: docxMimeType()
    });
    this.observability.emitLog('info', `Document upload URL issued job=${jobId}`, 'DocumentIntake', undefined, undefined, {
      metadata: { doc_job_id: jobId, object_key: objectKey }
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
    this.observability.emitLog('info', `Document job queued job=${body.job_id}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: body.job_id, provider_status: 'queued' }
    });
    return { message: 'Document job queued', job_id: body.job_id };
  }

  async getStatus(userId: number, jobId: string): Promise<DocumentJobStatusResponse> {
    const row = await this.storage.getDocumentJobStatusForUser(jobId, userId);
    if (!row) throw new NotFoundException('Document job not found');
    this.observability.emitLog('info', `Document job status read job=${jobId} state=${row.state}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, provider_status: row.queue_status }
    });
    return row;
  }

  async getDownloadUrl(userId: number, jobId: string): Promise<{ download_url: string }> {
    const key = await this.storage.getDocumentArtifactKeyForUser(jobId, userId, 'final_docx');
    if (!key) throw new NotFoundException('Final document not available yet');
    this.observability.emitLog('info', `Document download URL issued job=${jobId}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, object_key: key }
    });
    return { download_url: this.objectStorage.getSignedDownloadUrl(key, { expiresSeconds: 900 }) };
  }
}
