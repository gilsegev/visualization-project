import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createDocVersionHash } from '../contracts/doc-version-hash';
import { DocumentObjectKeyLayout, R2ObjectStorageService } from '../../storage/object-storage';
import { PostgresStorageService } from '../../storage/postgres-storage.service';
import { CreateDocumentJobDto, DocumentArtifactIndexResponse, DocumentArtifactResponseItem, DocumentJobStatusResponse } from './document-intake.types';
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
    this.observability.emitDocumentEvent({
      level: 'info',
      message: `Document draft created: ${jobId}`,
      context: 'DocumentIntake',
      jobId,
      stage: 'queued',
      eventType: 'stage_started',
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
    this.observability.emitDocumentEvent({
      level: 'info',
      message: `Document upload URL issued: ${jobId}`,
      context: 'DocumentIntake',
      jobId,
      stage: 'queued',
      eventType: 'artifact_written',
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
    this.observability.emitDocumentEvent({
      level: 'info',
      message: `Document job queued: ${body.job_id}`,
      context: 'DocumentIntake',
      jobId: body.job_id,
      stage: 'queued',
      eventType: 'stage_completed',
      userId,
    });
    return { message: 'Document job queued', job_id: body.job_id };
  }

  async getStatus(userId: number, jobId: string): Promise<DocumentJobStatusResponse> {
    const row = await this.storage.getDocumentJobStatusForUser(jobId, userId);
    if (!row) throw new NotFoundException('Document job not found');
    this.observability.emitLog('info', `Document job status read job=${jobId} state=${row.state}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, provider_status: row.queue_status }
    });
    this.observability.emitDocumentEvent({
      level: 'info',
      message: `Document status: ${jobId} state=${row.state} queue=${row.queue_status}`,
      context: 'DocumentIntake',
      jobId,
      stage: (row.state as any) || 'queued',
      eventType: row.state === 'failed' ? 'stage_failed' : row.state === 'completed' ? 'stage_completed' : 'stage_started',
      userId,
    });
    return row;
  }

  async getDownloadUrl(userId: number, jobId: string): Promise<{ download_url: string }> {
    const key = await this.storage.getDocumentArtifactKeyForUser(jobId, userId, 'final_docx');
    if (!key) throw new NotFoundException('Final document not available yet');
    this.observability.emitLog('info', `Document download URL issued job=${jobId}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, object_key: key }
    });
    this.observability.emitDocumentEvent({
      level: 'success',
      message: `Document download URL issued: ${jobId}`,
      context: 'DocumentIntake',
      jobId,
      stage: 'completed',
      eventType: 'artifact_written',
      userId,
    });
    return { download_url: this.objectStorage.getSignedDownloadUrl(key, { expiresSeconds: 900 }) };
  }

  async getArtifacts(userId: number, jobId: string): Promise<{ artifacts: DocumentArtifactResponseItem[] }> {
    const row = await this.storage.getDocumentJobStatusForUser(jobId, userId);
    if (!row) throw new NotFoundException('Document job not found');
    const items = await this.storage.listDocumentArtifactsForUser(jobId, userId);
    const artifacts: DocumentArtifactResponseItem[] = items.map((item) => {
      const key = String(item.object_key || '');
      const isInline = key.startsWith('inline://');
      const metadata = this.normalizeArtifactMetadata(item.metadata);
      return {
        artifact_type: item.artifact_type,
        object_key: key,
        byte_size: item.byte_size,
        checksum_sha256: item.checksum_sha256,
        metadata,
        created_at: item.created_at,
        signed_url: isInline ? null : this.objectStorage.getSignedDownloadUrl(key, { expiresSeconds: 900 }),
      };
    });
    this.observability.emitLog('info', `Document artifacts read job=${jobId} count=${artifacts.length}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, provider_status: 'artifacts' }
    });
    return { artifacts };
  }

  async getLogs(userId: number, jobId: string): Promise<{ logs: any[] }> {
    const row = await this.storage.getDocumentJobStatusForUser(jobId, userId);
    if (!row) throw new NotFoundException('Document job not found');
    const logs = await this.storage.querySystemLogs({ userId, limit: 400 });
    const filtered = (logs || []).filter((log: any) => {
      const docId = String(log?.metadata?.doc_job_id || '').trim();
      const msg = String(log?.message || '');
      return docId === jobId || msg.includes(jobId);
    });
    return { logs: filtered };
  }

  private normalizeArtifactMetadata(raw: any): any {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return { raw_text: text };
      }
    }
    return raw;
  }

  async getArtifactIndex(userId: number, jobId: string): Promise<DocumentArtifactIndexResponse> {
    const row = await this.storage.getDocumentJobStatusForUser(jobId, userId);
    if (!row) throw new NotFoundException('Document job not found');
    const sourceObjectKey = await this.storage.getDocumentJobSourceForUser(jobId, userId);
    let index = await this.storage.getDocumentArtifactIndexForUser(jobId, userId);
    if (!index) {
      index = await this.storage.rebuildDocumentArtifactIndex({
        jobId,
        userId,
        sourceObjectKey,
      });
    }
    const toLink = (key?: string | null): string | null => {
      const text = String(key || '').trim();
      if (!text || text.startsWith('inline://')) return null;
      return this.objectStorage.getSignedDownloadUrl(text, { expiresSeconds: 900 });
    };
    const links = {
      source_doc_url: toLink(index?.source_doc_key || sourceObjectKey),
      backup_doc_url: toLink(index?.backup_doc_key || null),
      failure_report_url: toLink(index?.failure_report_key || null),
      final_output_url: toLink(index?.final_output_key || null),
      manifest_url: toLink(index?.manifest_key || null),
      analysis_url: toLink(index?.analysis_key || null),
      asset_urls: Array.isArray(index?.asset_keys)
        ? index.asset_keys
            .map((key: any) => toLink(String(key || '').trim()))
            .filter((url: string | null): url is string => Boolean(url))
        : [],
    };
    this.observability.emitLog('info', `Document artifact index read job=${jobId}`, 'DocumentIntake', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, provider_status: 'artifact_index' }
    });
    return {
      index: index || {
        job_id: jobId,
        generated_at: new Date().toISOString(),
        source_doc_key: sourceObjectKey || null,
        backup_doc_key: null,
        failure_report_key: null,
        final_output_key: null,
        manifest_key: null,
        analysis_key: null,
        asset_keys: [],
        artifacts: [],
      },
      links,
    };
  }
}
