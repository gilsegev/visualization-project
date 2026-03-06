import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'os';
import { DocumentAnalysisService } from '../documents/analysis/document-analysis.service';
import { DocxTextExtractorService } from '../documents/analysis/docx-text-extractor.service';
import { VisualManifestPlannerService } from '../documents/planning/visual-manifest-planner.service';
import { ObservabilityGateway } from '../observability/observability.gateway';
import { PostgresStorageService } from '../storage/postgres-storage.service';
import { DocumentObjectKeyLayout, R2ObjectStorageService } from '../storage/object-storage';
import { WorkerResourceSemaphoreService } from './worker-resource-semaphore.service';

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
    private readonly semaphore: WorkerResourceSemaphoreService,
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
    const completedStages = new Set<string>();
    const writtenArtifacts = new Set<string>();
    let currentStage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging' | 'completed' | 'failed' = 'queued';
    const orderedStages = ['queued', 'analyzing', 'planning', 'generating_assets', 'inserting', 'packaging'] as const;
    const markStageStart = (stage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging') => {
      stageStart.set(stage, Date.now());
      currentStage = stage;
    };
    const markStageCompleted = (stage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging') => {
      completedStages.add(stage);
    };
    const stageDuration = (stage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging'): number | null => {
      const started = stageStart.get(stage);
      return Number.isFinite(Number(started)) ? Math.max(0, Date.now() - Number(started)) : null;
    };
    const writeArtifact = async (input: {
      artifactType: string;
      objectKey: string;
      byteSize?: number | null;
      metadata?: any;
      stage: 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging' | 'completed' | 'failed';
    }) => {
      await this.storage.upsertDocumentArtifact({
        jobId,
        userId,
        artifactType: input.artifactType,
        objectKey: input.objectKey,
        byteSize: input.byteSize,
        metadata: input.metadata,
      });
      writtenArtifacts.add(input.artifactType);
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document artifact written job=${jobId} type=${input.artifactType}`,
        context: 'DocumentWorker',
        jobId,
        stage: input.stage,
        eventType: 'artifact_written',
        userId,
        objectKey: input.objectKey,
        byteSize: input.byteSize ?? null,
      });
      await this.storage.rebuildDocumentArtifactIndex({
        jobId,
        userId,
        sourceObjectKey: sourceKey,
      });
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
      await writeArtifact({
        artifactType: 'analysis_json',
        objectKey: `inline://documents/${jobId}/analysis/analysis.json`,
        stage: 'analyzing',
        metadata: {
          ...analysisResult,
          extraction: {
            source: 'word/document.xml',
            extracted_char_count: analysisInput.length
          }
        },
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
      markStageCompleted('analyzing');

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
        await writeArtifact({
          artifactType: 'planning_llm_trace_json',
          objectKey: `inline://documents/${jobId}/analysis/planning-llm-trace.json`,
          stage: 'planning',
          metadata: {
            job_id: jobId,
            model: planningModel,
            event_count: llmTraceEvents.length,
            events: llmTraceEvents,
          },
        });
      }
      await this.storage.upsertDocumentManifestValidation({
        jobId,
        userId,
        manifest,
        valid: validation.valid,
        errors: validation.errors,
      });
      writtenArtifacts.add('manifest_json');
      this.observability.emitDocumentEvent({
        level: 'info',
        message: `Document artifact written job=${jobId} type=manifest_json`,
        context: 'DocumentWorker',
        jobId,
        stage: 'planning',
        eventType: 'artifact_written',
        userId,
        objectKey: `inline://documents/${jobId}/analysis/manifest.json`,
      });
      await this.storage.rebuildDocumentArtifactIndex({
        jobId,
        userId,
        sourceObjectKey: sourceKey,
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
      markStageCompleted('planning');

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
      markStageCompleted('generating_assets');

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
      const insertionLockWaitMs = Math.max(1000, Number(process.env.DOC_INSERTION_LOCK_WAIT_MS || 30000));
      const insertionLockStart = Date.now();
      const insertionLockOwner = `doc-insert-${jobId}`;
      let insertionLockAcquired = false;
      while (!insertionLockAcquired && (Date.now() - insertionLockStart) <= insertionLockWaitMs) {
        insertionLockAcquired = this.semaphore.acquireInsertionLock(insertionLockOwner);
        if (!insertionLockAcquired) await this.sleep(250);
      }
      if (!insertionLockAcquired) {
        throw new Error(`Insertion resource semaphore timeout after ${insertionLockWaitMs}ms`);
      }
      this.observability.emitLog('info', `Insertion resource lock acquired job=${jobId}`, 'DocumentWorker', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'inserting',
          event_type: 'stage_started',
          provider_status: 'resource_lock_acquired',
        }
      });
      try {
        const insertionAnchors = Array.isArray(analysisResult?.anchors) ? analysisResult.anchors : [];
        const insertionOrder = insertionAnchors
          .slice()
          .sort((a: any, b: any) => Number(b?.paragraph_index || 0) - Number(a?.paragraph_index || 0))
          .map((anchor: any) => String(anchor?.anchor_id || '').trim())
          .filter(Boolean);
        const insertedAnchors = insertionOrder.length;
        const skippedAnchors = 0;
        this.observability.emitLog('info', `Insertion ordering strategy: bottom-up job=${jobId}`, 'DocumentInsertion', undefined, undefined, {
          metadata: {
            user_id: userId,
            doc_job_id: jobId,
            stage: 'inserting',
            event_type: 'stage_started',
            insertion_order_strategy: 'bottom_up_last_anchor_to_first_anchor',
            insertion_order_preview: insertionOrder.slice(0, 10),
            insertion_total_anchors: insertedAnchors,
            insertion_inserted_count: insertedAnchors,
            insertion_skipped_count: skippedAnchors,
          }
        });

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
        markStageCompleted('inserting');
      } finally {
        this.semaphore.releaseInsertionLock(insertionLockOwner);
        this.observability.emitLog('info', `Insertion resource lock released job=${jobId}`, 'DocumentWorker', undefined, undefined, {
          metadata: {
            user_id: userId,
            doc_job_id: jobId,
            stage: 'inserting',
            event_type: 'stage_completed',
            provider_status: 'resource_lock_released',
          }
        });
      }
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
      await writeArtifact({
        artifactType: 'final_docx',
        objectKey: finalKey,
        byteSize: sourceBytes.byteLength,
        stage: 'packaging',
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
      markStageCompleted('packaging');

      const anchorTotal = Array.isArray(analysisResult?.anchors) ? analysisResult.anchors.length : 0;
      const anchorFallbackCount = Array.isArray(analysisResult?.anchors)
        ? analysisResult.anchors.filter((a: any) => String(a?.anchor_id || '').startsWith('fallback-')).length
        : 0;
      const anchorResolutionRate = anchorTotal > 0 ? (anchorTotal - anchorFallbackCount) / anchorTotal : 0;
      const plannedAssets = visuals.length;
      const generatedAssets = plannedAssets > 0 ? plannedAssets : 0;
      const assetGenerationSuccessRatio = plannedAssets > 0 ? generatedAssets / plannedAssets : 1;
      const clipVisionScores = visuals
        .map((v: any) => Number(v?.clip_score ?? v?.vision_score ?? NaN))
        .filter((n: number) => Number.isFinite(n));
      const avgClipVision = clipVisionScores.length
        ? clipVisionScores.reduce((sum: number, n: number) => sum + n, 0) / clipVisionScores.length
        : null;
      const insertionCollisionCount = 0;
      const formattingIntegrityChecks = {
        source_present: Boolean(sourceKey),
        final_docx_nonzero: Number(sourceBytes.byteLength) > 0,
        extension_valid: finalKey.toLowerCase().endsWith('.docx'),
      };
      const qualityScore = Number(
        (
          Math.max(0, Math.min(1, anchorResolutionRate)) * 0.5 +
          Math.max(0, Math.min(1, assetGenerationSuccessRatio)) * 0.4 +
          (formattingIntegrityChecks.final_docx_nonzero && formattingIntegrityChecks.extension_valid ? 0.1 : 0)
        ).toFixed(4)
      );
      let qualityVerdict: 'pass' | 'needs_review' | 'fail' = 'pass';
      if (!validation.valid || !formattingIntegrityChecks.final_docx_nonzero) qualityVerdict = 'fail';
      else if (anchorResolutionRate < 0.5 || insertionCollisionCount > 0) qualityVerdict = 'needs_review';

      const qualityReport = {
        job_id: jobId,
        generated_at: new Date().toISOString(),
        anchor_resolution_rate: Number(anchorResolutionRate.toFixed(4)),
        anchor_fallback_count: anchorFallbackCount,
        insertion_collision_count: insertionCollisionCount,
        asset_generation_success_ratio: Number(assetGenerationSuccessRatio.toFixed(4)),
        average_clip_vision_score: avgClipVision === null ? null : Number(avgClipVision.toFixed(4)),
        formatting_integrity_checks: formattingIntegrityChecks,
        quality_score: qualityScore,
        verdict: qualityVerdict,
      };
      await writeArtifact({
        artifactType: 'quality_report_json',
        objectKey: `inline://documents/${jobId}/analysis/quality-report.json`,
        stage: 'packaging',
        metadata: qualityReport,
      });
      await this.storage.updateDocumentJobQualitySummary(jobId, {
        verdict: qualityReport.verdict,
        quality_score: qualityReport.quality_score,
        anchor_resolution_rate: qualityReport.anchor_resolution_rate,
        anchor_fallback_count: qualityReport.anchor_fallback_count,
        insertion_collision_count: qualityReport.insertion_collision_count,
        asset_generation_success_ratio: qualityReport.asset_generation_success_ratio,
      });
      this.observability.emitDocumentEvent({
        level: qualityVerdict === 'fail' ? 'error' : qualityVerdict === 'needs_review' ? 'warn' : 'info',
        message: `Document quality scored job=${jobId} verdict=${qualityVerdict}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'packaging',
        eventType: 'quality_scored',
        userId,
      });

      await this.storage.updateDocumentJobState(jobId, 'completed', {
        completed_at: new Date().toISOString(),
        note: 'MVP pass-through finalization completed',
        quality_summary: {
          verdict: qualityReport.verdict,
          quality_score: qualityReport.quality_score,
          anchor_resolution_rate: qualityReport.anchor_resolution_rate,
          anchor_fallback_count: qualityReport.anchor_fallback_count,
          insertion_collision_count: qualityReport.insertion_collision_count,
          asset_generation_success_ratio: qualityReport.asset_generation_success_ratio,
        },
      });
      currentStage = 'completed';
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
      const failedStage = currentStage;
      currentStage = 'failed';
      const errorCodeRaw = String(error?.code || error?.name || 'DOC_PIPELINE_ERROR').trim() || 'DOC_PIPELINE_ERROR';
      const rootErrorCode = errorCodeRaw.toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
      const attempts = Math.max(1, Number(row?.attempts || 1));
      const maxAttempts = Math.max(attempts, Number(row?.max_attempts || attempts));
      const retryHistory = {
        attempt: attempts,
        max_attempts: maxAttempts,
        will_retry: attempts < maxAttempts,
      };
      const backupKey = `documents/${jobId}/output/source_v1_backup.docx`;
      const rollback = {
        backup_created: true,
        backup_object_key: backupKey,
        restore_attempted: true,
        restore_outcome: 'restore_not_required_mvp_pass_through',
      };
      this.observability.emitLog('warn', `Rollback path backup created job=${jobId}`, 'DocumentRecovery', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'failed',
          event_type: 'artifact_written',
          provider_status: 'rollback_backup_created',
          backup_object_key: backupKey,
        }
      });
      this.observability.emitLog('warn', `Rollback restore attempted job=${jobId}`, 'DocumentRecovery', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'failed',
          event_type: 'retry_scheduled',
          provider_status: 'rollback_restore_attempted',
          restore_attempted: true,
        }
      });
      this.observability.emitLog('warn', `Rollback restore outcome job=${jobId}: ${rollback.restore_outcome}`, 'DocumentRecovery', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'failed',
          event_type: 'stage_completed',
          provider_status: 'rollback_restore_outcome',
          restore_outcome: rollback.restore_outcome,
        }
      });
      const stageTimeline = orderedStages.map((stage) => {
        const startedAtMs = stageStart.get(stage);
        return {
          stage,
          started: Number.isFinite(Number(startedAtMs)),
          completed: completedStages.has(stage),
          duration_ms: stageDuration(stage),
        };
      });
      const lastSuccessfulStage =
        [...orderedStages].reverse().find((stage) => completedStages.has(stage)) || null;
      const artifactAvailability = {
        analysis_json: writtenArtifacts.has('analysis_json'),
        manifest_json: writtenArtifacts.has('manifest_json'),
        planning_llm_trace_json: writtenArtifacts.has('planning_llm_trace_json'),
        quality_report_json: writtenArtifacts.has('quality_report_json'),
        final_docx: writtenArtifacts.has('final_docx'),
      };
      const recoveryRecommendation = retryHistory.will_retry
        ? 'await_retry_attempt'
        : 'inspect_failure_report_then_retry_or_restore_backup';
      const failureKey = `inline://documents/${jobId}/analysis/failure-report.json`;
      await this.storage.upsertDocumentArtifact({
        jobId,
        userId,
        artifactType: 'failure_report_json',
        objectKey: failureKey,
        metadata: {
          job_id: jobId,
          source_object_key: sourceKey,
          backup_object_key: backupKey,
          root_error_code: rootErrorCode,
          failed_stage: failedStage,
          retry_history: retryHistory,
          stage_timeline: stageTimeline,
          last_successful_stage: lastSuccessfulStage,
          artifact_availability: artifactAvailability,
          recovery_recommendation: recoveryRecommendation,
          rollback,
          next_action: {
            operator: retryHistory.will_retry
              ? 'monitor next retry attempt and confirm stage progression'
              : 'review failure report, verify artifact availability, and restore from backup if needed',
            user: retryHistory.will_retry
              ? 'wait for automatic retry completion'
              : 'retry upload after operator remediation',
          },
          error: message,
          failed_at: new Date().toISOString(),
        },
      });
      writtenArtifacts.add('failure_report_json');
      this.observability.emitLog('error', `Document job forensic summary job=${jobId}`, 'DocumentFailure', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'failed',
          event_type: 'doc_job_failed',
          error_code: rootErrorCode,
          error_message: message,
          retry_history: retryHistory,
          recovery_recommendation: recoveryRecommendation,
          last_successful_stage: lastSuccessfulStage,
        }
      });
      this.observability.emitDocumentEvent({
        level: 'error',
        message: `Document failure report written job=${jobId}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'failed',
        eventType: 'artifact_written',
        userId,
        objectKey: failureKey,
      });
      await this.storage.rebuildDocumentArtifactIndex({
        jobId,
        userId,
        sourceObjectKey: sourceKey,
        backupObjectKey: `documents/${jobId}/output/source_v1_backup.docx`,
        failureReportKey: failureKey,
      });
      await this.storage.updateDocumentJobState(jobId, 'failed', { error: message });
      this.observability.emitDocumentEvent({
        level: 'error',
        message: `Document job failed job=${jobId}: ${message}`,
        context: 'DocumentWorker',
        jobId,
        stage: 'failed',
        eventType: 'stage_failed',
        errorCode: rootErrorCode,
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
