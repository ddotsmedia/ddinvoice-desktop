import 'reflect-metadata';
import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig, type ServerConfig } from './config';
import { CoreModule } from './core/core.module';
import { CONFIG, OUTBOX_HANDLERS } from './core/tokens';
import { PrismaService } from './core/prisma.service';
import { createDocumentRenderHandler } from './documents/document-render.handler';
import { PDF_RENDERER, pdfRendererProvider, type PdfRenderer } from './documents/pdf-renderer';
import { STUB_HANDLERS } from './outbox/handlers';
import { OutboxWorker, type OutboxHandler } from './outbox/outbox.worker';

@Module({})
class WorkerModule {
  static register(config: ServerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(config)],
      providers: [
        pdfRendererProvider,
        {
          provide: OUTBOX_HANDLERS,
          useFactory: (prisma: PrismaService, cfg: ServerConfig, renderer: PdfRenderer) => {
            const handlers = new Map<string, OutboxHandler>(STUB_HANDLERS.filter(([topic]) => topic !== 'document.render'));
            handlers.set(
              'document.render',
              createDocumentRenderHandler({ prisma, companyId: cfg.companyId, dataDir: cfg.dataDir, renderer }),
            );
            return handlers;
          },
          inject: [PrismaService, CONFIG, PDF_RENDERER],
        },
        OutboxWorker,
      ],
    };
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config), { logger: ['error', 'warn', 'log'] });
  app.get(OutboxWorker).start();
  Logger.log('ddinvoice worker polling Outbox', 'Worker');
  const stop = async () => {
    app.get(OutboxWorker).stop();
    await app.get<PdfRenderer>(PDF_RENDERER).close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

void main();
