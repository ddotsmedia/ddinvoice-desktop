import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { from, switchMap, type Observable } from 'rxjs';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import type { AuthContext } from './auth-context';

type Req = {
  method: string;
  route?: { path?: string };
  params: Record<string, string | undefined>;
  ip?: string;
  auth?: AuthContext;
};

const COMMANDS = new Set(['POST', 'PATCH', 'DELETE']);

/** Appends one AuditEvent per successful command. Auth bodies carry tokens, so they are not stored. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (!COMMANDS.has(req.method)) return next.handle();
    const path = req.route?.path ?? '';
    const entity = path.split('/')[1] || 'root';
    return next.handle().pipe(
      switchMap((body: unknown) => {
        const entityId = (body as { id?: unknown } | null)?.id ?? req.params['id'] ?? 'n/a';
        const isAuth = entity === 'auth';
        return from(
          this.prisma.scoped(this.config.companyId).auditEvent.create({
            data: {
              companyId: this.config.companyId,
              userId: req.auth?.userId ?? null,
              action: `${req.method} ${path}`,
              entity,
              entityId: String(entityId),
              after: isAuth ? undefined : (JSON.parse(JSON.stringify(body ?? null)) as object),
              ip: req.ip ?? req.auth?.ip ?? null,
            },
          }),
        ).pipe(switchMap(() => [body]));
      }),
    );
  }
}
