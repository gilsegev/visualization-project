import * as fs from 'fs';
import * as path from 'path';
import { buildDocumentEvent, documentEventSchema } from '../src/documents/observability/document-event.schema';
import { assertDocumentJobTransition } from '../src/documents/state/document-job-state.machine';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function validateSchema(): void {
  const event = buildDocumentEvent({
    eventId: 'evt-test-1',
    jobId: 'job-test-1',
    stage: 'planning',
    eventType: 'stage_started',
    severity: 'info',
    pid: 1234,
    serviceRole: 'worker',
    workerId: 'worker-1',
    deploymentId: 'deploy-local',
  });
  assert(Boolean(event.timestamp_iso), 'timestamp_iso missing');

  const failed = documentEventSchema.safeParse({
    ...event,
    event_id: '',
  });
  assert(!failed.success, 'schema should reject missing required fields');
}

function validateTransitions(): void {
  const seq = ['queued', 'analyzing', 'planning', 'generating_assets', 'inserting', 'packaging', 'completed'] as const;
  for (let i = 0; i < seq.length - 1; i += 1) {
    assertDocumentJobTransition(seq[i], seq[i + 1]);
  }
}

function validateWiring(): void {
  assert(includes('src/observability/observability.gateway.ts', 'buildDocumentEvent('), 'gateway must use canonical document event schema');
  assert(includes('src/worker/document-queue.worker.service.ts', 'emitDocumentEvent({'), 'worker must emit canonical document events');
  assert(includes('src/documents/intake/document-intake.service.ts', 'emitDocumentEvent({'), 'intake must emit canonical document events');
  assert(includes('src/observability/observability.gateway.ts', 'asset_task_id'), 'asset_task_id must be normalized');
  assert(includes('src/observability/observability.gateway.ts', 'deployment_id'), 'deployment_id must be normalized');
}

function run(): void {
  validateSchema();
  validateTransitions();
  validateWiring();
  console.log('[phase6-step1-event-schema-validation] PASS');
}

run();
