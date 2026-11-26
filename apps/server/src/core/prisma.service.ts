import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@ddinvoice/db';
import { scoped } from '@ddinvoice/db';
import { CONFIG } from './tokens';
import type { ServerConfig } from '../config';

export type Db = ReturnType<typeof scoped>;
/** Interactive-transaction client (Prisma's ITX deny-list removed). */
export type Tx = Omit<Db, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(CONFIG) config: ServerConfig) {
    this.client = new PrismaClient({ datasources: { db: { url: config.dbUrl } } });
  }

  /** Every business query goes through this: companyId is forced by the Prisma extension. */
  scoped(companyId: string): Db {
    return scoped(this.client, companyId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
