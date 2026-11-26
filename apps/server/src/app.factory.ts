import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { ServerConfig } from './config';
import { AppModule } from './app.module';

export interface CreateAppOptions {
  httpsOptions?: { cert: Buffer; key: Buffer };
  logger?: false | ('error' | 'warn' | 'log')[];
}

/** Builds the Nest application for a config. Callers listen or init(); tests use init() + supertest. */
export async function createApp(config: ServerConfig, opts: CreateAppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), {
    httpsOptions: opts.httpsOptions,
    logger: opts.logger ?? ['error', 'warn', 'log'],
  });
  // Only the desktop renderer (app://ddi) may call the API from a browser context. Extra origins (dev server) via env.
  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Device-Id'],
    maxAge: 600,
  });
  return app;
}

export function corsOrigins(env: string | undefined = process.env.DDI_CORS_ORIGINS): string[] {
  const list = (env ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : ['app://ddi'];
}
