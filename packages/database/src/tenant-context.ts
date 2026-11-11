import type { Pool, PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `fn` en una transaccion limitada a una empresa.
 *
 * Dentro de la transaccion la conexion baja al rol `app_rls` (que no puede
 * saltarse Row-Level Security) y fija `app.tenant_id`. Ambos ajustes son
 * locales a la transaccion, asi que no se filtran a otra peticion aunque la
 * conexion vuelva a un agrupador de conexiones.
 */
export async function runAsTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('tenantId no es un UUID valido');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rls');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Ejecuta `fn` con el rol de conexion (plataforma), sin filtro por empresa.
 * Solo para operaciones de plataforma: alta de empresas, usuarios, cobros de
 * suscripcion, tareas del worker. Cada uso debe quedar en audit_logs.
 */
export async function runAsPlatform<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
