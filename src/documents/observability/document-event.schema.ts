import { z } from 'zod';

const stageValues = [
  'queued',
  'analyzing',
  'planning',
  'generating_assets',
  'inserting',
  'packaging',
  'completed',
  'failed',
] as const;

const eventTypeValues = [
  'stage_started',
  'stage_completed',
  'stage_failed',
  'retry_scheduled',
  'artifact_written',
  'quality_scored',
] as const;

const severityValues = ['debug', 'info', 'warn', 'error'] as const;

export const documentEventSchema = z.object({
  event_id: z.string().min(1),
  job_id: z.string().min(1),
  asset_task_id: z.string().min(1).nullable(),
  user_id: z.number().int().nullable(),
  stage: z.enum(stageValues),
  event_type: z.enum(eventTypeValues),
  severity: z.enum(severityValues),
  duration_ms: z.number().nonnegative().nullable(),
  error_code: z.string().min(1).nullable(),
  error_message: z.string().min(1).nullable(),
  deployment_id: z.string().min(1).nullable(),
  service_role: z.string().min(1).nullable(),
  worker_id: z.string().min(1).nullable(),
  pid: z.number().int(),
  timestamp_iso: z.string().min(1),
});

export type DocumentEvent = z.infer<typeof documentEventSchema>;

export type BuildDocumentEventInput = {
  eventId: string;
  jobId: string;
  assetTaskId?: string | null;
  userId?: number | null;
  stage: DocumentEvent['stage'];
  eventType: DocumentEvent['event_type'];
  severity: DocumentEvent['severity'];
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  deploymentId?: string | null;
  serviceRole?: string | null;
  workerId?: string | null;
  pid: number;
  timestampIso?: string;
};

function cleanText(value?: string | null): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function cleanNumber(value?: number | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDocumentEvent(input: BuildDocumentEventInput): DocumentEvent {
  const event = {
    event_id: cleanText(input.eventId) || '',
    job_id: cleanText(input.jobId) || '',
    asset_task_id: cleanText(input.assetTaskId),
    user_id: Number.isFinite(Number(input.userId)) ? Number(input.userId) : null,
    stage: input.stage,
    event_type: input.eventType,
    severity: input.severity,
    duration_ms: cleanNumber(input.durationMs),
    error_code: cleanText(input.errorCode),
    error_message: cleanText(input.errorMessage),
    deployment_id: cleanText(input.deploymentId),
    service_role: cleanText(input.serviceRole),
    worker_id: cleanText(input.workerId),
    pid: Number(input.pid || process.pid),
    timestamp_iso: cleanText(input.timestampIso) || new Date().toISOString(),
  };
  return documentEventSchema.parse(event);
}
