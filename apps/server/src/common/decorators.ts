import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { Permission } from '@ddinvoice/contracts';
import { z } from 'zod';

export const IS_PUBLIC = 'isPublic';
export const PERMS = 'perms';
export const SKIP_IDEMPOTENCY = 'skipIdempotency';
export const SKIP_PAIRING = 'skipPairing';

/** Route needs no access token (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route needs every listed permission (`resource.action`). */
export const Perm = (...perms: Permission[]) => SetMetadata(PERMS, perms);
/** Command bypasses the Idempotency-Key requirement (auth endpoints only). */
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY, true);

/** Documents the request body in OpenAPI from the same Zod schema used for validation. */
export const ZodBody = (schema: z.ZodType) =>
  applyDecorators(ApiBody({ schema: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown> }));

/** Route is reachable by unpaired devices (/pairing, /health). */
export const SkipPairing = () => SetMetadata(SKIP_PAIRING, true);
