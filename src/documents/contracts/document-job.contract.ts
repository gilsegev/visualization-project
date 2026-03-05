export type DocumentJobState =
  | 'queued'
  | 'analyzing'
  | 'planning'
  | 'generating_assets'
  | 'inserting'
  | 'packaging'
  | 'completed'
  | 'failed';

export interface DocumentJob {
  id: string;
  userId: string;
  sourceObjectKey: string;
  docVersionHash: string;
  manifestVersion: 1;
  state: DocumentJobState;
  createdAt: string;
  updatedAt: string;
}

export type DocumentAssetState = 'queued' | 'running' | 'completed' | 'failed';

export interface DocumentAssetTask {
  id: string;
  jobId: string;
  anchorId: string;
  prompt: string;
  state: DocumentAssetState;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentOutput {
  jobId: string;
  objectKey: string;
  manifestVersion: 1;
  completedAt: string;
}
