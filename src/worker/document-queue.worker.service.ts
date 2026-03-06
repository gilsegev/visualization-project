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

    const stageStart = new Map<string, number>();
    const markStageStart = (stage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging') => {
      stageStart.set(stage, Date.now());
    };
    const stageDuration = (stage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging'): number | null => {
      const started = stageStart.get(stage);
      return Number.isFinite(Number(started)) ? Math.max(0, Date.now() - Number(started)) : null;
    };

    this.observability.emitDocumentEvent({
      level: 'info',
      message: `Document worker claimed job=${jobId}`,
      context: 'DocumentWorker',
      jobId,
      stage: 'queued',
      eventType: 'stage_started',
      userId,
    });
    markStageStart('queued');
    if (Number(row?.attempts || 0) > 1) {
      this.observability.emitDocumentEvent({
        level: 'warn',
        message: `Document retry scheduled job=${jobId} attempt=${row?.attempts}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'queued',
        eventType: 'retry_scheduled',
        userId,
      });
    }

    try {
      await this.storage.updateDocumentJobState(jobId, 'analyzing', { started_at: new Date().toISOString() });
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage started: analyzing job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'analyzing',
        eventType: 'stage_started',
        userId,
      });
      markStageStart('analyzing');

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
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document analysis artifact written job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'analyzing',
        eventType: 'artifact_written',
        userId,
      });
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage completed: analyzing job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'analyzing',
        eventType: 'stage_completed',
        durationMs: stageDuration('analyzing'),
        userId,
      });

      await this.storage.updateDocumentJobState(jobId, 'planning');
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage started: planning job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'planning',
        eventType: 'stage_started',
        userId,
      });
      markStageStart('planning');
      const planningStartedAt = Date.now();
      const planningModel =
        String(process.env.DOC_PLANNING_USE_LLM || 'true').toLowerCase() === 'true'
          ? String(process.env.DOC_PLANNING_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001')
          : 'deterministic-planner';
      const llmTraceEvents: Array<Record<string, any>> = [];
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
        onTelemetry: (event) => {
          const stamped = { timestamp: new Date().toISOString(), ...event };
          llmTraceEvents.push(stamped);
          if (event.type === 'planner_mode') {
            this.observability.emitLog('info', `Document planning mode=${event.mode} job=${jobId}`, 'DocumentLLM', undefined, undefined, {
              metadata: {
                user_id: userId,
                doc_job_id: jobId,
                stage: 'planning',
                event_type: 'stage_started',
                provider_status: event.mode === 'llm' ? 'llm_enabled' : 'deterministic_mode',
                reason: event.reason || null,
              }
            });
            return;
          }
          if (event.type === 'llm_request') {
            this.observability.emitLog('info', `LLM planning request ready job=${jobId}`, 'DocumentLLM', undefined, undefined, {
              metadata: {
                user_id: userId,
                doc_job_id: jobId,
                stage: 'planning',
                event_type: 'artifact_written',
                provider_status: 'llm_prompt_built',
                model: event.model,
                candidate_count: event.candidate_count,
                max_assets: event.max_assets,
                system_prompt: event.system_prompt,
                user_prompt: event.user_prompt,
              }
            });
            return;
          }
          if (event.type === 'llm_response') {
            this.observability.emitLog('success', `LLM planning response received job=${jobId}`, 'DocumentLLM', undefined, undefined, {
              metadata: {
                user_id: userId,
                doc_job_id: jobId,
                stage: 'planning',
                event_type: 'stage_completed',
                provider_status: 'llm_response_received',
                model: event.model,
                duration_ms: event.duration_ms,
                prompt_tokens: event.usage.prompt_tokens,
                completion_tokens: event.usage.completion_tokens,
                total_tokens: event.usage.total_tokens,
                parsed_visual_count: event.parsed_visual_count,
                raw_response: event.raw_response,
                cleaned_response: event.cleaned_response,
              }
            });
            return;
          }
          if (event.type === 'llm_error') {
            this.observability.emitLog('error', `LLM planning error job=${jobId}: ${event.error_message}`, 'DocumentLLM', undefined, undefined, {
              metadata: {
                user_id: userId,
                doc_job_id: jobId,
                stage: 'planning',
                event_type: 'stage_failed',
                provider_status: 'llm_error',
                model: event.model,
                error_message: event.error_message,
              }
            });
          }
        }
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
      if (llmTraceEvents.length) {
        await this.storage.upsertDocumentArtifact({
          jobId,
          userId,
          artifactType: 'planning_llm_trace_json',
          objectKey: `inline://documents/${jobId}/analysis/planning-llm-trace.json`,
          metadata: {
            job_id: jobId,
            model: planningModel,
            event_count: llmTraceEvents.length,
            events: llmTraceEvents,
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
      this.observability.emitDocumentEvent({
        level: validation.valid ? 'info' : 'warn',
        message: validation.valid
          ? `Document planning completed job=${jobId}`
          : `Document planning validation warnings job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'planning',
        eventType: validation.valid ? 'stage_completed' : 'quality_scored',
        durationMs: Date.now() - planningStartedAt,
        userId,
      });

      await this.storage.updateDocumentJobState(jobId, 'generating_assets');
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage started: generating_assets job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'generating_assets',
        eventType: 'stage_started',
        userId,
      });
      markStageStart('generating_assets');
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage completed: generating_assets job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'generating_assets',
        eventType: 'stage_completed',
        durationMs: stageDuration('generating_assets'),
        userId,
      });

      await this.storage.updateDocumentJobState(jobId, 'inserting');
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage started: inserting job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'inserting',
        eventType: 'stage_started',
        userId,
      });
      markStageStart('inserting');

      await this.storage.updateDocumentJobState(jobId, 'packaging');
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage completed: inserting job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'inserting',
        eventType: 'stage_completed',
        durationMs: stageDuration('inserting'),
        userId,
      });
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage started: packaging job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'packaging',
        eventType: 'stage_started',
        userId,
      });
      markStageStart('packaging');

      const finalKey = DocumentObjectKeyLayout.outputFinal({ jobId, fileName: 'final.docx' });
      await this.uploadObject(finalKey, sourceBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      await this.storage.upsertDocumentArtifact({
        jobId,
        userId,
        artifactType: 'final_docx',
        objectKey: finalKey,
        byteSize: sourceBytes.byteLength,
      });
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document final artifact written job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'packaging',
        eventType: 'artifact_written',
        userId,
      });
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document stage completed: packaging job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'packaging',
        eventType: 'stage_completed',
        durationMs: stageDuration('packaging'),
        userId,
      });

      await this.storage.updateDocumentJobState(jobId, 'completed', {
        completed_at: new Date().toISOString(),
        note: 'MVP pass-through finalization completed'
      });
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document job completed job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'completed',
        eventType: 'stage_completed',
        userId,
      });
    } catch (error: any) {
      const message = String(error?.message || error || 'Document job failed');
      await this.storage.updateDocumentJobState(jobId, 'failed', { error: message });
      this.observability.emitDocumentEvent({
        level: 'error',
        message: `Document job failed job=${jobId}: ${message}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'failed',
        eventType: 'stage_failed',
        errorMessage: message,
        userId,
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
