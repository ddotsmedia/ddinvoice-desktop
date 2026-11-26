import { Controller, Get, Module } from '@nestjs/common';

@Controller('health')
class HealthController {
  @Get()
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [HealthController] })
export class AppModule {}
