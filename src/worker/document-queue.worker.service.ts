import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'os';
import { DocumentAnalysisService } from '../documents/analysis/document-analysis.service';
import { DocxTextExtractorService } from '../documents/analysis/docx-text-extractor.service';
import { VisualManifestPlannerService } from '../documents/planning/visual-manifest-planner.service';
import { ObservabilityGateway } from '../observability/observability.gateway';
import { PostgresStorageService } from '../storage/postgres-storage.service';
import { DocumentObjectKeyLayout, R2ObjectStorageService } from '../storage/object-storage';

@Injectable()
export class DocumentQueueWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentQueueWorkerService.name);
  private readonly enabled = String(process.env.DOC_PIPELINE_ENABLED || 'false').toLowerCase() === 'true';
  private readonly workerId = String(process.env.WORKER_ID || `${hostname()}-doc`).trim();
  private readonly pollMs = Math.max(500, Number(process.env.DOC_QUEUE_POLL_MS || process.env.DURABLE_QUEUE_POLL_MS || 1000));
  private readonly leaseSeconds = Math.max(30, Number(process.env.DOC_QUEUE_LEASE_SECONDS || process.env.DURABLE_QUEUE_LEASE_SECONDS || 120));
  private running = false;

  constructor(
    private readonly storage: PostgresStorageService,
    private readonly objectStorage: R2ObjectStorageService,
    private readonly analysis: DocumentAnalysisService,
    private readonly docxTextExtractor: DocxTextExtractorService,
    private readonly planner: VisualManifestPlannerService,
    private readonly observability: ObservabilityGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.storage.isEnabled()) {
      this.logger.log('Document queue worker disabled (DOC_PIPELINE_ENABLED or POSTGRES_ENABLED false).');
      return;
    }
    this.running = true;
    this.logger.log(`Starting document queue worker ${this.workerId}`);
    void this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const row = await this.storage.claimNextQueuedDocumentJob(this.workerId, this.leaseSeconds);
        if (!row) {
          await this.sleep(this.pollMs);
          continue;
        }
        await this.process(row);
      } catch (error: any) {
        this.logger.warn(`Document worker loop error: ${error?.message || error}`);
        await this.sleep(this.pollMs);
      }
    }
  }

  private async process(row: any): Promise<void> {
    const jobId = String(row?.job_id || '').trim();
    const userId = Number(row?.user_id || 0);
    if (!jobId || !userId) return;
    const meta = row?.metadata || {};
    const fileName = String(meta?.file_name || 'source.docx').trim() || 'source.docx';
    const sourceKey = String(row?.source_object_key || '').trim();
    if (!sourceKey) {
      await this.storage.updateDocumentJobState(jobId, 'failed', { error: 'Missing source object key' });
      return;
    }

    this.observability.emitLog('info', `Document worker claimed job=${jobId}`, 'DocumentWorker', undefined, undefined, {
      metadata: { user_id: userId, doc_job_id: jobId, provider_status: 'claimed' }
    });

    try {
      await this.storage.updateDocumentJobState(jobId, 'analyzing', { started_at: new Date().toISOString() });

      const sourceBytes = await this.downloadObject(sourceKey);
      const extractedText = await this.docxTextExtractor.extractPlainText(sourceBytes);
      const analysisInput = String(extractedText || '').trim();
      if (!analysisInput) {
        throw new Error('DOCX text extraction returned empty content');
      }
      const analysisResult = this.analysis.analyzeFromPlainText(analysisInput);
      await this.storage.upsertDocumentArtifact({
        jobId,
        userId,
        artifactType: 'analysis_json',
        objectKey: `inline://documents/${jobId}/analysis/analysis.json`,
        metadata: {
          ...analysisResult,
          extraction: {
            source: 'word/document.xml',
            extracted_char_count: analysisInput.length
          }
        }
      });

      await this.storage.updateDocumentJobState(jobId, 'planning');
      const planningStartedAt = Date.now();
      const planningModel =
        String(process.env.DOC_PLANNING_USE_LLM || 'true').toLowerCase() === 'true'
          ? String(process.env.DOC_PLANNING_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001')
          : 'deterministic-planner';
      this.observability.emitLog('info', `LLM planning call started job=${jobId}`, 'DocumentLLM', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'planning',
          event_type: 'stage_started',
          provider_status: 'llm_call_started',
          model: planningModel,
          anchor_count: analysisResult.anchors.length,
          context_window_count: Array.isArray(analysisResult.context_windows) ? analysisResult.context_windows.length : 0,
        }
      });
      const manifest = await this.planner.buildManifest({
        jobId,
        title: fileName.replace(/\.docx$/i, ''),
        paragraphs: analysisResult.paragraphs,
        sections: analysisResult.sections,
        anchors: analysisResult.anchors,
        contextWindows: analysisResult.context_windows,
        maxAssets: Number(process.env.DOC_MAX_ASSETS || 20),
      });
      const visuals = manifest?.lessons?.flatMap((lesson: any) => Array.isArray(lesson?.visualizations) ? lesson.visualizations : []) || [];
      const flowchartCount = visuals.filter((v: any) => String(v?.type || '') === 'flowchart').length;
      const flowchartFallbackCount = visuals.filter((v: any) => String(v?.fallback_reason || '').trim().length > 0).length;
      this.observability.emitLog('success', `LLM planning call completed job=${jobId}`, 'DocumentLLM', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'planning',
          event_type: 'stage_completed',
          provider_status: 'llm_call_completed',
          model: planningModel,
          duration_ms: Date.now() - planningStartedAt,
          visual_count: visuals.length,
          flowchart_count: flowchartCount,
          flowchart_fallback_count: flowchartFallbackCount,
        }
      });
      const validation = this.planner.validateManifest(manifest);
      if (!validation.valid) {
        this.observability.emitLog('warn', `LLM planning manifest validation failed job=${jobId}`, 'DocumentLLM', undefined, undefined, {
          metadata: {
            user_id: userId,
            doc_job_id: jobId,
            stage: 'planning',
            event_type: 'stage_failed',
            provider_status: 'llm_call_completed_with_errors',
            error_code: 'manifest_validation_failed',
            error_message: validation.errors.join('; '),
          }
        });
      }
      await this.storage.upsertDocumentManifestValidation({
        jobId,
        userId,
        manifest,
        valid: validation.valid,
        errors: validation.errors,
      });

      await this.storage.updateDocumentJobState(jobId, 'generating_assets');
      await this.storage.updateDocumentJobState(jobId, 'inserting');
      await this.storage.updateDocumentJobState(jobId, 'packaging');

      const finalKey = DocumentObjectKeyLayout.outputFinal({ jobId, fileName: 'final.docx' });
      await this.uploadObject(finalKey, sourceBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      await this.storage.upsertDocumentArtifact({
        jobId,
        userId,
        artifactType: 'final_docx',
        objectKey: finalKey,
        byteSize: sourceBytes.byteLength,
      });

      await this.storage.updateDocumentJobState(jobId, 'completed', {
        completed_at: new Date().toISOString(),
        note: 'MVP pass-through finalization completed'
      });
      this.observability.emitLog('success', `Document job completed job=${jobId}`, 'DocumentWorker', undefined, undefined, {
        metadata: { user_id: userId, doc_job_id: jobId, provider_status: 'completed' }
      });
    } catch (error: any) {
      const message = String(error?.message || error || 'Document job failed');
      await this.storage.updateDocumentJobState(jobId, 'failed', { error: message });
      this.observability.emitLog('error', `Document job failed job=${jobId}: ${message}`, 'DocumentWorker', undefined, undefined, {
        metadata: { user_id: userId, doc_job_id: jobId, provider_status: 'failed' }
      });
    }
  }

  private async downloadObject(objectKey: string): Promise<Buffer> {
    const url = this.objectStorage.getSignedDownloadUrl(objectKey, { expiresSeconds: 900 });
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Object download failed (${res.status})`);
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }

  private async uploadObject(objectKey: string, data: Buffer, contentType: string): Promise<void> {
    const url = this.objectStorage.getSignedUploadUrl(objectKey, { expiresSeconds: 900, contentType });
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Object upload failed (${res.status})`);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
