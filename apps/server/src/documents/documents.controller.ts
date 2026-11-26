import { AllowReadOnly } from '../license/license.guard';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DocType } from '@ddinvoice/documents';
import { Perm, SkipIdempotency, ZodBody } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ArchivedPdfQuery, DocTypeSchema, PreviewSchema, type PreviewInput } from './documents.schemas';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly docs: DocumentsService) {}

  @Perm('document.read')
  @Get(':docType/:docId/pdf')
  archived(
    @Param('docType', new ZodPipe(DocTypeSchema)) docType: DocType,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Query(new ZodPipe(ArchivedPdfQuery)) q: ArchivedPdfQuery,
  ) {
    return this.docs.archived(docType, docId, q.lang);
  }

  /** Read-only render of a draft (no state change, binary response, so no Idempotency-Key record). */
  @Perm('document.read')
  @SkipIdempotency()
  @ZodBody(PreviewSchema)
  @AllowReadOnly()
  @Post('preview')
  preview(@Body(new ZodPipe(PreviewSchema)) body: PreviewInput) {
    return this.docs.preview(body);
  }
}
