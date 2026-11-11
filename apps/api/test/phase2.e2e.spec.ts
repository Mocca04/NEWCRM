import request from 'supertest';
import { createHarness, Harness } from './harness';

let h: Harness;
const OWNER_A = 'duena.a@example.com';
const OWNER_B = 'dueno.b@example.com';
const STAFF = 'empleado@example.com';
let tenantA: string;
let tenantB: string;
let branchB: string;
const roles: Record<string, string> = {};

const http = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('autenticacion', () => {
  it('la ruta de estado es publica', async () => {
    await http().get('/api/v1/health').expect(200, { status: 'ok' });
  });

  it('rechaza peticiones sin token, con firma falsa, vencidas o de otro emisor', async () => {
    await http().get('/api/v1/me').expect(401);
    await http().get('/api/v1/me').set('Authorization', 'Bearer no-es-un-token').expect(401);
    await http().get('/api/v1/me').set('Authorization', `Bearer ${h.idp.forgedToken(OWNER_A)}`).expect(401);
    const expired = h.idp.token(OWNER_A, { exp: Math.floor(Date.now() / 1000) - 10 });
    await http().get('/api/v1/me').set('Authorization', `Bearer ${expired}`).expect(401);
    const otherIssuer = h.idp.token(OWNER_A, { iss: 'https://otro-proyecto.supabase.co/auth/v1' });
    await http().get('/api/v1/me').set('Authorization', `Bearer ${otherIssuer}`).expect(401);
    const anon = h.idp.token(OWNER_A, { aud: 'anon' });
    await http().get('/api/v1/me').set('Authorization', `Bearer ${anon}`).expect(401);
  });

  it('no acepta un token sin firma (alg none)', async () => {
    const [, payload] = h.idp.token(OWNER_A).split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    await http().get('/api/v1/me').set('Authorization', `Bearer ${header}.${payload}.`).expect(401);
  });

  it('crea el usuario interno en el primer inicio de sesion', async () => {
    const res = await h.as(OWNER_A).get('/me').expect(200);
    expect(res.body.user.email).toBe(OWNER_A);
    expect(res.body.memberships).toEqual([]);
  });
});

describe('registro de empresas', () => {
  it('valida los datos de entrada', async () => {
    await h.as(OWNER_A).post('/tenants', { tradeName: 'X', slug: 'Con Espacios' }).expect(400);
    await h.as(OWNER_A).post('/tenants', { tradeName: 'Salon', slug: 'salon-a', campoInventado: 1 }).expect(400);
    await h.as(OWNER_A).post('/tenants', { tradeName: 'Salon', slug: 'admin' }).expect(409);
  });

  it('crea la empresa con roles, sucursal principal, propietario y periodo de prueba', async () => {
    const res = await h.as(OWNER_A).post('/tenants', { tradeName: 'Salon A', slug: 'salon-a', city: 'Tulua' }).expect(201);
    tenantA = res.body.id;
    tenantB = (await h.as(OWNER_B).post('/tenants', { tradeName: 'Barberia B', slug: 'barberia-b' }).expect(201)).body.id;

    const me = await h.as(OWNER_A).get('/me').expect(200);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].role.name).toBe('Propietario');
    expect(me.body.memberships[0].permissions).toHaveLength(22);

    const branches = await h.as(OWNER_A, tenantA).get('/branches').expect(200);
    expect(branches.body.map((b: any) => b.name)).toEqual(['Principal']);
    branchB = (await h.as(OWNER_B, tenantB).get('/branches')).body[0].id;

    for (const role of (await h.as(OWNER_A, tenantA).get('/roles').expect(200)).body) roles[role.name] = role.id;
    expect(Object.keys(roles).sort()).toEqual(['Administrador', 'Profesional', 'Propietario', 'Recepcionista']);

    const sub = await h.db.query(`SELECT s.status, p.code FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`, [tenantA]);
    expect(sub.rows).toEqual([{ status: 'TRIALING', code: 'negocio' }]);
  });

  it('no permite dos empresas con la misma direccion', async () => {
    await h.as(OWNER_B).post('/tenants', { tradeName: 'Copia', slug: 'salon-a' }).expect(409);
  });
});

