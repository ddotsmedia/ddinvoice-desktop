import { expect, it } from 'vitest';
import { ApiErrorSchema, ErrorCode } from './errors';

it('parses ApiError', () => {
  expect(ApiErrorSchema.parse({ code: ErrorCode.NotFound, message: 'x' }).code).toBe('NOT_FOUND');
});
