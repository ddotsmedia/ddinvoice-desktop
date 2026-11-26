import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { API_VERSION, MIN_CLIENT_VERSION, SERVER_VERSION } from '../version';

@ApiTags('system')
@Controller('system')
class SystemController {
  @Public()
  @Get('version')
  version() {
    // serverTime is authoritative: the desktop compares its clock against it and warns above 5 min skew.
    return { api: API_VERSION, version: SERVER_VERSION, minClient: MIN_CLIENT_VERSION, serverTime: new Date().toISOString() };
  }
}

@Module({ controllers: [SystemController] })
export class SystemModule {}
