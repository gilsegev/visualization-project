import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import { hostname } from 'os';
import * as path from 'path';
import sharp = require('sharp');
import { DocumentAnalysisService } from '../documents/analysis/document-analysis.service';
import { DocxTextExtractorService } from '../documents/analysis/docx-text-extractor.service';
import { DocxSurgicalInserterService } from '../documents/insertion/docx-surgical-inserter.service';
import { VisualManifestPlannerService } from '../documents/planning/visual-manifest-planner.service';
import { DocumentAssetJudgeService } from '../documents/quality/document-asset-judge.service';
import { ImageStrategyFactory } from '../image-gen/image-strategy.factory';
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
  private readonly staleRecoveryMinutes = Math.max(2, Number(process.env.DOC_QUEUE_STALE_RECOVERY_MINUTES || 10));
  private readonly staleRecoveryEveryMs = Math.max(10000, Number(process.env.DOC_QUEUE_STALE_RECOVERY_EVERY_MS || 30000));
  private running = false;
  private lastStaleRecoveryAt = 0;

  constructor(
    private readonly storage: PostgresStorageService,
    private readonly objectStorage: R2ObjectStorageService,
    private readonly analysis: DocumentAnalysisService,
    private readonly docxTextExtractor: DocxTextExtractorService,
    private readonly inserter: DocxSurgicalInserterService,
    private readonly planner: VisualManifestPlannerService,
    private readonly assetJudge: DocumentAssetJudgeService,
    private readonly strategyFactory: ImageStrategyFactory,
    private readonly observability: ObservabilityGateway,
    private readonly semaphore: WorkerResourceSemaphoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.storage.isEnabled()) {
      this.logger.log('Document queue worker disabled (DOC_PIPELINE_ENABLED or POSTGRES_ENABLED false).');
      return;
    }
    try {
      const recovered = await this.storage.requeueOrphanedProcessingDocumentJobs(
        Math.max(2, Number(process.env.DOC_QUEUE_STALE_RECOVERY_MINUTES || 10)),
      );
      if (recovered > 0) {
        this.logger.warn(`Recovered stale document jobs: ${recovered}`);
      }
    } catch (error: any) {
      this.logger.warn(`Document stale-recovery failed: ${error?.message || error}`);
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
        const now = Date.now();
        if (now - this.lastStaleRecoveryAt > this.staleRecoveryEveryMs) {
          this.lastStaleRecoveryAt = now;
          const recovered = await this.storage.requeueOrphanedProcessingDocumentJobs(this.staleRecoveryMinutes);
          if (recovered > 0) {
            this.logger.warn(`Recovered stale document jobs during loop: ${recovered}`);
          }
        }
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
    const backupKey = DocumentObjectKeyLayout.outputFinal({ jobId }, 'source_v1_backup.docx');
    if (!sourceKey) {
      await this.storage.updateDocumentJobState(jobId, 'failed', { error: 'Missing source object key' });
      return;
    }

    const stageStart = new Map<string, number>();
    const completedStages = new Set<string>();
    const writtenArtifacts = new Set<string>();
    let backupCreated = false;
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
        backupObjectKey: backupCreated ? backupKey : undefined,
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
      const extractedParagraphs = await this.docxTextExtractor.extractParagraphNodes(sourceBytes);
      if (!Array.isArray(extractedParagraphs) || extractedParagraphs.length === 0) {
        throw new Error('DOCX text extraction returned empty content');
      }
      const analysisResult = this.analysis.analyzeFromDocxParagraphs(extractedParagraphs);
      await writeArtifact({
        artifactType: 'analysis_json',
        objectKey: `inline://documents/${jobId}/analysis/analysis.json`,
        stage: 'analyzing',
        metadata: {
          ...analysisResult,
          extraction: {
            source: 'word/document.xml',
            extracted_char_count: extractedParagraphs.reduce((sum, p) => sum + String(p?.text || '').length, 0),
            extracted_paragraph_count: extractedParagraphs.length,
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
      const validation = this.planner.validateManifest(manifest, { anchors: analysisResult.anchors || [] });
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
      const assetSummary = await this.generateAssetsFromManifest({
        jobId,
        userId,
        manifest,
        writeArtifact,
      });
      this.observability.emitLog('info', `Document assets generated job=${jobId} success=${assetSummary.success} failed=${assetSummary.failed}`, 'DocumentWorker', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'generating_assets',
          event_type: 'stage_completed',
          provider_status: 'assets_generated',
          generated_assets_total: assetSummary.success,
          generated_assets_failed: assetSummary.failed,
        }
      });
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
      let outputDocxBytes = sourceBytes;
      let insertionSummary: {
        captions_planned: number;
        captions_inserted: number;
        captions_skipped: number;
      } = {
        captions_planned: 0,
        captions_inserted: 0,
        captions_skipped: 0,
      };
      try {
        if (!backupCreated) {
          await this.uploadObject(backupKey, sourceBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          backupCreated = true;
          await writeArtifact({
            artifactType: 'backup_docx',
            objectKey: backupKey,
            byteSize: sourceBytes.byteLength,
            stage: 'inserting',
            metadata: {
              immutable_backup: true,
              created_before_first_edit: true,
            },
          });
        }
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
        const insertionResult = await this.inserter.insertVisuals({
          sourceBytes,
          manifest,
          anchors: analysisResult.anchors || [],
          assets: await this.loadInsertionAssetsForJob({
            jobId,
            userId,
            generated: assetSummary.generatedAssets,
          }),
        });
        insertionSummary = {
          captions_planned: Number((insertionResult as any)?.surgicalLog?.captions_planned || 0),
          captions_inserted: Number((insertionResult as any)?.surgicalLog?.captions_inserted || 0),
          captions_skipped: Number((insertionResult as any)?.surgicalLog?.captions_skipped || 0),
        };
        outputDocxBytes = insertionResult.outputBytes;
        await writeArtifact({
          artifactType: 'surgical_log_json',
          objectKey: `inline://documents/${jobId}/analysis/surgical-log.json`,
          stage: 'inserting',
          metadata: insertionResult.surgicalLog,
        });
        this.observability.emitLog('info', `Surgical insertion completed job=${jobId} inserted=${insertionResult.surgicalLog.inserted} skipped=${insertionResult.surgicalLog.skipped}`, 'DocumentInsertion', undefined, undefined, {
          metadata: {
            user_id: userId,
            doc_job_id: jobId,
            stage: 'inserting',
            event_type: 'stage_completed',
            insertion_strategy: insertionResult.surgicalLog.strategy,
            inserted_count: insertionResult.surgicalLog.inserted,
            skipped_count: insertionResult.surgicalLog.skipped,
            collision_count: insertionResult.surgicalLog.collisions,
            planned_visuals: Number((insertionResult as any)?.surgicalLog?.planned || 0),
            resolved_visuals: Number((insertionResult as any)?.surgicalLog?.resolved || 0),
            inserted_visuals: Number((insertionResult as any)?.surgicalLog?.inserted || 0),
            skipped_visuals: Number((insertionResult as any)?.surgicalLog?.skipped || 0),
            placement_conflicts: Number((insertionResult as any)?.surgicalLog?.placement_conflicts || 0),
            list_block_adjustments: Number((insertionResult as any)?.surgicalLog?.list_block_adjustments || 0),
            heading_avoidance_adjustments: Number((insertionResult as any)?.surgicalLog?.heading_avoidance_adjustments || 0),
            snap_to_grid_adjustments: Number((insertionResult as any)?.surgicalLog?.snap_to_grid_adjustments || 0),
            captions_planned: Number((insertionResult as any)?.surgicalLog?.captions_planned || 0),
            captions_inserted: Number((insertionResult as any)?.surgicalLog?.captions_inserted || 0),
            captions_skipped: Number((insertionResult as any)?.surgicalLog?.captions_skipped || 0),
          }
        });
        if (assetSummary.success > 0 && Number(insertionResult?.surgicalLog?.inserted || 0) === 0) {
          this.observability.emitLog('warn', `Insertion resolved zero visuals despite generated assets job=${jobId}`, 'DocumentInsertion', undefined, undefined, {
            metadata: {
              user_id: userId,
              doc_job_id: jobId,
              stage: 'inserting',
              event_type: 'stage_failed',
              provider_status: 'placement_resolution_empty',
              generated_assets_total: assetSummary.success,
              insertion_planned_count: Number(insertionResult?.surgicalLog?.planned || 0),
              insertion_resolved_count: Number((insertionResult as any)?.surgicalLog?.resolved || 0),
              insertion_inserted_count: Number(insertionResult?.surgicalLog?.inserted || 0),
            }
          });
        }

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

      const finalFileName = `final-${Date.now()}.docx`;
      const finalKey = DocumentObjectKeyLayout.outputFinal({ jobId, fileName: finalFileName });
      await this.uploadObject(finalKey, outputDocxBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      await writeArtifact({
        artifactType: 'final_docx',
        objectKey: finalKey,
        byteSize: outputDocxBytes.byteLength,
        stage: 'packaging',
        metadata: {
          file_name: finalFileName,
          versioned_output: true,
        },
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
        final_docx_nonzero: Number(outputDocxBytes.byteLength) > 0,
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
        captions_planned: insertionSummary.captions_planned,
        captions_inserted: insertionSummary.captions_inserted,
        captions_skipped: insertionSummary.captions_skipped,
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
      const rollback = {
        backup_created: backupCreated,
        backup_object_key: backupKey,
        restore_attempted: backupCreated,
        restore_outcome: backupCreated ? 'restored_final_pointer_to_backup' : 'backup_unavailable',
      };
      this.observability.emitLog(backupCreated ? 'warn' : 'error', backupCreated ? `Rollback path backup created job=${jobId}` : `Rollback path backup missing job=${jobId}`, 'DocumentRecovery', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'failed',
          event_type: 'artifact_written',
          provider_status: backupCreated ? 'rollback_backup_created' : 'rollback_backup_missing',
          backup_object_key: backupKey,
        }
      });
      this.observability.emitLog(backupCreated ? 'warn' : 'error', backupCreated ? `Rollback restore attempted job=${jobId}` : `Rollback restore skipped (backup unavailable) job=${jobId}`, 'DocumentRecovery', undefined, undefined, {
        metadata: {
          user_id: userId,
          doc_job_id: jobId,
          stage: 'failed',
          event_type: 'retry_scheduled',
          provider_status: backupCreated ? 'rollback_restore_attempted' : 'rollback_restore_skipped',
          restore_attempted: backupCreated,
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
        backup_docx: writtenArtifacts.has('backup_docx'),
        surgical_log_json: writtenArtifacts.has('surgical_log_json'),
        quality_report_json: writtenArtifacts.has('quality_report_json'),
        final_docx: writtenArtifacts.has('final_docx'),
      };
      const recoveryRecommendation = retryHistory.will_retry
        ? 'await_retry_attempt'
        : 'inspect_failure_report_then_retry_or_restore_backup';
      if (backupCreated) {
        await this.storage.upsertDocumentArtifact({
          jobId,
          userId,
          artifactType: 'final_docx',
          objectKey: backupKey,
          metadata: {
            recovery_mode: 'backup_pointer',
            recovery_reason: message,
          },
        });
        writtenArtifacts.add('final_docx');
      }
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
        backupObjectKey: backupKey,
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

  private async generateAssetsFromManifest(input: {
    jobId: string;
    userId: number;
    manifest: any;
    writeArtifact: (payload: {
      artifactType: string;
      objectKey: string;
      byteSize?: number | null;
      metadata?: any;
      stage: 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging' | 'completed' | 'failed';
    }) => Promise<void>;
  }): Promise<{
    success: number;
    failed: number;
    generatedAssets: Array<{
      anchorId: string | null;
      visualType: string;
      objectKey: string;
      taskId: string;
      prompt: string;
      index: number;
    }>;
  }> {
    const visuals = (input.manifest?.lessons || [])
      .flatMap((lesson: any) => Array.isArray(lesson?.visualizations) ? lesson.visualizations : []);
    const maxAssets = Math.max(1, Number(process.env.DOC_ASSET_GEN_MAX || 8));
    const assetTimeoutMs = Math.max(15000, Number(process.env.DOC_ASSET_GEN_TIMEOUT_MS || 120000));
    const selected = visuals.slice(0, maxAssets);
    let success = 0;
    let failed = 0;
    const generatedAssets: Array<{
      anchorId: string | null;
      visualType: string;
      objectKey: string;
      taskId: string;
      prompt: string;
      index: number;
    }> = [];
    for (let i = 0; i < selected.length; i += 1) {
      const viz = selected[i];
      const visualType = String(viz?.type || 'visual').trim().toLowerCase() || 'visual';
      const contextText = String(viz?.context || '');
      const anchorId = String(viz?.anchor_id || '').trim() || null;
      const taskId = `docasset-${input.jobId}-${String(i + 1).padStart(2, '0')}-${Date.now().toString(36)}`;
      const rawPrompt = String(viz?.prompt_template || '').trim()
        || `Create a ${visualType} about: ${String(viz?.description || viz?.title || 'document concept').trim()}`;
      const prompt = this.sanitizeGenerationPrompt(rawPrompt);
      const captionText = String(viz?.caption_text || '').trim() || null;

      await this.storage.upsertDocumentAsset({
        assetTaskId: taskId,
        jobId: input.jobId,
        userId: input.userId,
        anchorId,
        prompt,
        status: 'running',
        metadata: {
          visual_type: visualType,
          title: String(viz?.title || '').trim() || null,
          context: contextText || null,
          purpose: String(viz?.purpose || '').trim() || null,
          caption_text: captionText,
          caption_mode: String(viz?.caption_mode || '').trim() || null,
        }
      });

      this.observability.emitLog('info', `Document asset generation started job=${input.jobId} asset=${taskId} type=${visualType}`, 'DocumentAsset', undefined, undefined, {
        metadata: {
          user_id: input.userId,
          doc_job_id: input.jobId,
          asset_task_id: taskId,
          stage: 'generating_assets',
          event_type: 'stage_started',
          provider_status: 'asset_generation_started',
          visual_type: visualType,
          anchor_id: anchorId,
        }
      });
      this.observability.emitProgress({
        taskId,
        batchId: `doc-${input.jobId}`,
        status: 'processing',
        stage: 'Document Asset Generation',
        details: {
          refined_prompt: prompt,
          visual_type: visualType,
          anchor_id: anchorId,
          caption_text: captionText,
          doc_job_id: input.jobId,
          source: 'document_pipeline',
        },
        metrics: {},
      } as any);

      try {
        const task = this.buildImageTask(viz, taskId, prompt, visualType);
        let generated: any;
        try {
          const strategy = this.strategyFactory.getStrategy(task);
          generated = await Promise.race([
            strategy.generate(task, i + 1),
            this.sleep(assetTimeoutMs).then(() => {
              throw new Error(`Asset generation timeout after ${assetTimeoutMs}ms`);
            }),
          ]);
        } catch (primaryError: any) {
          const message = String(primaryError?.message || primaryError || '');
          const retryWithVisualConcept =
            visualType === 'infographic'
            || visualType === 'aesthetic_anchor'
            || visualType === 'sourced_image'
            || /quality score|missing mandatory imagespecs|narrative type/i.test(message);
          if (!retryWithVisualConcept) {
            throw primaryError;
          }
          this.observability.emitLog('warn', `Document asset fallback to visual_concept job=${input.jobId} asset=${taskId} reason=${message.slice(0, 200)}`, 'DocumentAsset', undefined, undefined, {
            metadata: {
              user_id: input.userId,
              doc_job_id: input.jobId,
              asset_task_id: taskId,
              stage: 'generating_assets',
              event_type: 'stage_started',
              provider_status: 'asset_generation_fallback',
              visual_type: visualType,
            }
          });
          const fallbackTask = this.buildImageTask(viz, taskId, prompt, 'visual_concept');
          const fallbackStrategy = this.strategyFactory.getStrategy(fallbackTask);
          generated = await Promise.race([
            fallbackStrategy.generate(fallbackTask, i + 1),
            this.sleep(assetTimeoutMs).then(() => {
              throw new Error(`Asset generation timeout after ${assetTimeoutMs}ms (fallback)`);
            }),
          ]);
        }
        const localUrl = String(generated?.posterUrl || generated?.url || '').trim();
        const loaded = await this.loadGeneratedAsset(localUrl);
        if (!loaded?.buffer) {
          throw new Error(`Generated asset output missing for ${taskId}`);
        }
        const judgeVerdict = await this.assetJudge.judge({
          imageBytes: loaded.buffer,
          extension: loaded.ext || '.png',
          visualType,
          prompt,
        });
        this.observability.emitLog(judgeVerdict.passed ? 'info' : 'warn', `Document asset judge verdict job=${input.jobId} asset=${taskId} pass=${judgeVerdict.passed}`, 'DocumentAssetJudge', undefined, undefined, {
          metadata: {
            user_id: input.userId,
            doc_job_id: input.jobId,
            asset_task_id: taskId,
            stage: 'generating_assets',
            event_type: judgeVerdict.passed ? 'quality_scored' : 'stage_failed',
            provider_status: judgeVerdict.passed ? 'judge_passed' : 'judge_rejected',
            visual_type: visualType,
            judge_enabled: judgeVerdict.enabled,
            judge_model: judgeVerdict.model,
            judge_score: judgeVerdict.score,
            judge_reason: judgeVerdict.reason,
            judge_concerns: judgeVerdict.concerns,
          }
        });
        if (!judgeVerdict.passed) {
          throw new Error(`Asset rejected by judge: ${judgeVerdict.reason}`);
        }
        const ext = loaded.ext || '.png';
        const objectKey = DocumentObjectKeyLayout.asset({ jobId: input.jobId }, `${taskId}${ext}`);
        const contentType = this.contentTypeForExtension(ext);
        await this.uploadObject(objectKey, loaded.buffer, contentType);

        await this.storage.upsertDocumentAsset({
          assetTaskId: taskId,
          jobId: input.jobId,
          userId: input.userId,
          anchorId,
          prompt,
          status: 'completed',
          objectKey,
          metadata: {
            visual_type: visualType,
            generated_url: localUrl || null,
            provider_payload: generated?.payload || null,
            caption_text: captionText,
            caption_mode: String(viz?.caption_mode || '').trim() || null,
            judge_enabled: judgeVerdict.enabled,
            judge_model: judgeVerdict.model,
            judge_score: judgeVerdict.score,
            judge_reason: judgeVerdict.reason,
            judge_concerns: judgeVerdict.concerns,
          }
        });
        await input.writeArtifact({
          artifactType: `${visualType}_asset`,
          objectKey,
          byteSize: loaded.buffer.byteLength,
          stage: 'generating_assets',
          metadata: {
            asset_task_id: taskId,
            anchor_id: anchorId,
            visual_type: visualType,
            source_local_url: localUrl || null,
            prompt,
            caption_text: captionText,
            caption_mode: String(viz?.caption_mode || '').trim() || null,
            judge_enabled: judgeVerdict.enabled,
            judge_model: judgeVerdict.model,
            judge_score: judgeVerdict.score,
            judge_reason: judgeVerdict.reason,
            judge_concerns: judgeVerdict.concerns,
            source_provider: generated?.payload?.source_provider || null,
            source_query: generated?.payload?.source_query || null,
            sourced_queries: generated?.payload?.sourced_queries || null,
            sourced_candidates: generated?.payload?.sourced_candidates || null,
            sourced_query_signals: generated?.payload?.sourced_query_signals || null,
            sourced_query_config: generated?.payload?.sourced_query_config || null,
            clip_score: Number(generated?.payload?.metrics?.clip_score ?? generated?.payload?.clip_score ?? NaN),
            vision_score: Number(generated?.payload?.metrics?.vision_score ?? generated?.payload?.vision_score ?? NaN),
          }
        });
        generatedAssets.push({
          anchorId,
          visualType,
          objectKey,
          taskId,
          prompt,
          index: i,
        });
        success += 1;
        this.observability.emitLog('success', `Document asset generated job=${input.jobId} asset=${taskId} type=${visualType}`, 'DocumentAsset', undefined, undefined, {
          metadata: {
            user_id: input.userId,
            doc_job_id: input.jobId,
            asset_task_id: taskId,
            stage: 'generating_assets',
            event_type: 'artifact_written',
            provider_status: 'asset_generated',
            visual_type: visualType,
            object_key: objectKey,
            prompt,
            clip_score: Number(generated?.payload?.metrics?.clip_score ?? generated?.payload?.clip_score ?? NaN),
            vision_score: Number(generated?.payload?.metrics?.vision_score ?? generated?.payload?.vision_score ?? NaN),
            source_provider: generated?.payload?.source_provider || null,
            source_query: generated?.payload?.source_query || null,
            caption_text: captionText,
            caption_mode: String(viz?.caption_mode || '').trim() || null,
            judge_enabled: judgeVerdict.enabled,
            judge_model: judgeVerdict.model,
            judge_score: judgeVerdict.score,
            judge_reason: judgeVerdict.reason,
            judge_concerns: judgeVerdict.concerns,
          }
        });
        this.observability.emitProgress({
          taskId,
          batchId: `doc-${input.jobId}`,
          status: 'completed',
          url: (/^(https?:\/\/|\/generated-images\/)/i.test(localUrl) ? localUrl : null),
          details: {
            refined_prompt: prompt,
            visual_type: visualType,
            anchor_id: anchorId,
            doc_job_id: input.jobId,
            object_key: objectKey,
            source_provider: generated?.payload?.source_provider || null,
            source_query: generated?.payload?.source_query || null,
            source_local_url: localUrl || null,
            judge_enabled: judgeVerdict.enabled,
            judge_model: judgeVerdict.model,
            judge_score: judgeVerdict.score,
            judge_reason: judgeVerdict.reason,
            caption_text: captionText,
            caption_mode: String(viz?.caption_mode || '').trim() || null,
            chart_type: generated?.payload?.chart_type,
            chart_data_points: generated?.payload?.chart_data_points,
            chart_labels_preview: generated?.payload?.chart_labels_preview,
            sourced_queries: generated?.payload?.sourced_queries,
            sourced_candidates: generated?.payload?.sourced_candidates,
            sourced_query_signals: generated?.payload?.sourced_query_signals,
            sourced_query_config: generated?.payload?.sourced_query_config,
            clip_score: Number(generated?.payload?.metrics?.clip_score ?? generated?.payload?.clip_score ?? NaN),
            vision_score: Number(generated?.payload?.metrics?.vision_score ?? generated?.payload?.vision_score ?? NaN),
            source: 'document_pipeline',
          },
          metrics: {
            clip_score: Number(generated?.payload?.metrics?.clip_score ?? generated?.payload?.clip_score ?? NaN),
            vision_score: Number(generated?.payload?.metrics?.vision_score ?? generated?.payload?.vision_score ?? NaN),
            total_ms: Number(generated?.payload?.metrics?.total_ms ?? NaN),
          },
        } as any);
      } catch (error: any) {
        failed += 1;
        await this.storage.upsertDocumentAsset({
          assetTaskId: taskId,
          jobId: input.jobId,
          userId: input.userId,
          anchorId,
          prompt,
          status: 'failed',
          metadata: {
            visual_type: visualType,
            error_message: String(error?.message || error || 'Asset generation failed'),
          }
        });
        this.observability.emitLog('error', `Document asset generation failed job=${input.jobId} asset=${taskId}: ${error?.message || error}`, 'DocumentAsset', undefined, undefined, {
          metadata: {
            user_id: input.userId,
            doc_job_id: input.jobId,
            asset_task_id: taskId,
            stage: 'generating_assets',
            event_type: 'stage_failed',
            provider_status: 'asset_generation_failed',
            visual_type: visualType,
            error_message: String(error?.message || error || 'Asset generation failed'),
          }
        });
        this.observability.emitProgress({
          taskId,
          batchId: `doc-${input.jobId}`,
          status: 'failed',
          stage: 'Document Asset Generation Failed',
          details: {
            refined_prompt: prompt,
            visual_type: visualType,
            anchor_id: anchorId,
            doc_job_id: input.jobId,
            error: String(error?.message || error || 'Asset generation failed'),
            source: 'document_pipeline',
          },
          metrics: {},
        } as any);
      }
    }
    return { success, failed, generatedAssets };
  }

  private async loadInsertionAssetsForJob(input: {
    jobId: string;
    userId: number;
    generated: Array<{
      anchorId: string | null;
      visualType: string;
      objectKey: string;
      taskId: string;
      prompt: string;
      index: number;
    }>;
  }): Promise<Array<{
    anchor_id: string | null;
    visual_type: string;
    object_key: string;
    bytes: Buffer;
    extension: string;
    width_px: number | null;
    height_px: number | null;
  }>> {
    const results: Array<{
      anchor_id: string | null;
      visual_type: string;
      object_key: string;
      bytes: Buffer;
      extension: string;
      width_px: number | null;
      height_px: number | null;
    }> = [];
    const discovered = new Map<string, { anchorId: string | null; visualType: string }>();
    for (const asset of input.generated || []) {
      const key = String(asset?.objectKey || '').trim();
      if (!key) continue;
      discovered.set(key, {
        anchorId: asset.anchorId || null,
        visualType: String(asset.visualType || '').trim().toLowerCase(),
      });
    }
    try {
      const persisted = await this.storage.listDocumentArtifactsForUser(input.jobId, input.userId);
      for (const row of persisted || []) {
        const type = String(row?.artifact_type || '').trim().toLowerCase();
        if (!type.endsWith('_asset')) continue;
        const key = String(row?.object_key || '').trim();
        if (!key || key.startsWith('inline://')) continue;
        const metadata = (typeof row?.metadata === 'object' && row?.metadata) ? row.metadata : {};
        const anchorId = String((metadata as any)?.anchor_id || '').trim() || null;
        const visualType = String((metadata as any)?.visual_type || type.replace(/_asset$/i, '')).trim().toLowerCase();
        if (!discovered.has(key)) {
          discovered.set(key, { anchorId, visualType });
        }
      }
    } catch (error: any) {
      this.logger.warn(`Unable to list persisted assets for insertion job=${input.jobId}: ${error?.message || error}`);
    }

    for (const [key, meta] of discovered.entries()) {
      try {
        let bytes = await this.downloadObject(key);
        let extension = String(path.extname(key || '') || '.png').toLowerCase();
        const safeEmbedExt = new Set(['.png', '.jpg', '.jpeg']);
        if (!safeEmbedExt.has(extension)) {
          bytes = await sharp(bytes).png().toBuffer();
          extension = '.png';
        }
        const metadata = await sharp(bytes).metadata();
        results.push({
          anchor_id: meta.anchorId || null,
          visual_type: meta.visualType,
          object_key: key,
          bytes,
          extension,
          width_px: Number.isFinite(Number(metadata?.width)) ? Number(metadata.width) : null,
          height_px: Number.isFinite(Number(metadata?.height)) ? Number(metadata.height) : null,
        });
      } catch (error: any) {
        this.logger.warn(`Insertion asset download failed for ${key}: ${error?.message || error}`);
      }
    }
    return results;
  }

  private async loadGeneratedAsset(urlOrPath: string): Promise<{ buffer: Buffer; ext: string } | null> {
    const value = String(urlOrPath || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) {
      const res = await fetch(value, { method: 'GET' });
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      const ext = path.extname(new URL(value).pathname || '').toLowerCase() || '.png';
      return { buffer: Buffer.from(arr), ext };
    }
    if (value.startsWith('/generated-images/')) {
      const relative = value.replace(/^\/+/, '');
      const absolute = path.join(process.cwd(), 'public', relative);
      const bytes = await fs.readFile(absolute);
      const ext = path.extname(absolute).toLowerCase() || '.png';
      return { buffer: bytes, ext };
    }
    return null;
  }

  private contentTypeForExtension(ext: string): string {
    const key = String(ext || '').toLowerCase();
    if (key === '.jpg' || key === '.jpeg') return 'image/jpeg';
    if (key === '.webp') return 'image/webp';
    if (key === '.svg') return 'image/svg+xml';
    return 'image/png';
  }

  private buildImageTask(viz: any, taskId: string, prompt: string, visualType: string): any {
    const normalized = String(visualType || '').trim().toLowerCase();
    if (normalized === 'data_viz') {
      const payload = this.buildDocumentDataVizPayload(viz, prompt);
      return {
        type: 'data_viz',
        id: taskId,
        refined_prompt: prompt,
        payload,
      };
    }
    if (normalized === 'sourced_image') {
      return {
        type: 'sourced_image',
        id: taskId,
        refined_prompt: prompt,
        payload: {
          imageSpecs: {
            brief: prompt,
            source: {},
            constraints: {},
            rendering: {
              generation: { source: 'sourced' },
              export: { scale: 1 },
            },
          },
        },
      };
    }
    if (normalized === 'infographic' || normalized === 'flowchart') {
      const payload: Record<string, any> = normalized === 'flowchart'
        ? {
            type: 'flowchart',
            mermaid_code: String(viz?.mermaid_code || '').trim() || undefined,
            title: String(viz?.title || '').trim() || 'Flowchart',
            description: String(viz?.description || '').trim() || '',
            context: String(viz?.context || '').trim() || '',
            purpose: String(viz?.purpose || '').trim() || '',
            items: this.buildFlowchartItems(viz, prompt),
            grounding_mode: 'extractive',
            grounding_source_text: this.buildGroundingSourceText(viz, prompt),
          }
        : this.buildGroundedInfographicPayload(viz, prompt);
      return {
        type: 'infographic',
        id: taskId,
        refined_prompt: prompt,
        payload,
        metadata: {
          template_type: normalized === 'flowchart' ? 'flowchart' : 'steps',
          grounding_strict: true,
          source: 'document_pipeline',
        },
      };
    }
    if (normalized === 'aesthetic_anchor') {
      return {
        type: 'story_image',
        id: taskId,
        refined_prompt: prompt,
        payload: {
          imageSpecs: {
            brief: prompt,
            constraints: {},
            rendering: {
              generation: { source: 'generated' },
              export: { scale: 1 },
            },
          },
        },
      };
    }
    return {
      type: 'visual_concept',
      id: taskId,
      refined_prompt: prompt,
      payload: {},
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildDocumentDataVizPayload(viz: any, prompt: string): any {
    const text = [
      String(viz?.title || '').trim(),
      String(viz?.description || '').trim(),
      String(viz?.context || '').trim(),
      String(viz?.purpose || '').trim(),
      String(prompt || '').trim(),
    ].filter(Boolean).join(' | ');

    const chartType = /\b(line|trend|timeseries)\b/i.test(text)
      ? 'line'
      : /\b(pie|donut|share|composition)\b/i.test(text)
        ? 'pie'
        : /\b(funnel|stage conversion)\b/i.test(text)
          ? 'funnel'
          : 'bar';

    const pairMatches = Array.from(text.matchAll(/\b([A-Za-z][A-Za-z0-9_ ]{0,20})\s*[:=-]\s*(-?\d+(?:\.\d+)?)\b/g));
    const qPairs = pairMatches
      .map((m) => ({ label: String(m[1] || '').trim(), value: Number(m[2]) }))
      .filter((p) => Number.isFinite(p.value) && /\bQ[1-4]\b/i.test(p.label))
      .slice(0, 8);
    const genericPairs = pairMatches
      .map((m) => ({ label: String(m[1] || '').trim(), value: Number(m[2]) }))
      .filter((p) => Number.isFinite(p.value))
      .slice(0, 8);
    const labels = Array.from(new Set((text.match(/\bQ[1-4]\b/gi) || []).map((v) => v.toUpperCase()))).slice(0, 8);
    const numbers = (text.match(/-?\d+(?:\.\d+)?/g) || [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
      .slice(0, 12);

    let data: Array<{ label: string; value: number }> = [];
    if (qPairs.length >= 2) {
      data = qPairs.map((p) => ({ label: p.label.toUpperCase(), value: p.value }));
    } else if (genericPairs.length >= 2) {
      data = genericPairs.map((p) => ({ label: p.label.replace(/\s+/g, ' ').trim().slice(0, 24), value: p.value }));
    } else if (labels.length) {
      data = labels.map((label, i) => ({ label, value: numbers[i] ?? (i + 1) * 10 }));
    } else if (numbers.length >= 2) {
      data = numbers.slice(0, 8).map((value, i) => ({ label: `Item ${i + 1}`, value }));
    } else {
      data = [
        { label: 'A', value: 10 },
        { label: 'B', value: 20 },
        { label: 'C', value: 30 },
      ];
    }

    return {
      chartType,
      data,
      format: 'static',
      title: String(viz?.title || '').trim() || 'Data Visualization',
    };
  }

  private sanitizeGenerationPrompt(rawPrompt: string): string {
    let out = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
    const redactPatterns: RegExp[] = [
      /\banchor-[a-z0-9-]+\b/gi,
      /\banchor\s+[a-z0-9-]+\b/gi,
      /\bsection\s+"[^"]+"\b/gi,
      /\bxml_path_id\b/gi,
      /\bparagraph_hash\b/gi,
      /\bparagraph_index\b/gi,
      /\bdoc_job_id\b/gi,
      /\bprovider_status\b/gi,
    ];
    for (const pattern of redactPatterns) out = out.replace(pattern, ' ');
    out = out.replace(/\s{2,}/g, ' ').trim();
    const constraints = 'Do not include UI elements, mouse cursors, watermark text, placeholder text, random letters, or gibberish.';
    return `${out}\n${constraints}`.trim();
  }

  private buildGroundingSourceText(viz: any, prompt: string): string {
    return [
      String(viz?.title || '').trim(),
      String(viz?.description || '').trim(),
      String(viz?.context || '').trim(),
      String(viz?.purpose || '').trim(),
      String(prompt || '').trim(),
    ].filter(Boolean).join(' | ');
  }

  private buildFlowchartItems(viz: any, prompt: string): Array<{ title: string; description: string }> {
    const items: Array<{ title: string; description: string }> = [];
    const seen = new Set<string>();
    const push = (titleRaw: string, descriptionRaw = '') => {
      const title = String(titleRaw || '').replace(/\s+/g, ' ').trim();
      const description = String(descriptionRaw || '').replace(/\s+/g, ' ').trim();
      if (!title) return;
      const fp = `${title.toLowerCase()}|${description.toLowerCase()}`;
      if (seen.has(fp)) return;
      seen.add(fp);
      items.push({ title: title.slice(0, 120), description: description.slice(0, 180) });
    };

    const mermaid = String(viz?.mermaid_code || '').trim();
    if (mermaid) {
      const lineDefs = mermaid.split(/\r?\n/);
      for (const line of lineDefs) {
        const m = line.match(/\b([A-Za-z0-9_]+)\s*[\[\(\{]([^\]\)\}]+)[\]\)\}]/);
        if (!m) continue;
        const label = String(m[2] || '').replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
        if (!label) continue;
        const title = label.split(':')[0]?.trim() || label;
        push(title, label);
      }
    }

    const source = [
      String(viz?.description || '').trim(),
      String(viz?.context || '').trim(),
      String(viz?.purpose || '').trim(),
      String(prompt || '').trim(),
    ].filter(Boolean).join(' ');
    const stepMatches = Array.from(source.matchAll(/\bStep\s*(\d+)\s*[:.-]?\s*([^.\n;]+)/gi));
    for (const match of stepMatches) {
      const n = String(match[1] || '').trim();
      const text = String(match[2] || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      push(`Step ${n}`, text);
    }

    if (!items.length) {
      const title = String(viz?.title || 'Process Flow').trim();
      const desc = String(viz?.description || '').trim();
      push(title, desc || 'Sequential process step');
    }
    return items.slice(0, 12);
  }

  private buildGroundedInfographicPayload(viz: any, prompt: string): any {
    const sourceText = this.buildGroundingSourceText(viz, prompt);
    const listTerms = this.extractGroundedInfographicItems(sourceText, viz, prompt);

    return {
      type: 'infographic',
      title: String(viz?.title || '').trim() || 'Document Concept',
      description: String(viz?.description || '').trim() || '',
      context: String(viz?.context || '').trim() || '',
      purpose: String(viz?.purpose || '').trim() || '',
      items: listTerms.map((t) => ({ title: t, description: '' })),
      grounding_mode: 'extractive',
      grounding_source_text: sourceText,
    };
  }

  private extractGroundedInfographicItems(sourceText: string, viz: any, prompt: string): string[] {
    const cleaned = String(sourceText || '').replace(/\s+/g, ' ').trim();
    const lower = cleaned.toLowerCase();

    const explicitTriadMatches = Array.from(
      new Set([
        ...Array.from(lower.matchAll(/\bprocedural instructions?\b/g)).map(() => 'Procedural Instructions'),
        ...Array.from(lower.matchAll(/\bdata[-\s]?heavy reporting\b/g)).map(() => 'Data-Heavy Reporting'),
        ...Array.from(lower.matchAll(/\batmospheric storytelling\b/g)).map(() => 'Atmospheric Storytelling'),
      ])
    );
    if (explicitTriadMatches.length >= 2) {
      return explicitTriadMatches.slice(0, 6);
    }

    const normalizeTerm = (value: string): string => {
      const compact = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^(and|or|to|for|with)\s+/i, '')
        .replace(/\s+/g, ' ');
      return compact;
    };

    const isNoiseTerm = (value: string): boolean => {
      const v = String(value || '').toLowerCase();
      if (!v) return true;
      if (v.length < 4 || v.length > 80) return true;
      if (/^anchor\b/.test(v)) return true;
      if (/\banchor-[a-z0-9-]+\b/.test(v)) return true;
      if (/\bsection\b/.test(v) && /\bintroduction\b/.test(v)) return true;
      if (/\b(document|doc)\b/.test(v) && /\b(core|overview|summary|summarize|objective|objectives)\b/.test(v)) return true;
      if (/\b(visually|illustrate|create|instructional infographic)\b/.test(v)) return true;
      if (/^scribeflow test goals?$/.test(v)) return true;
      return false;
    };

    const coarseCandidates = cleaned
      .split(/[|,;]+/g)
      .map((s) => normalizeTerm(s))
      .filter((s) => !isNoiseTerm(s));

    const sentenceCandidates = cleaned
      .split(/[.?!]/g)
      .flatMap((segment) => segment.split(/\band\b/gi))
      .map((s) => normalizeTerm(s))
      .filter((s) => !isNoiseTerm(s));

    const all = Array.from(new Set([...coarseCandidates, ...sentenceCandidates]));
    return all.slice(0, 6);
  }
}
