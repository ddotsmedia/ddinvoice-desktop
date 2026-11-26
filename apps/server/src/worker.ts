import 'reflect-metadata';
import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig, type ServerConfig } from './config';
import { CoreModule } from './core/core.module';
import { OUTBOX_HANDLERS } from './core/tokens';
import { STUB_HANDLERS } from './outbox/handlers';
import { OutboxWorker } from './outbox/outbox.worker';

@Module({})
class WorkerModule {
  static register(config: ServerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(config)],
      providers: [{ provide: OUTBOX_HANDLERS, useFactory: () => new Map(STUB_HANDLERS) }, OutboxWorker],
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
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

void main();
