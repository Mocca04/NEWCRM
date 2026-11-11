import { Pool } from 'pg';
import { runAsTenant } from '../src/tenant-context';
import { book, createSalon, newPool, pgError, Salon, TEST_URL } from './helpers';

let pool: Pool;
let a: Salon;
let b: Salon;

beforeAll(async () => {
  pool = newPool();
  a = await createSalon(pool, 'salon-a');
  b = await createSalon(pool, 'salon-b');
});
afterAll(() => pool.end());

describe('cobertura de RLS', () => {
  it('toda tabla con tenant_id tiene RLS activo, forzado y con politica', async () => {
    const { rows } = await pool.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r'
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
             OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`);
    expect(rows).toEqual([]);
  });

  it('el rol de aplicacion no puede saltarse RLS', async () => {
    const { rows } = await pool.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_rls'`);
    expect(rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
  });

  it('las restricciones de exclusion existen', async () => {
    const { rows } = await pool.query(`SELECT conname FROM pg_constraint WHERE contype = 'x' ORDER BY conname`);
    expect(rows.map((r) => r.conname)).toEqual([
      'appointment_resources_no_double_booking',
      'appointment_services_no_double_booking',
      'cash_sessions_one_open_per_branch',
      'service_prices_one_per_scope',
      'subscriptions_one_live_per_tenant',
    ]);
  });
});

describe('aislamiento entre empresas (escenario 2)', () => {
  it('una empresa solo ve sus propios datos', async () => {
    const seen = await runAsTenant(pool, a.tenantId, async (db) => ({
      customers: (await db.query('SELECT tenant_id FROM customers')).rows,
      tenants: (await db.query('SELECT id FROM tenants')).rows,
      other: (await db.query('SELECT id FROM customers WHERE id = $1', [b.customerId])).rowCount,
    }));
    expect(seen.customers).toEqual([{ tenant_id: a.tenantId }]);
    expect(seen.tenants).toEqual([{ id: a.tenantId }]);
    expect(seen.other).toBe(0);
  });

  it('sin empresa en contexto no se ve nada', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rls');
      expect((await client.query('SELECT 1 FROM customers')).rowCount).toBe(0);
      expect((await client.query('SELECT 1 FROM tenants')).rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('no puede insertar, modificar ni borrar filas de otra empresa', async () => {
    const insert = runAsTenant(pool, a.tenantId, (db) =>
      db.query(`INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'Intruso', '3110000000')`, [b.tenantId]),
    );
    expect(await pgError(insert)).toBe('42501');

    const touched = await runAsTenant(pool, a.tenantId, async (db) => ({
      updated: (await db.query(`UPDATE customers SET full_name = 'x' WHERE id = $1`, [b.customerId])).rowCount,
      deleted: (await db.query(`DELETE FROM customers WHERE id = $1`, [b.customerId])).rowCount,
    }));
    expect(touched).toEqual({ updated: 0, deleted: 0 });
  });

  it('el contexto de una transaccion no se filtra a la siguiente', async () => {
    const single = new Pool({ connectionString: TEST_URL, max: 1 });
    try {
      await runAsTenant(single, a.tenantId, (db) => db.query('SELECT 1 FROM customers'));
      const { rows } = await single.query(`SELECT current_user AS role, current_setting('app.tenant_id', true) AS tenant`);
      expect(rows[0].role).not.toBe('app_rls');
      expect(rows[0].tenant ?? '').toBe('');
    } finally {
      await single.end();
    }
  });

  it('una cita no puede apuntar a un cliente de otra empresa', async () => {
    expect(await pgError(book(pool, a, { start: '2030-01-07T10:00:00-05:00', customerId: b.customerId }))).toBe('23514');
  });

  it('una linea de cita no puede usar un profesional de otra empresa', async () => {
    expect(await pgError(book(pool, a, { start: '2030-01-07T12:00:00-05:00', employeeId: b.employeeId }))).toBe('23514');
  });

  it('tenant_id no se puede cambiar', async () => {
    const move = pool.query('UPDATE customers SET tenant_id = $1 WHERE id = $2', [b.tenantId, a.customerId]);
    expect(await pgError(move)).toBe('23514');
  });

  it('los usuarios solo son visibles para las empresas donde son miembros', async () => {
    const userId = (await pool.query(`INSERT INTO users (auth_provider_id, email, full_name) VALUES ('auth-1', 'ana@example.com', 'Ana') RETURNING id`)).rows[0].id;
    const roleId = (await pool.query(`INSERT INTO roles (tenant_id, name, is_system) VALUES ($1, 'Propietario', true) RETURNING id`, [a.tenantId])).rows[0].id;
    await pool.query(`INSERT INTO tenant_memberships (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [a.tenantId, userId, roleId]);
    const count = (tenantId: string) => runAsTenant(pool, tenantId, async (db) => (await db.query('SELECT 1 FROM users')).rowCount);
    expect(await count(a.tenantId)).toBe(1);
    expect(await count(b.tenantId)).toBe(0);
  });

  it('la empresa no puede crear usuarios ni tocar su suscripcion ni los planes', async () => {
    const tryAs = (sql: string) => pgError(runAsTenant(pool, a.tenantId, (db) => db.query(sql)));
    expect(await tryAs(`INSERT INTO users (auth_provider_id, email, full_name) VALUES ('x', 'x@example.com', 'X')`)).toBe('42501');
    expect(await tryAs(`UPDATE subscription_plans SET price_monthly = 1`)).toBe('42501');
    expect(await tryAs(`UPDATE subscriptions SET status = 'ACTIVE'`)).toBe('42501');
  });
});
