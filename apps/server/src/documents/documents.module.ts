import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { pdfRendererProvider } from './pdf-renderer';

@Module({ controllers: [DocumentsController], providers: [pdfRendererProvider, DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}
