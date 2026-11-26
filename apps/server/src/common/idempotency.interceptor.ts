import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, of, switchMap, throwError, type Observable } from 'rxjs';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { ApiException } from './api-exception';
import type { AuthContext } from './auth-context';
import { SKIP_IDEMPOTENCY } from './decorators';
import { canonicalJson, sha256Hex } from './canonical';

const COMMANDS = new Set(['POST', 'PATCH', 'DELETE']);

type Req = {
  method: string;
  url: string;
  body?: unknown;
  route?: { path?: string };
  headers: Record<string, string | undefined>;
  auth?: AuthContext;
};

/**
 * Idempotency-Key on every command. The key is reserved (PENDING) before the handler runs, so a concurrent
 * duplicate cannot create a second record. Same key + same request → stored response; different request → 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (!COMMANDS.has(req.method)) return next.handle();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_IDEMPOTENCY, [ctx.getHandler(), ctx.getClass()]);
    if (skip) return next.handle();

    const key = req.headers['idempotency-key'];
    if (!key || key.length > 200) {
      throw ApiException.validation('Idempotency-Key header is required', { 'Idempotency-Key': 'required (1-200 chars)' });
    }
    const companyId = this.config.companyId;
    const route = `${req.method} ${req.route?.path ?? req.url}`;
    const requestHash = sha256Hex(`${route}\n${canonicalJson(req.body ?? null)}`);
    const db = this.prisma.scoped(companyId);

    try {
      await db.idempotencyKey.create({
        data: { companyId: this.config.companyId, key, userId: req.auth?.userId ?? '', route, requestHash, responseJson: { status: 'PENDING' } },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await db.idempotencyKey.findUnique({ where: { companyId_key: { companyId, key } } });
      if (!existing) throw e;
      if (existing.requestHash !== requestHash) {
        throw ApiException.conflict('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different request');
      }
      const stored = existing.responseJson as { status?: string; body?: unknown };
      if (stored.status === 'DONE') return of(stored.body);
      throw ApiException.conflict('CONFLICT', 'A request with this Idempotency-Key is still in progress');
    }

    const release = () => db.idempotencyKey.deleteMany({ where: { key } });
    return next.handle().pipe(
      switchMap((body: unknown) =>
        from(
          db.idempotencyKey.updateMany({
            where: { key },
            data: { responseJson: { status: 'DONE', body: JSON.parse(JSON.stringify(body ?? null)) as object } },
          }),
        ).pipe(switchMap(() => of(body))),
      ),
      catchError((err: unknown) => from(release()).pipe(switchMap(() => throwError(() => err)))),
    );
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
