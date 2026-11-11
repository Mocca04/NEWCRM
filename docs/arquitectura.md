# Arquitectura

El documento completo de arquitectura, modelo de datos y plan técnico está en
https://claude.ai/artifact/AEZfAm43cxk59TcHnjtXQg. Aquí queda lo que ya está
implementado y cómo usarlo.

## Aislamiento entre empresas

Tres capas independientes en la base de datos:

1. **Row-Level Security.** Toda tabla con `tenant_id` tiene la política
   `tenant_id = app.current_tenant_id()`, activa y forzada.
2. **Rol sin privilegios.** Cada transacción de empresa baja al rol `app_rls`,
   que no puede saltarse RLS. Lo hace `runAsTenant` en
   `packages/database/src/tenant-context.ts`:

   ```ts
   await runAsTenant(pool, tenantId, async (db) => {
     return db.query('SELECT * FROM customers'); // solo los de esa empresa
   });
   ```

   El rol y el `tenant_id` son locales a la transacción: no se filtran a la
   siguiente petición aunque la conexión se reutilice.
3. **Disparadores de referencia.** Por cada clave foránea entre tablas de
   empresa, un disparador (`app.tenant_guard`) rechaza la fila si apunta a un
   registro de otra empresa. `tenant_id` además es inmutable.

Las operaciones de plataforma (alta de empresas y usuarios, cobro de
suscripciones, worker) usan `runAsPlatform`, sin filtro, y deben auditarse.

> Cambio respecto al documento de arquitectura: allí se proponían claves
> foráneas compuestas `(tenant_id, id)`. Prisma no admite relaciones compuestas
> con una columna opcional y otra obligatoria, así que la misma garantía se
> implementó con disparadores.

## Reservas sin duplicados

`appointment_services` guarda el rango realmente ocupado (`occupied_start`,
`occupied_end`, con preparación y limpieza). La restricción de exclusión
`appointment_services_no_double_booking` impide solapes del mismo profesional
mientras la línea esté activa. Un disparador desactiva las líneas cuando la
cita pasa a Cancelada o No asistió, y eso libera el horario. Los recursos
físicos tienen la restricción equivalente.

Error que debe capturar el backend: código `23P01` → responder 409.

## Estados

Las transiciones de `appointments.status` y `reward_redemptions.status` las
valida la base de datos. Una transición inválida devuelve el código `23514`.

## Ledger de fidelización

- `loyalty_points_ledger` es de solo inserción: `UPDATE`, `DELETE` y `TRUNCATE`
  fallan con `55000` para cualquier rol.
- Cada inserción actualiza el saldo en caché de `loyalty_cards` en la misma
  transacción. El rol de aplicación no puede escribir esos saldos.
- `(tenant_id, idempotency_key)` es único: repetir un movimiento falla con `23505`.
- Una redención no puede dejar puntos en negativo; una reversión sí.
- `SELECT * FROM app.loyalty_balance_drift` debe devolver siempre cero filas.

## Dinero y fechas

Dinero en enteros, en centavos de COP. Fechas en `timestamptz`; cada sucursal
tiene su zona horaria (`America/Bogota` por defecto).

## API: quién es, a qué empresa entra y qué puede hacer

Cada petición pasa por dos guardas globales, en este orden:

1. **`AuthGuard`** valida el token de sesión de Supabase (firma ES256/RS256
   contra las llaves públicas del proyecto, vencimiento, emisor y audiencia) y
   resuelve el usuario interno. En el primer inicio de sesión lo crea; si la
   persona fue invitada, la enlaza solo cuando Supabase confirma su correo.
2. **`TenantGuard`** toma la empresa de la cabecera `X-Tenant-Id`, busca la
   membresía activa del usuario y carga los permisos de su rol **desde la base
   en cada petición**. Por eso quitar un permiso o desactivar a alguien tiene
   efecto inmediato, sin esperar a que venza el token. Responde 403 igual si
   la empresa no existe o si el usuario no pertenece a ella.

Decoradores de ruta: `@Public()` (sin sesión), `@NoTenant()` (con sesión, sin
empresa), `@RequirePermissions('codigo')`.

Dentro de un controlador, todo acceso a datos de empresa va por
`db.forTenant(tenant.id, tx => ...)`, que aplica RLS. `db.platform` no filtra y
se reserva para identidad y alta de empresas.

Reglas contra la escalada de privilegios:

- Nadie concede un permiso que no tiene, ni asigna o modifica un rol con más
  permisos que el suyo.
- Nadie modifica su propio acceso ni su propio rol.
- El rol Propietario no se edita y la empresa conserva siempre un Propietario activo.

Límites por plan: los decide el backend. Crear o reactivar una sucursal por
encima de `max_branches` responde 402.
