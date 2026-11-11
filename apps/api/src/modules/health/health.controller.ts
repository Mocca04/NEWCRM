import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/request-context';
import { DbService } from '../../database/db.service';

@ApiTags('Estado')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async check() {
    await this.db.platform.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
