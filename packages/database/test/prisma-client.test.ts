import { createPrismaClient, forTenant, PrismaClient } from '../src/client';
import { createSalon, newPool, Salon, TEST_URL } from './helpers';

let prisma: PrismaClient;
let a: Salon;
let b: Salon;

beforeAll(async () => {
  const pool = newPool();
  a = await createSalon(pool, 'prisma-a');
  b = await createSalon(pool, 'prisma-b');
  await pool.end();
  prisma = createPrismaClient(TEST_URL);
});
afterAll(() => prisma.$disconnect());

describe('cliente Prisma con contexto de empresa', () => {
  it('forTenant solo devuelve datos de esa empresa', async () => {
    const customers = await forTenant(prisma, a.tenantId, (tx) => tx.customer.findMany());
    expect(customers.map((c) => c.tenantId)).toEqual([a.tenantId]);
    const other = await forTenant(prisma, a.tenantId, (tx) => tx.customer.findUnique({ where: { id: b.customerId } }));
    expect(other).toBeNull();
  });

  it('forTenant no puede escribir en otra empresa', async () => {
    const write = forTenant(prisma, a.tenantId, (tx) => tx.customer.create({ data: { tenantId: b.tenantId, fullName: 'Intruso', phone: '3200000000' } }));
    await expect(write).rejects.toThrow();
    expect(await prisma.customer.count({ where: { tenantId: b.tenantId } })).toBe(1);
  });

  it('el contexto no sobrevive a la transaccion', async () => {
    await forTenant(prisma, a.tenantId, (tx) => tx.customer.count());
    const rows = await prisma.$queryRaw<{ role: string; tenant: string | null }[]>`SELECT current_user::text AS role, current_setting('app.tenant_id', true) AS tenant`;
    expect(rows[0].role).not.toBe('app_rls');
    expect(rows[0].tenant ?? '').toBe('');
  });

  it('rechaza un tenantId que no es UUID', () => {
    expect(() => forTenant(prisma, "x'; DROP TABLE customers; --", async () => 1)).toThrow();
  });
});
