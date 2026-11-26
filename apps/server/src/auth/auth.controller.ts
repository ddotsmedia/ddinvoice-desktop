import { AllowReadOnly } from '../license/license.guard';
import { Body, Controller, Get, Headers, Inject, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../common/zod.pipe';
import { ZodBody, Perm, Public, SkipIdempotency } from '../common/decorators';
import { EventBus } from '../events/event-bus';
import { CurrentAuth, type AuthContext } from '../common/auth-context';
import { AuthService } from './auth.service';
import { LoginSchema, RefreshSchema, type LoginInput, type RefreshInput } from './auth.schemas';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  @Public()
  @SkipIdempotency()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ZodBody(LoginSchema)
  @Post('login')
  login(
    @Body(new ZodPipe(LoginSchema)) body: LoginInput,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.login(body, { ip, userAgent: userAgent ?? '' });
  }

  @Public()
  @SkipIdempotency()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ZodBody(RefreshSchema)
  @Post('refresh')
  refresh(@Body(new ZodPipe(RefreshSchema)) body: RefreshInput, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.refresh(body.refreshToken, { ip, userAgent: userAgent ?? '' });
  }

  @SkipIdempotency()
  @AllowReadOnly()
  @Post('logout')
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth.sessionId);
    this.bus.closeSession(auth.sessionId);
    return { ok: true };
  }

  /** Admin view: live sessions and devices for this company, plus the concurrent count the license seat check will use. */
  @Perm('user.read')
  @Get('sessions')
  sessions(@CurrentAuth() auth: AuthContext) {
    return this.auth.listSessions(auth.sessionId);
  }

  /** Revokes the refresh token (no further refresh) and closes the session's SSE stream. Access tokens die at the next guard check. */
  @Perm('user.update')
  @AllowReadOnly()
  @Post('sessions/:id/revoke')
  async revokeSession(@Param('id', ParseUUIDPipe) id: string) {
    const revoked = await this.auth.revokeSession(id);
    this.bus.closeSession(id);
    return { revoked };
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth.userId, auth.permissions);
  }
}
