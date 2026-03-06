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

export interface DocumentArtifactIndexResponse {
  index: any;
  links: {
    source_doc_url: string | null;
    backup_doc_url: string | null;
    failure_report_url: string | null;
    final_output_url: string | null;
    manifest_url: string | null;
    analysis_url: string | null;
    asset_urls: string[];
  };
}
