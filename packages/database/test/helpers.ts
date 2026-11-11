import { Pool, PoolClient } from 'pg';

export const ADMIN_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
export const TEST_DB = 'newcrm_test';
export const TEST_URL = (() => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

export const newPool = (): Pool => new Pool({ connectionString: TEST_URL, max: 6 });

/** Codigo de error de PostgreSQL de una promesa que debe fallar. */
export async function pgError(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

type Db = Pool | PoolClient;
const one = async (db: Db, sql: string, params: unknown[]): Promise<string> => (await db.query(sql, params)).rows[0].id;

export interface Salon {
  tenantId: string;
  branchId: string;
  employeeId: string;
  serviceId: string;
  customerId: string;
}

/** Crea, como plataforma, una empresa minima: sucursal, profesional, servicio y cliente. */
export async function createSalon(db: Db, name: string): Promise<Salon> {
  const slug = `${name}-${Math.random().toString(36).slice(2, 10)}`;
  const tenantId = await one(db, `INSERT INTO tenants (trade_name, slug, email) VALUES ($1, $2, $3) RETURNING id`, [name, slug, `${slug}@example.com`]);
  const branchId = await one(db, `INSERT INTO branches (tenant_id, name) VALUES ($1, 'Principal') RETURNING id`, [tenantId]);
  const employeeId = await one(db, `INSERT INTO employees (tenant_id, branch_id, full_name) VALUES ($1, $2, 'Profesional Uno') RETURNING id`, [tenantId, branchId]);
  const categoryId = await one(db, `INSERT INTO service_categories (tenant_id, name) VALUES ($1, 'General') RETURNING id`, [tenantId]);
  const serviceId = await one(db, `INSERT INTO services (tenant_id, category_id, name, price, duration_minutes) VALUES ($1, $2, 'Corte', 3000000, 30) RETURNING id`, [tenantId, categoryId]);
  const customerId = await one(db, `INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'Cliente Uno', '3000000000') RETURNING id`, [tenantId]);
  return { tenantId, branchId, employeeId, serviceId, customerId };
}

export interface BookingInput {
  start: string;
  minutes?: number;
  prep?: number;
  cleanup?: number;
  status?: string;
  employeeId?: string;
  customerId?: string;
}

/** Inserta una cita con una linea de servicio. Devuelve el id de la cita. */
export async function book(db: Db, salon: Salon, input: BookingInput): Promise<string> {
  const { start, minutes = 30, prep = 0, cleanup = 0, status = 'CONFIRMED' } = input;
  const appointmentId = await one(
    db,
    `INSERT INTO appointments (tenant_id, branch_id, customer_id, status, starts_at, ends_at)
     VALUES ($1, $2, $3, $4::"AppointmentStatus", $5::timestamptz, $5::timestamptz + make_interval(mins => $6)) RETURNING id`,
    [salon.tenantId, salon.branchId, input.customerId ?? salon.customerId, status, start, minutes],
  );
  await db.query(
    `INSERT INTO appointment_services
       (tenant_id, appointment_id, service_id, employee_id, price, starts_at, ends_at, occupied_start, occupied_end)
     VALUES ($1, $2, $3, $4, 3000000, $5::timestamptz, $5::timestamptz + make_interval(mins => $6),
             $5::timestamptz - make_interval(mins => $7), $5::timestamptz + make_interval(mins => $6 + $8))`,
    [salon.tenantId, appointmentId, salon.serviceId, input.employeeId ?? salon.employeeId, start, minutes, prep, cleanup],
  );
  return appointmentId;
}

export interface Card {
  campaignId: string;
  cardId: string;
}

export async function createCard(db: Db, salon: Salon, type: 'STAMPS' | 'POINTS' = 'POINTS'): Promise<Card> {
  const programId = await one(
    db,
    `INSERT INTO loyalty_programs (tenant_id, stamps_enabled, points_enabled) VALUES ($1, true, true)
     ON CONFLICT (tenant_id) DO UPDATE SET stamps_enabled = true RETURNING id`,
    [salon.tenantId],
  );
  const campaignId = await one(db, `INSERT INTO loyalty_campaigns (tenant_id, program_id, type, name) VALUES ($1, $2, $3::"LoyaltyCampaignType", 'Campana') RETURNING id`, [salon.tenantId, programId, type]);
  const cardId = await one(db, `INSERT INTO loyalty_cards (tenant_id, customer_id, campaign_id) VALUES ($1, $2, $3) RETURNING id`, [salon.tenantId, salon.customerId, campaignId]);
  return { campaignId, cardId };
}

export interface LedgerInput {
  type?: string;
  points?: number;
  stamps?: number;
  key: string;
  reversesId?: string;
}

export async function ledger(db: Db, salon: Salon, card: Card, input: LedgerInput): Promise<string> {
  return one(
    db,
    `INSERT INTO loyalty_points_ledger (tenant_id, card_id, customer_id, type, points_delta, stamps_delta, idempotency_key, reverses_id)
     VALUES ($1, $2, $3, $4::"LedgerEntryType", $5, $6, $7, $8) RETURNING id`,
    [salon.tenantId, card.cardId, salon.customerId, input.type ?? 'ACCRUAL', input.points ?? 0, input.stamps ?? 0, input.key, input.reversesId ?? null],
  );
}
