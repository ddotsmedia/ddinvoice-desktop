import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/api-exception';
import { IS_PUBLIC } from '../common/decorators';
import type { LicenseModule } from './license';
import { LicenseService } from './license.service';

export const REQUIRES_MODULE = 'requiresModule';
export const ALLOW_READ_ONLY = 'allowReadOnly';

/** Route needs this module in the license (checked for reads and commands). */
export const RequiresModule = (m: LicenseModule) => SetMetadata(REQUIRES_MODULE, m);
/** Command still allowed in read-only mode (logout, license install, export, preview). */
export const AllowReadOnly = () => SetMetadata(ALLOW_READ_ONLY, true);

const COMMANDS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * After JWT and permission checks. Module gate on every request of a module-scoped route; READ_ONLY (expired,
 * invalid, or past offline grace) refuses commands unless the route opts in. Public routes are not gated.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LicenseService) private readonly licenses: LicenseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const mod = this.reflector.getAllAndOverride<LicenseModule | undefined>(REQUIRES_MODULE, [ctx.getHandler(), ctx.getClass()]);
    const allowReadOnly = this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY, [ctx.getHandler(), ctx.getClass()]);
    const method = ctx.switchToHttp().getRequest<{ method: string }>().method;
    const isCommand = COMMANDS.has(method);
    if (!mod && !isCommand) return true;

    const state = await this.licenses.current();
    if (mod && !state.modules.includes(mod)) {
      throw new ApiException(403, 'MODULE_NOT_LICENSED', `The "${mod}" module is not included in this license`);
    }
    if (isCommand && state.mode === 'READ_ONLY' && !allowReadOnly) {
      throw new ApiException(403, 'LICENSE_READ_ONLY', `License is read-only (${state.reason ?? 'not valid'}); view, print and export remain available`);
    }
    return true;
  }
}

