import { createHarness, Harness } from './harness';

let h: Harness;
const OWNER_A = 'duena.a@example.com';
const OWNER_B = 'dueno.b@example.com';
const DESK = 'recepcion@example.com';
let tenantA: string;
let tenantB: string;
let branchA: string;
let categoryA: string;
let serviceB: string;
let employeeB: string;
const services: Record<string, string> = {};

const a = () => h.as(OWNER_A, tenantA);
const b = () => h.as(OWNER_B, tenantB);

beforeAll(async () => {
  h = await createHarness();
  tenantA = (await h.as(OWNER_A).post('/tenants', { tradeName: 'Barbería A', slug: 'barberia-a' }).expect(201)).body.id;
  tenantB = (await h.as(OWNER_B).post('/tenants', { tradeName: 'Uñas B', slug: 'unas-b' }).expect(201)).body.id;
  branchA = (await a().get('/branches')).body[0].id;
  const branchB = (await b().get('/branches')).body[0].id;
  const categoryB = (await b().post('/service-categories', { name: 'Uñas' }).expect(201)).body.id;
  serviceB = (await b().post('/services', { categoryId: categoryB, name: 'Semipermanente', price: 4500000, durationMinutes: 60 }).expect(201)).body.id;
  employeeB = (await b().post('/employees', { fullName: 'Profesional de B', branchId: branchB }).expect(201)).body.id;
});
afterAll(() => h.close());

describe('catálogo de servicios', () => {
  it('carga el catálogo inicial de las tres verticales sin duplicar', async () => {
    const first = await a().post('/catalog/templates', { vertical: 'BARBERSHOP' }).expect(201);
    expect(first.body).toMatchObject({ created: 6, skipped: 0 });
    categoryA = first.body.categoryId;
    expect((await a().post('/catalog/templates', { vertical: 'BARBERSHOP' }).expect(201)).body).toMatchObject({ created: 0, skipped: 6 });
    expect((await a().post('/catalog/templates', { vertical: 'MANICURE' }).expect(201)).body.created).toBe(7);
    expect((await a().post('/catalog/templates', { vertical: 'HAIR_SALON' }).expect(201)).body.created).toBe(7);
    await a().post('/catalog/templates', { vertical: 'OTHER' }).expect(400);

    const categories = (await a().get('/service-categories').expect(200)).body;
    expect(categories.map((c: any) => [c.name, c.services])).toEqual([['Barbería', 6], ['Manicure', 7], ['Peluquería', 7]]);
    const list = (await a().get(`/services?categoryId=${categoryA}`).expect(200)).body;
    expect(list.map((s: any) => s.name)).toEqual(['Corte', 'Degradado', 'Barba', 'Corte y barba', 'Cejas', 'Tratamientos']);
    // Sin precio todavía: no se publican en el portal hasta que el negocio los revise.
    expect(list.every((s: any) => s.price === 0 && s.isPublic === false && s.isActive)).toBe(true);
    for (const service of list) services[service.name] = service.id;
  });

  it('valida precios, duraciones y anticipos', async () => {
    const base = { categoryId: categoryA, name: 'Afeitado clásico', price: 2000000, durationMinutes: 30 };
    await a().post('/services', { ...base, price: -1 }).expect(400);
    await a().post('/services', { ...base, price: 20000.5 }).expect(400);
    await a().post('/services', { ...base, durationMinutes: 0 }).expect(400);
    await a().post('/services', { ...base, depositAmount: 2500000 }).expect(400);
    const created = await a().post('/services', { ...base, prepMinutes: 5, cleanupMinutes: 10, depositAmount: 500000, resourceType: 'silla' }).expect(201);
    expect(created.body).toMatchObject({ price: 2000000, prepMinutes: 5, cleanupMinutes: 10, depositAmount: 500000, resourceType: 'silla', employeeIds: [] });
    services.Afeitado = created.body.id;
    await a().patch(`/services/${services.Afeitado}`, { price: 400000 }).expect(400); // quedaría por debajo del anticipo
  });

  it('edita, registra el cambio de precio y elimina sin perder el historial', async () => {
    const updated = await a().patch(`/services/${services.Corte}`, { price: 2500000, isPublic: true }).expect(200);
    expect(updated.body).toMatchObject({ price: 2500000, isPublic: true });
    const log = await h.db.query(`SELECT before, after FROM audit_logs WHERE tenant_id = $1 AND action = 'service.price_changed'`, [tenantA]);
    expect(log.rows).toEqual([{ before: { price: 0 }, after: { price: 2500000 } }]);

    await a().delete(`/services/${services.Tratamientos}`).expect(204);
    await a().delete(`/services/${services.Tratamientos}`).expect(404);
    expect((await a().get(`/services?categoryId=${categoryA}`)).body.map((s: any) => s.name)).not.toContain('Tratamientos');
    expect((await h.db.query(`SELECT deleted_at IS NOT NULL AS gone FROM services WHERE id = $1`, [services.Tratamientos])).rows).toEqual([{ gone: true }]);
    await a().delete(`/service-categories/${categoryA}`).expect(409);
    const empty = (await a().post('/service-categories', { name: 'Spa' }).expect(201)).body.id;
    await a().post('/service-categories', { name: 'Spa' }).expect(409);
    await a().delete(`/service-categories/${empty}`).expect(204);
  });
});