describe('aislamiento entre empresas (escenario 2)', () => {
  it('exige indicar la empresa activa', async () => {
    await h.as(OWNER_A).get('/branches').expect(400);
    await h.as(OWNER_A, 'no-es-uuid').get('/branches').expect(400);
  });

  it('un usuario no puede entrar a una empresa ajena, exista o no', async () => {
    await h.as(OWNER_A, tenantB).get('/branches').expect(403);
    await h.as(OWNER_A, tenantB).get('/tenant').expect(403);
    await h.as(OWNER_A, tenantB).get('/members').expect(403);
    await h.as(OWNER_A, '11111111-1111-4111-8111-111111111111').get('/branches').expect(403);
  });

  it('desde su empresa no puede leer ni modificar registros de otra', async () => {
    await h.as(OWNER_A, tenantA).patch(`/branches/${branchB}`, { name: 'Tomada' }).expect(404);
    await h.as(OWNER_A, tenantA).post(`/branches/${branchB}/deactivate`).expect(404);
    const rolesB = (await h.as(OWNER_B, tenantB).get('/roles')).body;
    await h.as(OWNER_A, tenantA).put(`/roles/${rolesB[1].id}/permissions`, { permissionCodes: [] }).expect(404);
    // Ni asignar a un miembro suyo un rol o una sucursal de la otra empresa.
    await h.as(OWNER_A, tenantA).post('/members', { email: 'x@example.com', fullName: 'Equis', roleId: rolesB[1].id }).expect(400);
    await h.as(OWNER_A, tenantA).post('/members', { email: 'x@example.com', fullName: 'Equis', roleId: roles.Profesional, branchIds: [branchB] }).expect(400);
    const untouched = await h.db.query(`SELECT name, is_active FROM branches WHERE id = $1`, [branchB]);
    expect(untouched.rows).toEqual([{ name: 'Principal', is_active: true }]);
  });
});

describe('miembros y permisos (escenario 10)', () => {
  let staffMembership: string;

  it('un invitado entra con su correo confirmado y solo ve lo que su rol permite', async () => {
    const invited = await h.as(OWNER_A, tenantA).post('/members', { email: STAFF, fullName: 'Empleado Uno', roleId: roles.Administrador }).expect(201);
    staffMembership = invited.body.id;
    expect(invited.body.pending).toBe(true);
    await h.as(OWNER_A, tenantA).post('/members', { email: STAFF, fullName: 'Empleado Uno', roleId: roles.Administrador }).expect(409);

    // Con el correo sin confirmar no puede reclamar la invitacion.
    const unverified = h.idp.token(STAFF, { user_metadata: { email_verified: false } });
    await http().get('/api/v1/me').set('Authorization', `Bearer ${unverified}`).expect(403);

    const me = await h.as(STAFF).get('/me').expect(200);
    expect(me.body.memberships.map((m: any) => [m.tenant.slug, m.role.name])).toEqual([['salon-a', 'Administrador']]);
    await h.as(STAFF, tenantA).patch('/tenant', { phone: '3001234567' }).expect(200);
    await h.as(STAFF, tenantB).get('/branches').expect(403);
  });

  it('al perder permisos, la siguiente peticion con el MISMO token es rechazada', async () => {
    const token = h.idp.token(STAFF);
    const patchTenant = () =>
      http().patch('/api/v1/tenant').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenantA).send({ city: 'Cali' });
    await patchTenant().expect(200);

    await h.as(OWNER_A, tenantA).patch(`/members/${staffMembership}`, { roleId: roles.Profesional }).expect(200);
    await patchTenant().expect(403);
    await http().get('/api/v1/members').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenantA).expect(403);
    // Lo que su nuevo rol si permite sigue funcionando.
    await http().get('/api/v1/branches').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenantA).expect(200);

    // Quitar un permiso al rol tambien es inmediato.
    await h.as(OWNER_A, tenantA).patch(`/members/${staffMembership}`, { roleId: roles.Administrador }).expect(200);
    await patchTenant().expect(200);
    const without = (await h.as(OWNER_A, tenantA).get('/roles')).body.find((r: any) => r.name === 'Administrador').permissions.filter((c: string) => c !== 'tenant.manage');
    await h.as(OWNER_A, tenantA).put(`/roles/${roles.Administrador}/permissions`, { permissionCodes: without }).expect(200);
    await patchTenant().expect(403);

    // Y desactivarlo le cierra todo.
    await h.as(OWNER_A, tenantA).patch(`/members/${staffMembership}`, { isActive: false }).expect(200);
    await http().get('/api/v1/branches').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenantA).expect(403);
    expect((await h.as(STAFF).get('/me')).body.memberships).toEqual([]);
    await h.as(OWNER_A, tenantA).patch(`/members/${staffMembership}`, { isActive: true }).expect(200);
  });

  it('nadie puede escalar privilegios', async () => {
    // El administrador no tiene subscription.manage ni (ya) tenant.manage.
    await h.as(STAFF, tenantA).post('/roles', { name: 'Superrol', permissionCodes: ['subscription.manage'] }).expect(403);
    await h.as(STAFF, tenantA).put(`/roles/${roles.Recepcionista}/permissions`, { permissionCodes: ['tenant.manage'] }).expect(403);
    await h.as(STAFF, tenantA).post('/members', { email: 'otro@example.com', fullName: 'Otro', roleId: roles.Propietario }).expect(403);
    const ownerMembership = (await h.as(OWNER_A, tenantA).get('/members')).body.find((m: any) => m.user.email === OWNER_A).id;
    await h.as(STAFF, tenantA).patch(`/members/${ownerMembership}`, { isActive: false }).expect(403);
    await h.as(STAFF, tenantA).put(`/roles/${roles.Administrador}/permissions`, { permissionCodes: [] }).expect(409);
    await h.as(OWNER_A, tenantA).put(`/roles/${roles.Propietario}/permissions`, { permissionCodes: [] }).expect(409);
    await h.as(OWNER_A, tenantA).patch(`/members/${ownerMembership}`, { isActive: false }).expect(409);
    await h.as(OWNER_A, tenantA).post('/roles', { name: 'Raro', permissionCodes: ['no.existe'] }).expect(400);
  });

  it('un rol personalizado funciona y los cambios quedan en auditoria', async () => {
    const role = await h.as(OWNER_A, tenantA).post('/roles', { name: 'Cajero', permissionCodes: ['payments.manage', 'cash.manage'] }).expect(201);
    expect(role.body.permissions).toEqual(['cash.manage', 'payments.manage']);
    const actions = (await h.db.query(`SELECT action FROM audit_logs WHERE tenant_id = $1`, [tenantA])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['tenant.created', 'member.invited', 'member.updated', 'role.permissions_changed', 'role.created', 'tenant.updated']));
    const leaked = await h.db.query(`SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND actor_user_id IN (SELECT id FROM users WHERE email = $2)`, [tenantB, OWNER_A]);
    expect(leaked.rowCount).toBe(0);
  });

  it('un miembro limitado a una sucursal solo ve esa', async () => {
    await h.db.query(`UPDATE subscriptions SET plan_id = (SELECT id FROM subscription_plans WHERE code = 'empresarial') WHERE tenant_id = $1`, [tenantA]);
    const second = (await h.as(OWNER_A, tenantA).post('/branches', { name: 'Sede Norte' }).expect(201)).body.id;
    const member = (await h.as(OWNER_A, tenantA).get('/members')).body.find((m: any) => m.user.email === STAFF);
    await h.as(OWNER_A, tenantA).patch(`/members/${member.id}`, { branchIds: [second] }).expect(200);
    expect((await h.as(STAFF, tenantA).get('/branches')).body.map((b: any) => b.name)).toEqual(['Sede Norte']);
  });
});

