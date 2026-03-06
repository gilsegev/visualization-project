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

export interface DocumentArtifactResponseItem {
  artifact_type: string;
  object_key: string;
  byte_size: number | null;
  checksum_sha256: string | null;
  metadata: any;
  created_at: string;
  signed_url?: string | null;
}
