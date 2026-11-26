import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ServerConfig } from '../config';
import { SerialQueue } from '../common/serial-queue';
import { loadOrCreateKeys } from './keys';
import { PrismaService } from './prisma.service';
import { CONFIG, KEYS } from './tokens';

@Global()
@Module({})
export class CoreModule {
  static forRoot(config: ServerConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: KEYS, useFactory: () => loadOrCreateKeys(config.dataDir) },
        PrismaService,
        SerialQueue,
      ],
      exports: [CONFIG, KEYS, PrismaService, SerialQueue],
    };
  }
}
