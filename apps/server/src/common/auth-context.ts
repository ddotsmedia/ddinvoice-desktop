import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@ddinvoice/contracts';

export interface AuthContext {
  userId: string;
  companyId: string;
  sessionId: string;
  permissions: ReadonlySet<string>;
  ip: string;
  userAgent: string;
}

/** Populated by JwtGuard. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<{ auth: AuthContext }>();
  return req.auth;
});

export type { Permission };
