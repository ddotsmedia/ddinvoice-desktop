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
  return NestFactory.create(AppModule.register(config), {
    httpsOptions: opts.httpsOptions,
    logger: opts.logger ?? ['error', 'warn', 'log'],
  });
}
