export interface CreateDocumentJobDto {
  file_name: string;
  file_size_bytes: number;
  file_mime_type: string;
  request_hash?: string;
}

export interface FinalizeDocumentJobDto {
  doc_version_hash: string;
}

export interface DocumentJobStatusResponse {
  job_id: string;
  state: string;
  queue_status: string;
  attempts: number;
  max_attempts: number;
  updated_at: string;
}
