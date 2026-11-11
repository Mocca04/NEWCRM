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
    await page.getByRole('link', { name: 'Sucursales', exact: true }).click();
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
    await page.getByRole('link', { name: 'Equipo', exact: true }).click();
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
    await page.getByRole('link', { name: 'Equipo', exact: true }).click();
    await page.getByText('no puede ver ni cambiar los accesos').waitFor();
    await page.getByRole('link', { name: 'Sucursales', exact: true }).click();
    await page.getByRole('heading', { name: 'Principal' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Agregar sucursal' }).count(), 0);
    await page.getByRole('link', { name: 'Negocio', exact: true }).click();
    assert.equal(await page.getByLabel('Teléfono').isDisabled(), true);
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
  });

  console.log(`\n${steps.length} pasos correctos`);
} finally {
  await browser.close();
}
