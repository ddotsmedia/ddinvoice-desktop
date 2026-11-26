import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from './api-exception';

/** Validates body/query with Zod; failures become 400 VALIDATION_FAILED with per-field messages. */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const r = this.schema.safeParse(value ?? {});
    if (r.success) return r.data as z.output<T>;
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
    throw ApiException.validation('Request validation failed', fields);
  }
}
