import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, forTenant, PrismaClient, Tx } from '@newcrm/database';
import { APP_CONFIG, AppConfig } from '../config';

@Injectable()
export class DbService implements OnModuleDestroy {
  /**
   * Cliente de plataforma: SIN filtro por empresa. Usar solo para operaciones
   * de plataforma (identidad, alta de empresas, membresias). Todo lo demas va
   * por `forTenant`.
   */
  readonly platform: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.platform = createPrismaClient(config.databaseUrl);
  }

  /** Transaccion limitada a una empresa por Row-Level Security. */
  forTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return forTenant(this.platform, tenantId, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.platform.$disconnect();
  }
}
