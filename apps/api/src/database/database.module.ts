import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config';
import { DbService } from './db.service';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, DbService],
  exports: [APP_CONFIG, DbService],
})
export class DatabaseModule {}
