import { BadRequestException } from '@nestjs/common';
import { CreateDocumentJobDto } from './document-intake.types';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function readDocMaxBytes(): number {
  const mb = Math.max(1, Number(process.env.DOC_MAX_MB || 50));
  return mb * 1024 * 1024;
}

export function validateCreateDocumentJobPayload(body: CreateDocumentJobDto): void {
  const fileName = String(body?.file_name || '').trim();
  const mime = String(body?.file_mime_type || '').trim().toLowerCase();
  const size = Number(body?.file_size_bytes || 0);
  if (!fileName.toLowerCase().endsWith('.docx')) throw new BadRequestException('file_name must end with .docx');
  if (mime !== DOCX_MIME) throw new BadRequestException(`file_mime_type must be ${DOCX_MIME}`);
  if (!Number.isFinite(size) || size <= 0) throw new BadRequestException('file_size_bytes must be a positive number');
  if (size > readDocMaxBytes()) throw new BadRequestException(`file_size_bytes exceeds DOC_MAX_MB=${process.env.DOC_MAX_MB || 50}`);
}

export function validateDocVersionHash(hash: string): void {
  const value = String(hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('doc_version_hash must be a sha256 hex string');
}

export function docxMimeType(): string {
  return DOCX_MIME;
}
