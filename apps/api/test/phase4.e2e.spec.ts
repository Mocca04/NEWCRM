import { createHarness, Harness } from './harness';

let h: Harness;
const OWNER = 'duena@example.com';
const OTHER = 'otro.dueno@example.com';
let tenant: string;
let otherTenant: string;
let branch: string;
let corte: string;
let barba: string;
let laura: string;
let mateo: string;

const api = () => h.as(OWNER, tenant);
// 2030-02-04 es lunes. Las horas son de Bogotá (UTC-5).
const at = (date: string, time: string) => `${date}T${time}:00-05:00`;
const MON = '2030-02-04';
const client = (n: number) => ({ fullName: `Cliente ${n}`, phone: `30000000${String(n).padStart(2, '0')}` });
const book = (body: object, key?: string) => {
  const req = api().post('/appointments', { branchId: branch, ...body });
  return key ? req.set('Idempotency-Key', key) : req;
};
const times = async (query: string) =>
  (await api().get(`/availability?branchId=${branch}&${query}`).expect(200)).body.slots.map((s: any) => new Date(s.startsAt).toISOString().slice(11, 16));
// Hora UTC -> hora de Bogotá, para leer las pruebas con facilidad.
const local = (utc: string[]) => utc.map((t) => `${String((Number(t.slice(0, 2)) + 19) % 24).padStart(2, '0')}:${t.slice(3)}`);
const outbox = async (type: string, appointmentId: string) =>
  (await h.db.query(`SELECT count(*)::int AS n FROM outbox_events WHERE type = $1 AND payload->>'appointmentId' = $2`, [type, appointmentId])).rows[0].n;

beforeAll(async () => {
  h = await createHarness();
  tenant = (await h.as(OWNER).post('/tenants', { tradeName: 'Barbería Central', slug: 'barberia-central' }).expect(201)).body.id;
  otherTenant = (await h.as(OTHER).post('/tenants', { tradeName: 'Otra', slug: 'otra-barberia' }).expect(201)).body.id;
  branch = (await api().get('/branches')).body[0].id;
  const category = (await api().post('/service-categories', { name: 'Barbería' }).expect(201)).body.id;
  corte = (await api().post('/services', { categoryId: category, name: 'Corte', price: 2500000, durationMinutes: 30, cleanupMinutes: 10 }).expect(201)).body.id;
  barba = (await api().post('/services', { categoryId: category, name: 'Barba', price: 1500000, durationMinutes: 20, prepMinutes: 5 }).expect(201)).body.id;
  laura = (await api().post('/employees', { fullName: 'Laura', branchId: branch, serviceIds: [corte, barba] }).expect(201)).body.id;
  mateo = (await api().post('/employees', { fullName: 'Mateo', branchId: branch, serviceIds: [corte] }).expect(201)).body.id;
  const week = (ranges: [string, string][]) => [1, 2, 3, 4, 5, 6].flatMap((weekday) => ranges.map(([startTime, endTime]) => ({ weekday, startTime, endTime })));
  await api().put(`/employees/${laura}/schedule`, { entries: week([['09:00', '13:00'], ['14:00', '18:00']]) }).expect(200);
  await api().put(`/employees/${mateo}/schedule`, { entries: week([['09:00', '18:00']]) }).expect(200);
});
afterAll(() => h.close());

describe('motor de disponibilidad', () => {
  it('ofrece horas dentro del horario, respetando descanso y limpieza', async () => {
    const slots = local(await times(`date=${MON}&serviceIds=${corte}&employeeId=${laura}`));
    // Corte: 30 min + 10 de limpieza. La última de la mañana termina antes del descanso de la 1 p. m.
    expect(slots[0]).toBe('09:00');
    expect(slots).toContain('12:15');
    expect(slots).not.toContain('12:30');
    expect(slots).not.toContain('13:00');
    expect(slots).toContain('14:00');
    expect(slots[slots.length - 1]).toBe('17:15');
    expect(slots).toHaveLength(28);
  });

  it('no ofrece nada en un día que no se trabaja ni con quien no presta el servicio', async () => {
    expect(await times(`date=2030-02-03&serviceIds=${corte}`)).toEqual([]); // domingo
    await api().get(`/availability?branchId=${branch}&date=${MON}&serviceIds=${barba}&employeeId=${mateo}`).expect(400);
    await api().get(`/availability?branchId=${branch}&date=04/02/2030&serviceIds=${corte}`).expect(400);
    await api().get(`/availability?branchId=${branch}&date=${MON}&serviceIds=no-es-uuid`).expect(400);
  });

  it('la preparación también cuenta: la barba (5 min antes) no empieza a la hora exacta de apertura', async () => {
    const slots = local(await times(`date=${MON}&serviceIds=${barba}&employeeId=${laura}`));
    expect(slots[0]).toBe('09:15');
    expect(slots).not.toContain('14:00');
  });
});

