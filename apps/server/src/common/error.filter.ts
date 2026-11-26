import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import { DomainError } from '@ddinvoice/domain';
import { ErrorCode } from '@ddinvoice/contracts';
import { Prisma } from '@ddinvoice/db';
import { ApiException } from './api-exception';

interface ApiBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  [extra: string]: unknown;
}

/** Every error leaves as ApiError {code, message, fields?}. Internal details are logged, never returned. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const [status, body] = this.map(exception);
    if (status >= 500) this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json(body);
  }

  private map(e: unknown): [number, ApiBody] {
    if (e instanceof ApiException) {
      return [
        e.status,
        { code: e.code, message: e.message, ...(e.fields && { fields: e.fields }), ...(e.extra ?? {}) },
      ];
    }
    if (e instanceof DomainError) {
      const code = e.code === 'UNBALANCED_JOURNAL' ? ErrorCode.JournalUnbalanced : e.code;
      return [422, { code, message: e.message }];
    }
    if (e instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const i of e.issues) fields[i.path.join('.') || '_'] = i.message;
      return [400, { code: 'VALIDATION_FAILED', message: 'Request validation failed', fields }];
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return [404, { code: 'NOT_FOUND', message: 'Resource not found' }];
      if (e.code === 'P2002') return [409, { code: 'CONFLICT', message: 'Duplicate value' }];
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code =
        status === 400 ? 'VALIDATION_FAILED'
        : status === 401 ? 'UNAUTHORIZED'
        : status === 403 ? 'FORBIDDEN'
        : status === 404 ? 'NOT_FOUND'
        : status === 429 ? 'RATE_LIMITED'
        : status < 500 ? 'CONFLICT'
        : 'INTERNAL';
      const message = status >= 500 ? 'Internal error' : e.message;
      return [status, { code, message }];
    }
    return [500, { code: 'INTERNAL', message: 'Internal error' }];
  }
}
