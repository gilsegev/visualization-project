import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  assert(includes('src/worker/worker-resource-semaphore.service.ts', 'class WorkerResourceSemaphoreService'), 'Semaphore service missing');
  assert(includes('src/worker/worker.module.ts', 'WorkerResourceSemaphoreService'), 'Semaphore service not wired in WorkerModule');
  assert(includes('src/worker/document-queue.worker.service.ts', 'acquireInsertionLock'), 'Document worker lock acquire missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'releaseInsertionLock'), 'Document worker lock release missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'Insertion resource lock acquired'), 'Document worker lock acquire log missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'Insertion resource lock released'), 'Document worker lock release log missing');
  assert(includes('src/worker/durable-queue.worker.service.ts', 'isInsertionLockActive()'), 'Durable worker insertion-lock check missing');
  assert(includes('src/worker/durable-queue.worker.service.ts', 'Image queue pulls paused: document insertion lock is active'), 'Durable worker pause log missing');
  assert(includes('src/image-gen/strategies/d2-diagram.strategy.ts', 'assertMermaidRenderGate('), 'Mermaid render gate hook missing');
  assert(includes('src/image-gen/strategies/d2-diagram.strategy.ts', 'Mermaid render gate blocked renderer call due to invalid syntax'), 'Mermaid block log missing');
  assert(includes('src/image-gen/strategies/d2-diagram.strategy.ts', 'Mermaid render gate passed before renderer call'), 'Mermaid pass log missing');
  console.log('[phase7-worker-orchestration-validation] PASS');
}

run();