describe('profesionales y horarios', () => {
  let laura: string;

  it('crea un profesional con sus servicios', async () => {
    const res = await a().post('/employees', { fullName: 'Laura Gómez', branchId: branchA, specialties: ['Degradados'], commissionPercent: 40, serviceIds: [services.Corte, services.Barba] }).expect(201);
    laura = res.body.id;
    expect(res.body).toMatchObject({ fullName: 'Laura Gómez', commissionPercent: 40, isActive: true, schedule: [] });
    expect(res.body.serviceIds.sort()).toEqual([services.Corte, services.Barba].sort());
    await a().post('/employees', { fullName: 'X', branchId: branchA, commissionPercent: 140 }).expect(400);
    // El servicio también la lista como habilitada.
    const corte = (await a().get('/services')).body.find((s: any) => s.id === services.Corte);
    expect(corte.employeeIds).toEqual([laura]);
  });

  it('guarda el horario semanal con descansos y lo devuelve igual', async () => {
    const entries = [
      { weekday: 1, startTime: '09:00', endTime: '13:00' },
      { weekday: 1, startTime: '14:00', endTime: '19:00' },
      { weekday: 6, startTime: '10:00', endTime: '24:00' },
    ];
    const saved = await a().put(`/employees/${laura}/schedule`, { entries }).expect(200);
    expect(saved.body.schedule).toEqual(entries);
    expect((await a().get('/employees')).body.find((e: any) => e.id === laura).schedule).toEqual(entries);
    // Reemplaza, no acumula.
    expect((await a().put(`/employees/${laura}/schedule`, { entries: entries.slice(0, 1) }).expect(200)).body.schedule).toHaveLength(1);
  });

  it('rechaza horarios imposibles', async () => {
    const put = (entries: object[]) => a().put(`/employees/${laura}/schedule`, { entries });
    await put([{ weekday: 1, startTime: '13:00', endTime: '09:00' }]).expect(400);
    await put([{ weekday: 1, startTime: '09:00', endTime: '09:00' }]).expect(400);
    await put([{ weekday: 1, startTime: '09:00', endTime: '13:00' }, { weekday: 1, startTime: '12:30', endTime: '18:00' }]).expect(400);
    await put([{ weekday: 7, startTime: '09:00', endTime: '13:00' }]).expect(400);
    await put([{ weekday: 1, startTime: '9am', endTime: '13:00' }]).expect(400);
    expect((await a().get('/employees')).body.find((e: any) => e.id === laura).schedule).toHaveLength(1);
  });

  it('aplica el límite de profesionales del plan (402) y lo libera al desactivar', async () => {
    // Plan Negocio: 5 profesionales activos. Ya hay 1.
    const ids: string[] = [];
    for (const n of [2, 3, 4, 5]) ids.push((await a().post('/employees', { fullName: `Profesional ${n}`, branchId: branchA }).expect(201)).body.id);
    const blocked = await a().post('/employees', { fullName: 'Profesional 6', branchId: branchA }).expect(402);
    expect(blocked.body.message).toContain('Negocio');

    expect((await a().post(`/employees/${ids[0]}/deactivate`).expect(200)).body.isActive).toBe(false);
    await a().post('/employees', { fullName: 'Profesional 6', branchId: branchA }).expect(201);
    await a().post(`/employees/${ids[0]}/activate`).expect(402);
    // El desactivado conserva su registro.
    expect((await a().get('/employees')).body).toHaveLength(6);
  });

  it('tarifas distintas por profesional', async () => {
    const set = (prices: object[]) => a().put(`/services/${services.Corte}/prices`, { prices });
    const saved = await set([{ employeeId: laura, price: 3500000, durationMinutes: 45 }, { branchId: branchA, price: 2800000 }]).expect(200);
    expect(saved.body.prices.map((p: any) => p.price).sort()).toEqual([2800000, 3500000]);
    await set([{ price: 100 }]).expect(400);
    await set([{ employeeId: laura, price: 1 }, { employeeId: laura, price: 2 }]).expect(400);
    await set([{ employeeId: employeeB, price: 1 }]).expect(400);
    expect((await a().get('/services')).body.find((s: any) => s.id === services.Corte).prices).toHaveLength(2);
  });

  it('bloqueos y recursos', async () => {
    await a().post('/time-blocks', { startsAt: '2030-12-24T14:00:00-05:00', endsAt: '2030-12-24T10:00:00-05:00' }).expect(400);
    await a().post('/time-blocks', { employeeId: employeeB, startsAt: '2030-12-24T14:00:00-05:00', endsAt: '2030-12-24T18:00:00-05:00' }).expect(400);
    const vacation = await a().post('/time-blocks', { kind: 'VACATION', employeeId: laura, startsAt: '2030-12-20T00:00:00-05:00', endsAt: '2031-01-05T00:00:00-05:00', reason: 'Vacaciones' }).expect(201);
    expect(vacation.body.branchId).toBe(branchA);
    await a().post('/time-blocks', { kind: 'HOLIDAY', startsAt: '2030-12-25T00:00:00-05:00', endsAt: '2030-12-26T00:00:00-05:00' }).expect(201);
    const inRange = await a().get('/time-blocks?from=2030-12-25T12:00:00-05:00&to=2030-12-25T13:00:00-05:00').expect(200);
    expect(inRange.body.map((x: any) => x.kind).sort()).toEqual(['HOLIDAY', 'VACATION']);
    expect((await a().get(`/time-blocks?from=2031-02-01T00:00:00-05:00`)).body).toEqual([]);
    await a().delete(`/time-blocks/${vacation.body.id}`).expect(204);
    await a().delete(`/time-blocks/${vacation.body.id}`).expect(404);

    const chair = await a().post('/resources', { branchId: branchA, name: 'Silla 1', type: 'Silla' }).expect(201);
    expect(chair.body.type).toBe('silla');
    expect((await a().patch(`/resources/${chair.body.id}`, { isActive: false }).expect(200)).body.isActive).toBe(false);
    expect((await a().get('/resources')).body).toHaveLength(1);
  });
});

