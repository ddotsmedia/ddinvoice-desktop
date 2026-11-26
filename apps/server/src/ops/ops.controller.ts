import { Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Perm, ZodBody } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AllowReadOnly } from '../license/license.guard';
import { OpsService } from './ops.service';
import { BackupService } from './backup.service';

const InstallLicenseSchema = z.object({ licenseKey: z.string().min(20).max(20_000) });

@ApiTags('ops')
@Controller('ops')
export class OpsController {
  constructor(@Inject(OpsService) private readonly ops: OpsService) {}

  @Perm('backup.read')
  @Get('health')
  health() {
    return this.ops.health();
  }

  @Perm('backup.read')
  @Get('backups')
  backups() {
    return this.ops.backupsList();
  }

  @Perm('backup.create')
  @Post('backups/run')
  runBackup() {
    return this.ops.runBackup();
  }

  @Perm('backup.read')
  @Get('recovery')
  recovery() {
    return this.ops.recovery();
  }

  @Perm('backup.update')
  @Post('recovery/release')
  release() {
    return this.ops.release();
  }

  @Perm('backup.update')
  @Post('outbox/:id/retry')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.retryJob(id);
  }

  @Perm('backup.update')
  @Post('outbox/:id/dismiss')
  dismiss(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.dismissJob(id);
  }

  @Perm('backup.read')
  @Get('support-bundle')
  /** Sent raw: returning a Buffer from a Nest handler would be JSON-encoded. */
  async supportBundle(@Res() res: { set(h: Record<string, string>): void; send(body: Buffer): void }) {
    const zip = await this.ops.supportBundle();
    const name = `ddinvoice-support-${new Date().toISOString().slice(0, 10)}.zip`;
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` });
    res.send(zip);
  }

  @Perm('backup.export')
  @AllowReadOnly()
  @Post('export')
  exportData() {
    return this.ops.exportData();
  }

  @Perm('license.read')
  @Get('license')
  license() {
    return this.ops.licenseState();
  }

  @Perm('license.create')
  @AllowReadOnly()
  @ZodBody(InstallLicenseSchema)
  @Post('license')
  installLicense(@Body(new ZodPipe(InstallLicenseSchema)) body: z.infer<typeof InstallLicenseSchema>) {
    return this.ops.installLicense(body.licenseKey);
  }
}

@Module({ controllers: [OpsController], providers: [OpsService, BackupService] })
export class OpsModule {}

