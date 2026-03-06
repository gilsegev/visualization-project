import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../auth/api-key.guard';
import { CreateDocumentJobDto, FinalizeDocumentJobDto } from './document-intake.types';
import { validateDocVersionHash } from './document-intake.validation';
import { DocumentIntakeService } from './document-intake.service';

@Controller('documents/jobs')
@UseGuards(ApiKeyGuard)
export class DocumentIntakeController {
  constructor(private readonly intake: DocumentIntakeService) {}

  @Post()
  createDraft(@Body() body: CreateDocumentJobDto, @Req() req: any) {
    const draft = this.intake.createJobDraft(body);
    return {
      job_id: draft.jobId,
      doc_version_hash: draft.docVersionHash,
      source_object_key: draft.sourceObjectKey,
      upload: this.intake.getUploadUrl(draft.jobId)
    };
  }

  @Post(':jobId/finalize')
  async finalize(
    @Param('jobId') jobId: string,
    @Body() body: CreateDocumentJobDto & FinalizeDocumentJobDto,
    @Req() req: any
  ) {
    const userId = Number(req?.authUser?.id);
    validateDocVersionHash(body.doc_version_hash);
    return this.intake.finalizeUpload(userId, { ...body, job_id: jobId });
  }

  @Get(':jobId/status')
  async status(@Param('jobId') jobId: string, @Req() req: any) {
    return this.intake.getStatus(Number(req?.authUser?.id), jobId);
  }

  @Get(':jobId/download-url')
  async download(@Param('jobId') jobId: string, @Req() req: any) {
    return this.intake.getDownloadUrl(Number(req?.authUser?.id), jobId);
  }

  @Get(':jobId/artifacts')
  async artifacts(@Param('jobId') jobId: string, @Req() req: any) {
    return this.intake.getArtifacts(Number(req?.authUser?.id), jobId);
  }
}