describe('aislamiento y permisos en el catálogo', () => {
  it('una empresa no ve ni usa servicios o profesionales de otra', async () => {
    expect((await a().get('/services')).body.map((s: any) => s.id)).not.toContain(serviceB);
    expect((await a().get('/employees')).body.map((e: any) => e.id)).not.toContain(employeeB);
    await a().patch(`/services/${serviceB}`, { price: 1 }).expect(404);
    await a().delete(`/services/${serviceB}`).expect(404);
    await a().patch(`/employees/${employeeB}`, { fullName: 'Tomado' }).expect(404);
    await a().put(`/employees/${employeeB}/schedule`, { entries: [] }).expect(404);
    const mine = (await a().get('/employees')).body[0].id;
    await a().put(`/employees/${mine}/services`, { serviceIds: [serviceB] }).expect(400);
    await a().post('/services', { categoryId: (await b().get('/service-categories')).body[0].id, name: 'Colado', price: 1, durationMinutes: 30 }).expect(400);
    expect((await h.db.query(`SELECT price, deleted_at FROM services WHERE id = $1`, [serviceB])).rows).toEqual([{ price: 4500000, deleted_at: null }]);
  });

  it('recepción puede consultar el catálogo pero no modificarlo', async () => {
    const roles = (await a().get('/roles')).body;
    await a().post('/members', { email: DESK, fullName: 'Recepción', roleId: roles.find((r: any) => r.name === 'Recepcionista').id }).expect(201);
    const desk = () => h.as(DESK, tenantA);
    await desk().get('/services').expect(200);
    await desk().get('/employees').expect(200);
    await desk().get('/service-categories').expect(200);
    await desk().post('/services', { categoryId: categoryA, name: 'No debería', price: 1, durationMinutes: 30 }).expect(403);
    await desk().patch(`/services/${services.Corte}`, { price: 1 }).expect(403);
    await desk().post('/catalog/templates', { vertical: 'MANICURE' }).expect(403);
    await desk().post('/employees', { fullName: 'No debería', branchId: branchA }).expect(403);
    await desk().post('/time-blocks', { startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-02T00:00:00Z' }).expect(403);
  });

  it('un administrador limitado a una sucursal solo gestiona los profesionales de esa sucursal', async () => {
    await h.db.query(`UPDATE subscriptions SET plan_id = (SELECT id FROM subscription_plans WHERE code = 'empresarial') WHERE tenant_id = $1`, [tenantA]);
    const north = (await a().post('/branches', { name: 'Sede Norte' }).expect(201)).body.id;
    const roles = (await a().get('/roles')).body;
    const member = (await a().post('/members', { email: 'admin.norte@example.com', fullName: 'Admin Norte', roleId: roles.find((r: any) => r.name === 'Administrador').id, branchIds: [north] }).expect(201)).body;
    expect(member.branchIds).toEqual([north]);
    const admin = () => h.as('admin.norte@example.com', tenantA);
    expect((await admin().get('/employees')).body).toEqual([]);
    const other = (await a().get('/employees')).body[0].id;
    await admin().patch(`/employees/${other}`, { fullName: 'Tomado' }).expect(404);
    await admin().post('/employees', { fullName: 'En otra sede', branchId: branchA }).expect(400);
    const own = await admin().post('/employees', { fullName: 'En Norte', branchId: north }).expect(201);
    expect((await admin().get('/employees')).body.map((e: any) => e.id)).toEqual([own.body.id]);
  });
});
