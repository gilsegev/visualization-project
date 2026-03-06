import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function includes(file: string, snippet: string): boolean {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').includes(snippet);
}

function run(): void {
  assert(includes('src/documents/insertion/docx-surgical-inserter.service.ts', 'class DocxSurgicalInserterService'), 'Docx surgical inserter service missing');
  assert(includes('src/documents/insertion/docx-surgical-inserter.service.ts', "strategy: 'bottom_up_xml_path_id_desc'"), 'Bottom-up insertion strategy log missing');
  assert(includes('src/documents/insertion/docx-surgical-inserter.service.ts', '.sort((a, b) => b.xml_paragraph_index - a.xml_paragraph_index)'), 'Insertion must be reverse order by xml path');
  assert(includes('src/documents/insertion/docx-surgical-inserter.service.ts', 'computedHash !== String(anchor.paragraph_hash || \'\').trim()'), 'Deterministic anchor hash match check missing');
  assert(includes('src/documents/insertion/docx-surgical-inserter.service.ts', 'anchor_collision_same_xml_path_id'), 'Collision handling missing');

  assert(includes('src/worker/worker.module.ts', 'DocxSurgicalInserterService'), 'Inserter not wired in WorkerModule');
  assert(includes('src/worker/document-queue.worker.service.ts', "source_v1_backup.docx"), 'Backup key not configured');
  assert(includes('src/worker/document-queue.worker.service.ts', "artifactType: 'backup_docx'"), 'Backup artifact write missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'this.inserter.insertVisuals('), 'Worker insertion call missing');
  assert(includes('src/worker/document-queue.worker.service.ts', "artifactType: 'surgical_log_json'"), 'Surgical log artifact missing');
  assert(includes('src/worker/document-queue.worker.service.ts', "artifactType: 'final_docx'"), 'Final doc artifact missing');
  assert(includes('src/worker/document-queue.worker.service.ts', 'recovery_mode: \'backup_pointer\''), 'Rollback pointer to backup missing on failure');
  console.log('[phase8-surgical-insertion-validation] PASS');
}

run();
