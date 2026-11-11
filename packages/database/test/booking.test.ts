import { Pool } from 'pg';
import { runAsTenant } from '../src/tenant-context';
import { book, createSalon, newPool, pgError, Salon } from './helpers';

let pool: Pool;
let salon: Salon;
const EXCLUSION = '23P01';

beforeAll(async () => {
  pool = newPool();
  salon = await createSalon(pool, 'agenda');
});
afterAll(() => pool.end());

describe('doble reserva (escenario 1)', () => {
  it('rechaza una cita que se solapa con otra del mismo profesional', async () => {
    await book(pool, salon, { start: '2030-02-04T10:00:00-05:00' });
    expect(await pgError(book(pool, salon, { start: '2030-02-04T10:15:00-05:00' }))).toBe(EXCLUSION);
  });

  it('permite citas consecutivas sin solape', async () => {
    await expect(book(pool, salon, { start: '2030-02-04T10:30:00-05:00' })).resolves.toBeDefined();
  });

  it('cuenta la preparacion y la limpieza como tiempo ocupado', async () => {
    await book(pool, salon, { start: '2030-02-05T10:00:00-05:00', cleanup: 10 });
    expect(await pgError(book(pool, salon, { start: '2030-02-05T10:30:00-05:00' }))).toBe(EXCLUSION);
    expect(await pgError(book(pool, salon, { start: '2030-02-05T10:45:00-05:00', prep: 10 }))).toBe(EXCLUSION);
    await expect(book(pool, salon, { start: '2030-02-05T10:40:00-05:00' })).resolves.toBeDefined();
  });

  it('con dos reservas simultaneas del mismo horario, exactamente una queda', async () => {
    const attempt = () => runAsTenant(pool, salon.tenantId, (db) => book(db, salon, { start: '2030-02-06T15:00:00-05:00' }));
    const results = await Promise.allSettled([attempt(), attempt(), attempt(), attempt()]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed.map((r) => r.reason.code)).toEqual([EXCLUSION, EXCLUSION, EXCLUSION]);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1 AND starts_at = '2030-02-06T15:00:00-05:00'`,
      [salon.tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('otro profesional si puede atender a la misma hora', async () => {
    const other = (await pool.query(`INSERT INTO employees (tenant_id, branch_id, full_name) VALUES ($1, $2, 'Profesional Dos') RETURNING id`, [salon.tenantId, salon.branchId])).rows[0].id;
    await expect(book(pool, salon, { start: '2030-02-04T10:00:00-05:00', employeeId: other })).resolves.toBeDefined();
  });

  it('cancelar una cita libera el horario', async () => {
    const id = await book(pool, salon, { start: '2030-02-07T09:00:00-05:00' });
    expect(await pgError(book(pool, salon, { start: '2030-02-07T09:00:00-05:00' }))).toBe(EXCLUSION);
    await pool.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [id]);
    await expect(book(pool, salon, { start: '2030-02-07T09:00:00-05:00' })).resolves.toBeDefined();
  });

  it('un recurso fisico no puede ocuparse dos veces', async () => {
    const resource = (await pool.query(`INSERT INTO resources (tenant_id, branch_id, name, type) VALUES ($1, $2, 'Silla 1', 'silla') RETURNING id`, [salon.tenantId, salon.branchId])).rows[0].id;
    const other = (await pool.query(`INSERT INTO employees (tenant_id, branch_id, full_name) VALUES ($1, $2, 'Profesional Tres') RETURNING id`, [salon.tenantId, salon.branchId])).rows[0].id;
    const occupy = (appointmentId: string) =>
      pool.query(
        `INSERT INTO appointment_resources (tenant_id, appointment_id, resource_id, occupied_start, occupied_end)
         VALUES ($1, $2, $3, '2030-02-08T09:00:00-05:00', '2030-02-08T09:30:00-05:00')`,
        [salon.tenantId, appointmentId, resource],
      );
    await occupy(await book(pool, salon, { start: '2030-02-08T09:00:00-05:00' }));
    const second = await book(pool, salon, { start: '2030-02-08T09:00:00-05:00', employeeId: other });
    expect(await pgError(occupy(second))).toBe(EXCLUSION);
  });
});

describe('estados de la cita (escenario 3)', () => {
  const setStatus = (id: string, status: string) => pool.query(`UPDATE appointments SET status = $2::"AppointmentStatus" WHERE id = $1`, [id, status]);

  it('sigue el flujo permitido y rechaza los saltos', async () => {
    const id = await book(pool, salon, { start: '2030-03-04T10:00:00-05:00', status: 'PENDING' });
    expect(await pgError(setStatus(id, 'COMPLETED'))).toBe('23514');
    await setStatus(id, 'CONFIRMED');
    await setStatus(id, 'IN_PROGRESS');
    await setStatus(id, 'COMPLETED');
    expect(await pgError(setStatus(id, 'CANCELLED'))).toBe('23514');
    expect(await pgError(setStatus(id, 'IN_PROGRESS'))).toBe('23514');
  });

  it('completar solo tiene efecto una vez', async () => {
    const id = await book(pool, salon, { start: '2030-03-05T10:00:00-05:00', status: 'IN_PROGRESS' });
    const complete = () =>
      pool.query(`UPDATE appointments SET status = 'COMPLETED', completed_at = now() WHERE id = $1 AND status = 'IN_PROGRESS'`, [id]);
    const [first, second] = await Promise.all([complete(), complete()]);
    expect((first.rowCount ?? 0) + (second.rowCount ?? 0)).toBe(1);
  });
});
