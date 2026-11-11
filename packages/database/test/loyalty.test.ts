import { Pool } from 'pg';
import { runAsTenant } from '../src/tenant-context';
import { book, Card, createCard, createSalon, ledger, newPool, pgError, Salon } from './helpers';

let pool: Pool;
let salon: Salon;
let card: Card;

const balance = async (cardId: string) =>
  (await pool.query('SELECT points_balance AS points, stamps_balance AS stamps FROM loyalty_cards WHERE id = $1', [cardId])).rows[0];

beforeAll(async () => {
  pool = newPool();
  salon = await createSalon(pool, 'fidelizacion');
  card = await createCard(pool, salon);
});
afterAll(() => pool.end());

describe('ledger de fidelizacion', () => {
  it('cada movimiento actualiza el saldo de la tarjeta', async () => {
    await ledger(pool, salon, card, { points: 40, stamps: 1, key: 'acumulacion:cita-1' });
    await ledger(pool, salon, card, { type: 'BONUS', points: 10, key: 'bienvenida' });
    expect(await balance(card.cardId)).toEqual({ points: 50, stamps: 1 });
  });

  it('no acredita dos veces el mismo movimiento (escenario 4)', async () => {
    expect(await pgError(ledger(pool, salon, card, { points: 40, stamps: 1, key: 'acumulacion:cita-1' }))).toBe('23505');
    expect(await balance(card.cardId)).toEqual({ points: 50, stamps: 1 });
  });

  it('no acredita dos sellos por la misma cita y campana (escenario 4)', async () => {
    const appointmentId = await book(pool, salon, { start: '2030-04-01T10:00:00-05:00' });
    const visit = () =>
      pool.query(`INSERT INTO loyalty_visits (tenant_id, card_id, campaign_id, appointment_id) VALUES ($1, $2, $3, $4)`, [salon.tenantId, card.cardId, card.campaignId, appointmentId]);
    await visit();
    expect(await pgError(visit())).toBe('23505');
  });

  it('no se puede modificar ni borrar un movimiento, ni siquiera como plataforma', async () => {
    expect(await pgError(pool.query(`UPDATE loyalty_points_ledger SET points_delta = 9999 WHERE card_id = $1`, [card.cardId]))).toBe('55000');
    expect(await pgError(pool.query(`DELETE FROM loyalty_points_ledger WHERE card_id = $1`, [card.cardId]))).toBe('55000');
    expect(await pgError(pool.query(`TRUNCATE loyalty_points_ledger CASCADE`))).toBe('55000');
  });

  it('la empresa no puede escribir saldos directamente', async () => {
    const hack = runAsTenant(pool, salon.tenantId, (db) => db.query(`UPDATE loyalty_cards SET points_balance = 999999 WHERE id = $1`, [card.cardId]));
    expect(await pgError(hack)).toBe('42501');
  });

  it('una redencion no puede dejar el saldo en negativo', async () => {
    expect(await pgError(ledger(pool, salon, card, { type: 'REDEMPTION', points: -500, key: 'canje-excesivo' }))).toBe('23514');
    await ledger(pool, salon, card, { type: 'REDEMPTION', points: -50, key: 'canje-1' });
    expect(await balance(card.cardId)).toEqual({ points: 0, stamps: 1 });
  });

  it('una reversion apunta al movimiento original y puede dejar saldo negativo (escenario 5)', async () => {
    const original = (await pool.query(`SELECT id FROM loyalty_points_ledger WHERE idempotency_key = 'acumulacion:cita-1'`)).rows[0].id;
    expect(await pgError(ledger(pool, salon, card, { type: 'REVERSAL', points: -40, stamps: -1, key: 'reversion-sin-origen' }))).toBe('23514');
    await ledger(pool, salon, card, { type: 'REVERSAL', points: -40, stamps: -1, key: 'reversion:cita-1', reversesId: original });
    expect(await balance(card.cardId)).toEqual({ points: -40, stamps: 0 });
    // Un movimiento solo puede revertirse una vez.
    expect(await pgError(ledger(pool, salon, card, { type: 'REVERSAL', points: -40, stamps: -1, key: 'reversion:cita-1:bis', reversesId: original }))).toBe('23505');
  });

  it('el saldo en cache coincide siempre con la suma del ledger', async () => {
    expect((await pool.query('SELECT * FROM app.loyalty_balance_drift')).rows).toEqual([]);
  });

  it('un movimiento no puede cargarse a la tarjeta de otro cliente', async () => {
    const other = (await pool.query(`INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'Cliente Dos', '3000000001') RETURNING id`, [salon.tenantId])).rows[0].id;
    const wrong = pool.query(
      `INSERT INTO loyalty_points_ledger (tenant_id, card_id, customer_id, type, points_delta, idempotency_key) VALUES ($1, $2, $3, 'ACCRUAL', 10, 'cliente-equivocado')`,
      [salon.tenantId, card.cardId, other],
    );
    expect(await pgError(wrong)).toBe('23514');
  });
});

describe('canje de recompensas (escenario 6)', () => {
  it('con dos validaciones simultaneas, la recompensa se usa una sola vez', async () => {
    const rewardId = (await pool.query(`INSERT INTO rewards (tenant_id, campaign_id, name, points_cost) VALUES ($1, $2, 'Descuento', 500) RETURNING id`, [salon.tenantId, card.campaignId])).rows[0].id;
    const redemptionId = (
      await pool.query(
        `INSERT INTO reward_redemptions (tenant_id, reward_id, card_id, customer_id, code_hash, code_expires_at)
         VALUES ($1, $2, $3, $4, 'hash', now() + interval '10 minutes') RETURNING id`,
        [salon.tenantId, rewardId, card.cardId, salon.customerId],
      )
    ).rows[0].id;
    const use = () =>
      runAsTenant(pool, salon.tenantId, async (db) =>
        (await db.query(`UPDATE reward_redemptions SET status = 'USED', used_at = now() WHERE id = $1 AND status IN ('REQUESTED', 'APPROVED')`, [redemptionId])).rowCount,
      );
    const results = await Promise.all([use(), use(), use()]);
    expect(results.reduce((sum, n) => (sum ?? 0) + (n ?? 0), 0)).toBe(1);
    // Y una vez usada no puede volver atras.
    expect(await pgError(pool.query(`UPDATE reward_redemptions SET status = 'REQUESTED' WHERE id = $1`, [redemptionId]))).toBe('23514');
  });
});

describe('pagos (escenario 5)', () => {
  it('un pago aprobado no se edita y el reembolso es una fila negativa enlazada', async () => {
    const paymentId = (await pool.query(`INSERT INTO payments (tenant_id, customer_id, method, amount) VALUES ($1, $2, 'CASH', 3000000) RETURNING id`, [salon.tenantId, salon.customerId])).rows[0].id;
    expect(await pgError(pool.query(`UPDATE payments SET amount = 1 WHERE id = $1`, [paymentId]))).toBe('23514');
    expect(await pgError(pool.query(`INSERT INTO payments (tenant_id, method, kind, amount) VALUES ($1, 'CASH', 'REFUND', -3000000)`, [salon.tenantId]))).toBe('23514');
    await pool.query(`INSERT INTO payments (tenant_id, method, kind, amount, refund_of_id) VALUES ($1, 'CASH', 'REFUND', -3000000, $2)`, [salon.tenantId, paymentId]);
    const { rows } = await pool.query(`SELECT sum(amount)::int AS net FROM payments WHERE id = $1 OR refund_of_id = $1`, [paymentId]);
    expect(rows[0].net).toBe(0);
  });
});
