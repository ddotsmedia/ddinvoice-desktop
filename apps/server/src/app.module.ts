import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { ServerConfig } from './config';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { JwtGuard, PermissionGuard } from './auth/auth.guards';
import { HealthModule } from './health/health.module';
import { SystemModule } from './system/system.module';
import { CustomersModule } from './customers/customers.module';
import { PeriodsModule } from './periods/periods.module';
import { ReferenceModule } from './reference/reference.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CreditNotesModule } from './credit-notes/credit-notes.controller';
import { QuotesModule } from './quotes/quotes.controller';
import { PaymentsModule } from './payments/payments.controller';
import { JournalsModule } from './journals/journals.module';
import { ApiErrorFilter } from './common/error.filter';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { AuditInterceptor } from './common/audit.interceptor';

/** Global pipeline: throttle → JWT → permission; idempotency → audit; one error filter. */
@Module({})
export class AppModule {
  static register(config: ServerConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 600 }] }),
        AuthModule,
        HealthModule,
        SystemModule,
        CustomersModule,
        PeriodsModule,
        ReferenceModule,
        InvoicesModule,
        CreditNotesModule,
        QuotesModule,
        PaymentsModule,
        JournalsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
      ],
    };
  }
}
