import { DocumentJobState } from '../contracts/document-job.contract';

export const DOCUMENT_JOB_ALLOWED_TRANSITIONS: Record<DocumentJobState, ReadonlyArray<DocumentJobState>> = {
  queued: ['analyzing', 'failed'],
  analyzing: ['planning', 'failed'],
  planning: ['generating_assets', 'failed'],
  generating_assets: ['inserting', 'failed'],
  inserting: ['packaging', 'failed'],
  packaging: ['completed', 'failed'],
  completed: [],
  failed: []
};

export function canTransitionDocumentJobState(from: DocumentJobState, to: DocumentJobState): boolean {
  return DOCUMENT_JOB_ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertDocumentJobTransition(from: DocumentJobState, to: DocumentJobState): void {
  if (!canTransitionDocumentJobState(from, to)) {
    throw new Error(`Invalid document job transition: ${from} -> ${to}`);
  }
}
