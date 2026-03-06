import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  const workerFile = 'src/worker/document-queue.worker.service.ts';
  assert(includes(workerFile, "artifactType: 'failure_report_json'"), 'failure_report_json artifact write missing');
  assert(includes(workerFile, 'root_error_code'), 'failure report root_error_code missing');
  assert(includes(workerFile, 'failed_stage'), 'failure report failed_stage missing');
  assert(includes(workerFile, 'retry_history'), 'failure report retry_history missing');
  assert(includes(workerFile, 'stage_timeline'), 'failure report stage_timeline missing');
  assert(includes(workerFile, 'last_successful_stage'), 'failure report last_successful_stage missing');
  assert(includes(workerFile, 'artifact_availability'), 'failure report artifact_availability missing');
  assert(includes(workerFile, 'recovery_recommendation'), 'failure report recovery_recommendation missing');
  assert(includes(workerFile, "event_type: 'doc_job_failed'"), 'normalized doc_job_failed forensic event missing');
  assert(includes(workerFile, 'Rollback path backup created job='), 'rollback backup-created log missing');
  assert(includes(workerFile, 'Rollback restore attempted job='), 'rollback restore-attempted log missing');
  assert(includes(workerFile, 'Rollback restore outcome job='), 'rollback restore-outcome log missing');
  assert(includes(workerFile, 'Insertion ordering strategy: bottom-up job='), 'insertion bottom-up ordering log missing');
  assert(includes(workerFile, 'insertion_inserted_count'), 'insertion inserted count log missing');
  assert(includes(workerFile, 'insertion_skipped_count'), 'insertion skipped count log missing');
  console.log('[phase6-step6-failure-forensics-validation] PASS');
}

run();
