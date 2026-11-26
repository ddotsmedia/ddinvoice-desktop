import { Body, Controller, Get, Headers, Inject, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../common/zod.pipe';
import { ZodBody, Public, SkipIdempotency } from '../common/decorators';
import { CurrentAuth, type AuthContext } from '../common/auth-context';
import { AuthService } from './auth.service';
import { LoginSchema, RefreshSchema, type LoginInput, type RefreshInput } from './auth.schemas';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

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
  @Post('logout')
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth.sessionId);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth.userId, auth.permissions);
  }
}
