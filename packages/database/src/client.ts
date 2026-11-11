import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/client';

export { Prisma, PrismaClient };
export * from './generated/enums';

/** Cliente dentro de una transaccion. */
export type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Ejecuta `fn` en una transaccion limitada a una empresa: baja al rol
 * `app_rls` (sin permiso de saltarse RLS) y fija `app.tenant_id`. Ambos
 * ajustes mueren con la transaccion.
 */
export function forTenant<T>(prisma: PrismaClient, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(tenantId)) throw new Error('tenantId no es un UUID valido');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE app_rls');
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