describe('reservas', () => {
  let first: string;

  it('crea una cita confirmada con cliente nuevo y precios copiados', async () => {
    const res = await book({ startsAt: at(MON, '10:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(1), notes: 'Primera vez' }).expect(201);
    first = res.body.id;
    expect(res.body).toMatchObject({ status: 'CONFIRMED', source: 'PANEL', totalAmount: 2500000, notes: 'Primera vez', customer: { fullName: 'Cliente 1' } });
    expect(res.body.services).toMatchObject([{ name: 'Corte', employeeName: 'Laura', price: 2500000 }]);
    expect(new Date(res.body.endsAt).toISOString()).toBe('2030-02-04T15:30:00.000Z');
    // Cambiar el precio del catálogo no altera la cita ya agendada.
    await api().patch(`/services/${corte}`, { price: 3000000 }).expect(200);
    expect((await api().get(`/appointments/${first}`).expect(200)).body.totalAmount).toBe(2500000);
    await api().patch(`/services/${corte}`, { price: 2500000 }).expect(200);
  });

  it('el horario ocupado, con su limpieza, deja de ofrecerse solo para ese profesional', async () => {
    const lauraSlots = local(await times(`date=${MON}&serviceIds=${corte}&employeeId=${laura}`));
    expect(lauraSlots).toContain('09:15');
    for (const taken of ['09:30', '09:45', '10:00', '10:15', '10:30']) expect(lauraSlots).not.toContain(taken);
    expect(lauraSlots).toContain('10:45');
    // Con "cualquier profesional", las 10:00 siguen disponibles gracias a Mateo.
    const any = (await api().get(`/availability?branchId=${branch}&date=${MON}&serviceIds=${corte}`)).body.slots;
    const ten = any.find((s: any) => new Date(s.startsAt).toISOString() === '2030-02-04T15:00:00.000Z');
    expect(ten.employees[0].employeeName).toBe('Mateo');
  });

  it('rechaza una cita que se cruza con otra del mismo profesional', async () => {
    const res = await book({ startsAt: at(MON, '10:15'), services: [{ serviceId: corte, employeeId: laura }], customer: client(2) }).expect(409);
    expect(res.body.message).toContain('Laura ya tiene ese horario ocupado');
  });

  it('con cinco reservas simultáneas del mismo horario y dos profesionales, quedan exactamente dos (escenario 1)', async () => {
    const attempts = await Promise.all([3, 4, 5, 6, 7].map((n) => book({ startsAt: at(MON, '11:00'), services: [{ serviceId: corte }], customer: client(n) })));
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 409, 409, 409]);
    const made = attempts.filter((r) => r.status === 201).map((r) => r.body.services[0].employeeName).sort();
    expect(made).toEqual(['Laura', 'Mateo']);
    const rows = await h.db.query(`SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1 AND starts_at = $2`, [tenant, '2030-02-04T16:00:00Z']);
    expect(rows.rows[0].n).toBe(2);
  });

  it('dos servicios seguidos con la misma persona no dejan hueco entre ellos', async () => {
    const res = await book({ startsAt: at(MON, '14:00'), services: [{ serviceId: corte, employeeId: laura }, { serviceId: barba, employeeId: laura }], customer: client(1) }).expect(201);
    expect(res.body.totalAmount).toBe(4000000);
    expect(res.body.services.map((s: any) => [s.name, new Date(s.startsAt).toISOString().slice(11, 16), new Date(s.endsAt).toISOString().slice(11, 16)])).toEqual([
      ['Corte', '19:00', '19:30'],
      ['Barba', '19:30', '19:50'],
    ]);
    // Mismo teléfono: se reutiliza el cliente, no se duplica.
    expect((await h.db.query(`SELECT count(*)::int AS n FROM customers WHERE tenant_id = $1 AND phone = $2`, [tenant, client(1).phone])).rows[0].n).toBe(1);
    expect((await api().get('/customers?search=cliente 1').expect(200)).body).toHaveLength(1);
  });

  it('repetir la petición con la misma llave no crea otra cita', async () => {
    const body = { startsAt: at(MON, '16:00'), services: [{ serviceId: corte, employeeId: mateo }], customer: client(8) };
    const [a, b] = await Promise.all([book(body, 'llave-de-prueba-1'), book(body, 'llave-de-prueba-1')]);
    expect([a.status, b.status].every((s) => s === 201 || s === 200)).toBe(true);
    expect(a.body.id).toBe(b.body.id);
    expect((await book(body, 'llave-de-prueba-1')).body.id).toBe(a.body.id);
    expect((await h.db.query(`SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1 AND starts_at = $2`, [tenant, '2030-02-04T21:00:00Z'])).rows[0].n).toBe(1);
    await book({ ...body, notes: 'otros datos' }, 'llave-de-prueba-1').expect(409);
  });

  it('valida la petición', async () => {
    await book({ startsAt: at(MON, '09:00'), services: [], customer: client(9) }).expect(400);
    await book({ startsAt: at(MON, '09:00'), services: [{ serviceId: corte }] }).expect(400);
    await book({ services: [{ serviceId: corte }], customer: client(9) }).expect(400);
    await book({ startsAt: at(MON, '09:00'), services: [{ serviceId: corte }], customer: { fullName: 'X', phone: 'abc' } }).expect(400);
    await book({ startsAt: at(MON, '09:00'), services: [{ serviceId: barba, employeeId: mateo }], customer: client(9) }).expect(400);
  });

  it('fuera del horario solo se agenda si el personal lo pide expresamente, y nunca encima de otra cita', async () => {
    const sunday = { startsAt: at('2030-02-03', '10:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(9) };
    expect((await book(sunday).expect(409)).body.message).toContain('no trabaja a esa hora');
    await book({ ...sunday, ignoreSchedule: true }).expect(201);
    await book({ ...sunday, ignoreSchedule: true, customer: client(10) }).expect(409);
  });

  it('aplica la tarifa propia del profesional', async () => {
    await api().put(`/services/${corte}/prices`, { prices: [{ employeeId: mateo, price: 3500000, durationMinutes: 45 }] }).expect(200);
    const res = await book({ startsAt: at('2030-02-05', '09:00'), services: [{ serviceId: corte, employeeId: mateo }], customer: client(11) }).expect(201);
    expect(res.body.totalAmount).toBe(3500000);
    expect(new Date(res.body.endsAt).toISOString()).toBe('2030-02-05T14:45:00.000Z');
    await api().put(`/services/${corte}/prices`, { prices: [] }).expect(200);
  });

  describe('estados (escenario 3)', () => {
    it('recorre el flujo y completar dos veces solo tiene efecto una', async () => {
      await api().post(`/appointments/${first}/complete`).expect(409); // aún no empieza
      expect((await api().post(`/appointments/${first}/start`).expect(200)).body.status).toBe('IN_PROGRESS');
      const done = await Promise.all([1, 2, 3].map(() => api().post(`/appointments/${first}/complete`)));
      expect(done.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(done.every((r) => r.body.status === 'COMPLETED')).toBe(true);
      expect(await outbox('appointment.completed', first)).toBe(1);
      expect((await api().post(`/appointments/${first}/complete`).expect(200)).body.status).toBe('COMPLETED');
      expect(await outbox('appointment.completed', first)).toBe(1);
      await api().post(`/appointments/${first}/cancel`, {}).expect(409);
      await api().post(`/appointments/${first}/start`).expect(409);
      const visit = await h.db.query(`SELECT last_visit_at IS NOT NULL AS visited FROM customers WHERE tenant_id = $1 AND phone = $2`, [tenant, client(1).phone]);
      expect(visit.rows).toEqual([{ visited: true }]);
    });

    it('cancelar o registrar inasistencia libera el horario', async () => {
      const a = (await book({ startsAt: at('2030-02-06', '09:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(12) }).expect(201)).body.id;
      const b = (await book({ startsAt: at('2030-02-06', '10:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(13) }).expect(201)).body.id;
      expect(local(await times(`date=2030-02-06&serviceIds=${corte}&employeeId=${laura}`))).not.toContain('09:00');
      expect((await api().post(`/appointments/${a}/cancel`, { reason: 'El cliente avisó' }).expect(200)).body).toMatchObject({ status: 'CANCELLED', cancelReason: 'El cliente avisó' });
      expect((await api().post(`/appointments/${b}/no-show`).expect(200)).body.status).toBe('NO_SHOW');
      const free = local(await times(`date=2030-02-06&serviceIds=${corte}&employeeId=${laura}`));
      expect(free).toEqual(expect.arrayContaining(['09:00', '10:00']));
      await book({ startsAt: at('2030-02-06', '09:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(14) }).expect(201);
    });
  });

  it('mover una cita libera el horario anterior y no puede caer sobre otra', async () => {
    const id = (await book({ startsAt: at('2030-02-07', '09:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(15) }).expect(201)).body.id;
    await book({ startsAt: at('2030-02-07', '11:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(16) }).expect(201);
    await api().patch(`/appointments/${id}`, { startsAt: at('2030-02-07', '11:15') }).expect(409);
    expect(new Date((await api().get(`/appointments/${id}`)).body.startsAt).toISOString()).toBe('2030-02-07T14:00:00.000Z');
    // Moverla 15 minutos: se cruza con su propio horario anterior, y debe poder.
    const moved = await api().patch(`/appointments/${id}`, { startsAt: at('2030-02-07', '09:15') }).expect(200);
    expect(moved.body.services[0]).toMatchObject({ employeeName: 'Laura' });
    expect(new Date(moved.body.startsAt).toISOString()).toBe('2030-02-07T14:15:00.000Z');
    expect(local(await times(`date=2030-02-07&serviceIds=${corte}&employeeId=${laura}`))).not.toContain('09:00');
    await api().patch(`/appointments/${id}`, { startsAt: at('2030-02-07', '15:00') }).expect(200);
    expect(local(await times(`date=2030-02-07&serviceIds=${corte}&employeeId=${laura}`))).toContain('09:00');
  });

  it('bloqueos y festivos sacan horas de la agenda', async () => {
    await api().post('/time-blocks', { kind: 'VACATION', employeeId: laura, startsAt: at('2030-02-08', '00:00'), endsAt: at('2030-02-09', '00:00') }).expect(201);
    expect(await times(`date=2030-02-08&serviceIds=${corte}&employeeId=${laura}`)).toEqual([]);
    expect((await times(`date=2030-02-08&serviceIds=${corte}`)).length).toBeGreaterThan(0); // Mateo sí trabaja
    await api().post('/time-blocks', { kind: 'HOLIDAY', startsAt: at('2030-02-09', '00:00'), endsAt: at('2030-02-10', '00:00') }).expect(201);
    expect(await times(`date=2030-02-09&serviceIds=${corte}`)).toEqual([]);
    const res = await book({ startsAt: at('2030-02-09', '10:00'), services: [{ serviceId: corte, employeeId: mateo }], customer: client(17) }).expect(409);
    expect(res.body.message).toContain('ocupado');
  });

  it('un recurso físico limita las citas simultáneas', async () => {
    const category = (await api().get('/service-categories')).body[0].id;
    const lavado = (await api().post('/services', { categoryId: category, name: 'Lavado', price: 800000, durationMinutes: 15, resourceType: 'lavacabezas', employeeIds: [laura, mateo] }).expect(201)).body.id;
    const day = '2030-02-11';
    expect(await times(`date=${day}&serviceIds=${lavado}`)).toEqual([]); // todavía no hay ningún lavacabezas
    await api().post('/resources', { branchId: branch, name: 'Lavacabezas 1', type: 'lavacabezas' }).expect(201);
    await book({ startsAt: at(day, '09:00'), services: [{ serviceId: lavado, employeeId: laura }], customer: client(18) }).expect(201);
    const res = await book({ startsAt: at(day, '09:00'), services: [{ serviceId: lavado, employeeId: mateo }], customer: client(19) }).expect(409);
    expect(res.body.message).toContain('No hay lavacabezas libre');
    await book({ startsAt: at(day, '09:15'), services: [{ serviceId: lavado, employeeId: mateo }], customer: client(19) }).expect(201);
  });

  it('cliente sin reserva: la cita nace en atención y ocupa al profesional', async () => {
    const res = await book({ walkIn: true, services: [{ serviceId: corte, employeeId: laura }], customer: client(20) }).expect(201);
    expect(res.body).toMatchObject({ status: 'IN_PROGRESS', source: 'WALK_IN' });
    await book({ walkIn: true, services: [{ serviceId: corte, employeeId: laura }], customer: client(21) }).expect(409);
    const other = await book({ walkIn: true, services: [{ serviceId: corte }], customer: client(21) }).expect(201);
    expect(other.body.services[0].employeeName).toBe('Mateo');
    await api().post(`/appointments/${res.body.id}/complete`).expect(200);
  });

  it('una serie semanal agenda lo que cabe e informa las fechas con conflicto', async () => {
    await book({ startsAt: at('2030-03-18', '10:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(22) }).expect(201);
    const res = await book({ startsAt: at('2030-03-04', '10:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(23), repeat: { everyWeeks: 1, times: 4 } }).expect(201);
    expect(res.body.series.created).toBe(3);
    expect(res.body.series.conflicts.map((c: any) => new Date(c.startsAt).toISOString().slice(0, 10))).toEqual(['2030-03-18']);
    const series = await h.db.query(`SELECT count(*)::int AS n FROM appointments WHERE recurrence_series_id = $1`, [res.body.recurrenceSeriesId]);
    expect(series.rows[0].n).toBe(3);
    // Si la primera fecha no cabe, no se crea nada.
    await book({ startsAt: at('2030-03-04', '10:00'), services: [{ serviceId: corte, employeeId: laura }], customer: client(24), repeat: { everyWeeks: 2, times: 3 } }).expect(409);
  });

  it('lista por rango, profesional y estado', async () => {
    const day = `from=${encodeURIComponent(at(MON, '00:00'))}&to=${encodeURIComponent(at('2030-02-05', '00:00'))}`;
    const all = (await api().get(`/appointments?${day}`).expect(200)).body;
    expect(all.length).toBe(5);
    expect(all.map((a: any) => a.startsAt)).toEqual([...all.map((a: any) => a.startsAt)].sort());
    const onlyMateo = (await api().get(`/appointments?${day}&employeeId=${mateo}`)).body;
    expect(onlyMateo.every((a: any) => a.services.some((s: any) => s.employeeName === 'Mateo'))).toBe(true);
    expect((await api().get(`/appointments?${day}&status=COMPLETED`)).body).toHaveLength(1);
    await api().get('/appointments').expect(400);
    await api().get(`/appointments?from=2030-01-01T00:00:00Z&to=2030-06-01T00:00:00Z`).expect(400);
    await api().get(`/appointments?${day}&status=INVENTADO`).expect(400);
  });
});

describe('permisos y aislamiento en la agenda', () => {
  it('un profesional solo ve sus propias citas y no puede crear ni cambiar', async () => {
    const roles = (await api().get('/roles')).body;
    const role = roles.find((r: any) => r.name === 'Profesional').id;
    await api().post('/members', { email: 'mateo@example.com', fullName: 'Mateo', roleId: role }).expect(201);
    const pro = () => h.as('mateo@example.com', tenant);
    const day = `from=${encodeURIComponent(at(MON, '00:00'))}&to=${encodeURIComponent(at('2030-02-05', '00:00'))}`;
    // Sin vincular su cuenta a un profesional no ve ninguna cita.
    expect((await pro().get(`/appointments?${day}`).expect(200)).body).toEqual([]);
    const userId = (await pro().get('/me')).body.user.id;
    await api().patch(`/employees/${mateo}`, { userId }).expect(200);
    await api().patch(`/employees/${laura}`, { userId }).expect(400); // una cuenta, un profesional
    const mine = (await pro().get(`/appointments?${day}`).expect(200)).body;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a: any) => a.services.some((s: any) => s.employeeName === 'Mateo'))).toBe(true);
    const lauras = (await api().get(`/appointments?${day}&employeeId=${laura}`)).body.find((a: any) => a.services.every((s: any) => s.employeeName === 'Laura'));
    await pro().get(`/appointments/${lauras.id}`).expect(404);
    await pro().post('/appointments', { branchId: branch, startsAt: at(MON, '17:00'), services: [{ serviceId: corte }], customer: client(30) }).expect(403);
    await pro().post(`/appointments/${mine[0].id}/cancel`, {}).expect(403);
  });

  it('otra empresa no puede ver ni tocar estas citas, ni agendar con estos servicios', async () => {
    const outsider = () => h.as(OTHER, otherTenant);
    const day = `from=${encodeURIComponent(at(MON, '00:00'))}&to=${encodeURIComponent(at('2030-02-05', '00:00'))}`;
    expect((await outsider().get(`/appointments?${day}`).expect(200)).body).toEqual([]);
    const target = (await api().get(`/appointments?${day}`)).body[0];
    await outsider().get(`/appointments/${target.id}`).expect(404);
    await outsider().post(`/appointments/${target.id}/cancel`, {}).expect(404);
    await outsider().patch(`/appointments/${target.id}`, { startsAt: at(MON, '17:00') }).expect(404);
    const theirBranch = (await outsider().get('/branches')).body[0].id;
    await outsider().post('/appointments', { branchId: theirBranch, startsAt: at(MON, '09:00'), services: [{ serviceId: corte }], customer: client(31) }).expect(400);
    await outsider().post('/appointments', { branchId: branch, startsAt: at(MON, '09:00'), services: [{ serviceId: corte }], customer: client(31) }).expect(400);
    await outsider().get(`/availability?branchId=${branch}&date=${MON}&serviceIds=${corte}`).expect(400);
    expect((await api().get(`/appointments/${target.id}`)).body.status).toBe(target.status);
  });
});

describe('sucursal desactivada (escenario 11)', () => {
  it('no recibe citas nuevas, informa las futuras y conserva el historial', async () => {
    await h.db.query(`UPDATE subscriptions SET plan_id = (SELECT id FROM subscription_plans WHERE code = 'empresarial') WHERE tenant_id = $1`, [tenant]);
    const north = (await api().post('/branches', { name: 'Sede Norte' }).expect(201)).body.id;
    const ana = (await api().post('/employees', { fullName: 'Ana', branchId: north, serviceIds: [corte] }).expect(201)).body.id;
    await api().put(`/employees/${ana}/schedule`, { entries: [{ weekday: 1, startTime: '09:00', endTime: '18:00' }] }).expect(200);
    const appointment = (await api().post('/appointments', { branchId: north, startsAt: at(MON, '09:00'), services: [{ serviceId: corte }], customer: client(40) }).expect(201)).body;
    expect(appointment.services[0].employeeName).toBe('Ana'); // solo se asigna personal de esa sucursal

    const off = await api().post(`/branches/${north}/deactivate`).expect(200);
    expect(off.body).toMatchObject({ isActive: false, futureAppointments: 1 });
    const blocked = await api().post('/appointments', { branchId: north, startsAt: at(MON, '10:00'), services: [{ serviceId: corte }], customer: client(41) }).expect(409);
    expect(blocked.body.message).toContain('desactivada');
    expect(await (async () => (await api().get(`/availability?branchId=${north}&date=${MON}&serviceIds=${corte}`).expect(200)).body.slots)()).toEqual([]);
    const pending = (await api().get(`/appointments?branchId=${north}&from=${encodeURIComponent(at(MON, '00:00'))}&to=${encodeURIComponent(at('2030-02-05', '00:00'))}`)).body;
    expect(pending.map((a: any) => a.id)).toEqual([appointment.id]);
    // La cita pendiente todavía se puede cancelar.
    await api().post(`/appointments/${appointment.id}/cancel`, { reason: 'Sede cerrada' }).expect(200);
  });
});
