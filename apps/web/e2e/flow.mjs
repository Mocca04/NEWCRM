// Recorrido de punta a punta en un navegador real: registro, alta del negocio,
// sucursales, equipo, datos del negocio y acceso de un empleado invitado.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:3112';
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const steps = [];
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  console.log(`ok  ${name}`);
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const submit = (page, label) => page.getByRole('button', { name: label, exact: true }).click();
// En celular, Sucursales y Equipo se abren desde Negocio; en computador están en el menú.
const open = async (page, name) => {
  if (!(await page.getByRole('link', { name, exact: true }).first().isVisible())) {
    await page.getByRole('link', { name: 'Negocio', exact: true }).click();
    await page.getByRole('heading', { name: 'Datos del negocio' }).waitFor();
  }
  await page.getByRole('link', { name, exact: true }).first().click();
};
// Próximo lunes en Bogotá (el profesional de la prueba solo trabaja los lunes).
const bogotaToday = new Date(Date.now() - 5 * 3_600_000);
const monday = new Date(Date.UTC(bogotaToday.getUTCFullYear(), bogotaToday.getUTCMonth(), bogotaToday.getUTCDate() + (((8 - bogotaToday.getUTCDay()) % 7) || 7))).toISOString().slice(0, 10);
const newAppointment = async (page) => {
  await page.getByRole('link', { name: 'Nueva cita' }).click();
  await page.getByRole('heading', { name: 'Nueva cita' }).waitFor();
  await page.getByRole('checkbox', { name: /^Corte/ }).check();
  await page.getByLabel('Día').fill(monday);
  await submit(page, 'Ver horas disponibles');
  await page.getByRole('button', { name: 'Agendar cita' }).waitFor();
};
const card = (page, tag, heading) => page.locator(tag, { has: page.getByRole('heading', { name: heading, exact: true }) });

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await phone.newPage();

  await step('sin sesión, el panel lleva a iniciar sesión', async () => {
    await page.goto(`${WEB}/panel`);
    await page.waitForURL('**/login');
    await shot(page, 'movil-login');
  });

  await step('registro de la duena', async () => {
    await page.goto(`${WEB}/registro`);
    await page.getByLabel('Tu nombre').fill('Sofia Arango');
    await page.getByLabel('Correo').fill('sofia@example.com');
    await page.getByLabel('Contraseña').fill('una-clave-larga');
    await submit(page, 'Crear cuenta');
    await page.waitForURL('**/panel/nueva-empresa');
    await shot(page, 'movil-nueva-empresa');
  });

  await step('la dirección web inválida se rechaza con un mensaje claro', async () => {
    await page.getByLabel('Nombre del negocio').fill('Estudio Sofia');
    await page.getByLabel('Dirección web').fill('admin');
    await submit(page, 'Registrar negocio');
    await page.getByRole('alert').filter({ hasText: 'no está disponible' }).waitFor();
  });

  await step('alta del negocio', async () => {
    await page.getByLabel('Dirección web').fill('estudio-sofia');
    await page.getByLabel('Ciudad').fill('Tulua');
    await submit(page, 'Registrar negocio');
    await page.waitForURL(/\/panel$/);
    await page.getByRole('heading', { name: 'Hola, Sofia' }).waitFor();
    assert.match(await page.locator('main').innerText(), /plataforma\.com\/estudio-sofia/);
    await shot(page, 'movil-inicio');
  });

  await step('sucursales: la principal existe y el plan frena la segunda', async () => {
    await open(page, 'Sucursales');
    await page.getByRole('heading', { name: 'Principal' }).waitFor();
    const add = page.locator('section', { hasText: 'Agregar sucursal' });
    await add.getByLabel('Nombre').fill('Sede Norte');
    await add.getByRole('button', { name: 'Agregar sucursal' }).click();
    await add.getByRole('alert').filter({ hasText: 'plan Negocio' }).waitFor();
    await shot(page, 'movil-sucursales');
  });

  await step('editar la sucursal principal', async () => {
    await page.getByText('Editar', { exact: true }).click();
    const card = page.locator('li', { hasText: 'Principal' });
    await card.getByLabel('Dirección').fill('Calle 26 # 24-10');
    await card.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByText('Calle 26 # 24-10, Tulua').waitFor();
  });

  await step('equipo: dar acceso a una recepcionista', async () => {
    await open(page, 'Equipo');
    const invite = page.locator('section', { hasText: 'Dar acceso a alguien' });
    await invite.getByLabel('Nombre').fill('Laura Rios');
    await invite.getByLabel('Correo').fill('laura@example.com');
    await invite.getByRole('button', { name: 'Dar acceso' }).click();
    await invite.getByRole('status').filter({ hasText: 'laura@example.com ya tiene acceso' }).waitFor();
    await page.getByText('Aún no ha entrado').waitFor();
    await shot(page, 'movil-equipo');
  });

  await step('datos del negocio', async () => {
    await page.getByRole('link', { name: 'Negocio', exact: true }).click();
    await page.getByLabel('Teléfono').fill('3001234567');
    await page.getByLabel('NIT').fill('900123456-7');
    await submit(page, 'Guardar datos');
    await page.getByRole('status').filter({ hasText: 'Datos guardados' }).waitFor();
    await page.reload();
    assert.equal(await page.getByLabel('Teléfono').inputValue(), '3001234567');
    await shot(page, 'movil-negocio');
  });

  await step('servicios: cargar la lista de barbería', async () => {
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await shot(page, 'movil-servicios-vacio');
    await submit(page, 'Barbería');
    await page.getByRole('heading', { name: 'Corte y barba', exact: true }).waitFor();
    assert.equal(await page.getByText('Sin precio', { exact: true }).count(), 6);
  });

  await step('servicios: no se publica un servicio sin precio', async () => {
    const barba = card(page, 'li', 'Barba');
    await barba.getByText('Editar', { exact: true }).click();
    await barba.getByLabel('Mostrarlo a los clientes').check();
    await barba.getByRole('button', { name: 'Guardar cambios' }).click();
    await barba.getByRole('alert').filter({ hasText: 'Ponle precio' }).waitFor();
  });

  await step('servicios: poner precio y publicar', async () => {
    const corte = card(page, 'li', 'Corte');
    await corte.getByText('Editar', { exact: true }).click();
    await corte.getByLabel('Precio').fill('25000');
    await corte.getByLabel('Limpieza después').fill('5');
    await corte.getByLabel('Mostrarlo a los clientes').check();
    await corte.getByRole('button', { name: 'Guardar cambios' }).click();
    await corte.getByText(/25\.000/).first().waitFor();
    assert.equal(await page.getByText('Sin precio', { exact: true }).count(), 5);
    await shot(page, 'movil-servicios');
  });

  await step('profesionales: agregar con sus servicios', async () => {
    await open(page, 'Profesionales');
    const add = page.locator('section', { hasText: 'Agregar profesional' });
    await add.getByLabel('Nombre').fill('Camilo Paz');
    await add.getByLabel('Corte', { exact: true }).check();
    await add.getByRole('button', { name: 'Agregar profesional' }).click();
    await add.getByRole('status').filter({ hasText: 'Camilo Paz agregado' }).waitFor();
    await card(page, 'li', 'Camilo Paz').getByText('Sin horario').waitFor();
  });

  await step('profesionales: horario con descanso, y aviso si falta una hora', async () => {
    const camilo = card(page, 'li', 'Camilo Paz');
    await camilo.getByText('Horario', { exact: true }).click();
    await camilo.getByLabel('Martes', { exact: true }).check();
    await camilo.getByRole('button', { name: 'Guardar horario' }).click();
    await camilo.getByRole('alert').filter({ hasText: 'del martes' }).waitFor();
    await camilo.getByLabel('Martes', { exact: true }).uncheck();
    await camilo.getByLabel('Lunes', { exact: true }).check();
    await camilo.getByLabel('Lunes: hora de entrada').fill('09:00');
    await camilo.getByLabel('Lunes: hora de salida').fill('18:00');
    await camilo.getByLabel('Lunes: inicio del descanso').fill('13:00');
    await camilo.getByLabel('Lunes: fin del descanso').fill('14:00');
    await camilo.getByRole('button', { name: 'Guardar horario' }).click();
    await camilo.getByText('09:00 a 13:00 y 14:00 a 18:00').waitFor();
    await shot(page, 'movil-profesionales');
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await card(page, 'li', 'Corte').getByText('1 profesional').waitFor();
  });

  await step('agenda: ver horas libres y agendar', async () => {
    await page.getByRole('link', { name: 'Agenda', exact: true }).click();
    await page.getByText('No hay citas este día').waitFor();
    await shot(page, 'movil-agenda-vacia');
    await newAppointment(page);
    // Trabaja de 9 a 6 con descanso de 1 a 2: no se ofrece la 1 p. m. ni después de las 5:15.
    assert.equal(await page.getByText(/^9:00\sa\.\sm\.$/).count(), 1);
    assert.equal(await page.getByText(/^1:00\sp\.\sm\.$/).count(), 0);
    assert.equal(await page.getByText(/^5:30\sp\.\sm\.$/).count(), 0);
    await shot(page, 'movil-nueva-cita');
    await page.getByText(/^10:00\sa\.\sm\.$/).click();
    await page.getByLabel('Nombre del cliente', { exact: true }).fill('Marta Ruiz');
    await page.locator('section', { hasText: 'Agendar cita' }).getByLabel(/^Celular/).fill('300 111 2233');
    await submit(page, 'Agendar cita');
    await page.waitForURL(`**/panel/agenda?fecha=${monday}`);
    const marta = card(page, 'li', 'Marta Ruiz');
    await marta.getByText('Confirmada').waitFor();
    await marta.getByText(/10:00\sa\.\sm\. a 10:30\sa\.\sm\./).waitFor();
  });

  await step('agenda: el horario ocupado deja de ofrecerse', async () => {
    await newAppointment(page);
    assert.equal(await page.getByText(/^10:00\sa\.\sm\.$/).count(), 0);
    assert.equal(await page.getByText(/^10:15\sa\.\sm\.$/).count(), 0);
    await page.getByText(/^11:00\sa\.\sm\.$/).click();
    await page.getByLabel('Nombre del cliente', { exact: true }).fill('Pedro Gil');
    await page.locator('section', { hasText: 'Agendar cita' }).getByLabel(/^Celular/).fill('3005556677');
    await submit(page, 'Agendar cita');
    await page.waitForURL(`**/panel/agenda?fecha=${monday}`);
    await card(page, 'li', 'Pedro Gil').waitFor();
  });

  await step('agenda: mover una cita y que no caiga sobre otra', async () => {
    const pedro = card(page, 'li', 'Pedro Gil');
    await pedro.getByText('Mover', { exact: true }).click();
    await pedro.getByLabel('Nueva hora').fill('10:15');
    await pedro.getByRole('button', { name: 'Mover cita' }).click();
    await pedro.getByRole('alert').filter({ hasText: 'ya tiene ese horario ocupado' }).waitFor();
    await pedro.getByLabel('Nueva hora').fill('15:00');
    await pedro.getByRole('button', { name: 'Mover cita' }).click();
    await card(page, 'li', 'Pedro Gil').getByText(/3:00\sp\.\sm\. a 3:30\sp\.\sm\./).waitFor();
  });

  await step('agenda: iniciar, completar y cancelar', async () => {
    const marta = card(page, 'li', 'Marta Ruiz');
    await marta.getByRole('button', { name: 'Iniciar atención' }).click();
    await marta.getByText('En atención').waitFor();
    await marta.getByRole('button', { name: 'Completar' }).click();
    await marta.getByText('Completada').waitFor();
    assert.equal(await marta.getByRole('button').count(), 0);
    const pedro = card(page, 'li', 'Pedro Gil');
    await pedro.getByText('Cancelar', { exact: true }).click();
    await pedro.getByLabel('Motivo').fill('Avisó que no puede');
    await pedro.getByRole('button', { name: 'Cancelar cita' }).click();
    await pedro.getByText('Cancelada').waitFor();
    await pedro.getByText('Motivo: Avisó que no puede').waitFor();
    await shot(page, 'movil-agenda-dia');
  });

  await step('agenda: vistas de semana y mes', async () => {
    await page.getByRole('link', { name: 'Semana', exact: true }).click();
    await page.getByText('Marta Ruiz').waitFor();
    await page.getByText('Corte con Camilo Paz').first().waitFor();
    await shot(page, 'movil-agenda-semana');
    await page.getByRole('link', { name: 'Mes', exact: true }).click();
    await page.getByRole('link', { name: /: 1 cita$/ }).waitFor();
    await shot(page, 'movil-agenda-mes');
  });

  await step('agenda: cliente sin reserva', async () => {
    await page.getByRole('link', { name: 'Nueva cita' }).click();
    const walkIn = page.locator('section', { hasText: 'Llegó sin reserva' });
    await walkIn.getByLabel('Nombre del cliente sin reserva').fill('Sara Paz');
    await walkIn.getByLabel('Celular del cliente sin reserva').fill('3009998877');
    await walkIn.getByRole('button', { name: 'Atender ahora' }).click();
    await page.waitForURL(/\/panel\/agenda\?fecha=\d{4}-\d{2}-\d{2}$/);
    const sara = card(page, 'li', 'Sara Paz');
    await sara.getByText('En atención').waitFor();
    await sara.getByText(/sin reserva/).waitFor();
    await page.getByRole('link', { name: 'Inicio', exact: true }).click();
    await page.locator('section', { hasText: 'Hoy' }).getByText('Sara Paz').waitFor();
    await shot(page, 'movil-inicio-con-citas');
  });

  await step('cerrar sesión y contraseña equivocada', async () => {
    await submit(page, 'Cerrar sesión');
    await page.waitForURL('**/login');
    await page.getByLabel('Correo').fill('sofia@example.com');
    await page.getByLabel('Contraseña').fill('otra-clave');
    await submit(page, 'Iniciar sesión');
    await page.getByRole('alert').filter({ hasText: 'no coinciden' }).waitFor();
  });

  await step('la recepcionista invitada entra y ve solo lo de su rol', async () => {
    await page.goto(`${WEB}/registro`);
    await page.getByLabel('Tu nombre').fill('Laura Rios');
    await page.getByLabel('Correo').fill('laura@example.com');
    await page.getByLabel('Contraseña').fill('otra-clave-larga');
    await submit(page, 'Crear cuenta');
    await page.waitForURL(/\/panel$/);
    await page.getByText('Estudio Sofia', { exact: true }).first().waitFor();
    await open(page, 'Equipo');
    await page.getByText('no puede ver ni cambiar los accesos').waitFor();
    await open(page, 'Sucursales');
    await page.getByRole('heading', { name: 'Principal' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Agregar sucursal' }).count(), 0);
    await page.getByRole('link', { name: 'Negocio', exact: true }).click();
    assert.equal(await page.getByLabel('Teléfono').isDisabled(), true);
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await page.getByRole('heading', { name: 'Corte', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Agregar servicio' }).count(), 0);
    assert.equal(await page.getByText('Editar', { exact: true }).count(), 0);
    await open(page, 'Profesionales');
    await page.getByRole('heading', { name: 'Camilo Paz' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Agregar profesional' }).count(), 0);
    // Recepción sí puede agendar.
    await page.getByRole('link', { name: 'Agenda', exact: true }).click();
    await page.getByRole('link', { name: 'Nueva cita' }).waitFor();
  });

  await step('vista de escritorio', async () => {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const wide = await desktop.newPage();
    await wide.goto(`${WEB}/login`);
    await shot(wide, 'escritorio-login');
    await wide.getByLabel('Correo').fill('sofia@example.com');
    await wide.getByLabel('Contraseña').fill('una-clave-larga');
    await submit(wide, 'Iniciar sesión');
    await wide.waitForURL(/\/panel$/);
    await wide.getByRole('link', { name: 'Equipo', exact: true }).click();
    await wide.getByRole('heading', { name: 'Laura Rios' }).waitFor();
    await shot(wide, 'escritorio-equipo');
    await wide.getByRole('link', { name: 'Profesionales', exact: true }).click();
    await wide.getByRole('heading', { name: 'Camilo Paz' }).waitFor();
    await shot(wide, 'escritorio-profesionales');
    await wide.goto(`${WEB}/panel/agenda?fecha=${monday}`);
    await wide.getByRole('heading', { name: 'Marta Ruiz' }).waitFor();
    await shot(wide, 'escritorio-agenda');
  });

  console.log(`\n${steps.length} pasos correctos`);
} finally {
  await browser.close();
}
