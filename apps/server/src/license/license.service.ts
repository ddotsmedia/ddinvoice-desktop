import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { LicenseError, LicensePayloadSchema, TRIAL_KEY, evaluateLicense, parseLicense, type LicensePayload, type LicenseState } from './license';

/** Reads the newest License row of this company and evaluates it. Not cached: one indexed read per guarded request. */
@Injectable()
export class LicenseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async current(now = new Date()): Promise<LicenseState> {
    const row = await this.prisma.scoped(this.config.companyId).license.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!row) return evaluateLicense(undefined, now);
    if (row.licenseKey === TRIAL_KEY) {
      const trial = LicensePayloadSchema.safeParse(row.payload);
      if (!trial.success) return evaluateLicense(undefined, now, { invalid: true });
      return evaluateLicense(trial.data, now, { trial: true, lastValidatedAt: row.lastValidatedAt });
    }
    try {
      return evaluateLicense(parseLicense(row.licenseKey), now, { lastValidatedAt: row.lastValidatedAt });
    } catch {
      return evaluateLicense(undefined, now, { invalid: true });
    }
  }

  /** Installs a signed license for this company. Verifies signature and company before writing anything. */
  async install(text: string, now = new Date()): Promise<LicenseState> {
    let payload: LicensePayload;
    try {
      payload = parseLicense(text);
    } catch (e) {
      throw new ApiException(422, 'LICENSE_INVALID', e instanceof LicenseError ? e.message : 'License could not be read');
    }
    if (payload.companyId !== this.config.companyId) {
      throw new ApiException(422, 'LICENSE_INVALID', 'This license was issued for a different company');
    }
    await this.prisma.scoped(this.config.companyId).license.create({
      data: {
        companyId: this.config.companyId,
        licenseKey: text.trim(),
        payload: JSON.parse(JSON.stringify(payload)) as object,
        seats: payload.seats,
        modules: payload.modules,
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        lastValidatedAt: null,
      },
    });
    return this.current(now);
  }
}

@Global()
@Module({ providers: [LicenseService], exports: [LicenseService] })
export class LicenseModule {}
