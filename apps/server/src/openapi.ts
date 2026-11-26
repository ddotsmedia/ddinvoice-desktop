import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { SERVER_VERSION } from './version';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('DDInvoice Local API')
    .setDescription('Local API on the server PC. Commands require Idempotency-Key; invoices require If-Match on PATCH.')
    .setVersion(SERVER_VERSION)
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, builder);
}

/** Dev only: Swagger UI and JSON at /api/docs. */
export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}