describe('sucursales y limite del plan', () => {
  it('el plan Negocio admite una sola sucursal: la segunda responde 402', async () => {
    const res = await h.as(OWNER_B, tenantB).post('/branches', { name: 'Segunda' }).expect(402);
    expect(res.body.message).toContain('Negocio');
  });

  it('al cambiar de plan el limite cambia de inmediato (escenario 9, parte de backend)', async () => {
    await h.db.query(`UPDATE subscriptions SET plan_id = (SELECT id FROM subscription_plans WHERE code = 'empresarial') WHERE tenant_id = $1`, [tenantB]);
    await h.as(OWNER_B, tenantB).post('/branches', { name: 'Segunda' }).expect(201);
    await h.as(OWNER_B, tenantB).post('/branches', { name: 'Segunda' }).expect(409);
  });

  it('desactivar una sucursal conserva el registro y exige dejar una activa (escenario 11, parte de datos)', async () => {
    const list = (await h.as(OWNER_B, tenantB).get('/branches')).body;
    const second = list.find((b: any) => b.name === 'Segunda').id;
    const off = await h.as(OWNER_B, tenantB).post(`/branches/${second}/deactivate`).expect(200);
    expect(off.body.isActive).toBe(false);
    await h.as(OWNER_B, tenantB).post(`/branches/${branchB}/deactivate`).expect(409);
    expect((await h.as(OWNER_B, tenantB).get('/branches')).body).toHaveLength(2);
    await h.as(OWNER_B, tenantB).post(`/branches/${second}/activate`).expect(200);
  });
});
