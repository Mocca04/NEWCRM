# Instalación local

## Requisitos

| Herramienta | Versión | Para qué |
| --- | --- | --- |
| Node.js | 22 o superior | Ejecutar el proyecto |
| pnpm | 10 | Instalar dependencias (`npm i -g pnpm`) |
| Docker | cualquiera reciente | PostgreSQL y Redis locales |

## Pasos

1. Instalar dependencias: `pnpm install`
2. Crear el archivo de variables: `cp .env.example .env`. Para la fase 1 los valores por defecto funcionan sin cambios.
3. Levantar los servicios: `pnpm db:up`
4. Crear la base sombra que Prisma usa en desarrollo (una sola vez):
   `docker compose exec postgres psql -U postgres -c "CREATE DATABASE newcrm_shadow"`
5. Aplicar las migraciones: `pnpm db:migrate`
6. Generar el cliente Prisma: `pnpm db:generate`
7. Ejecutar las pruebas: `pnpm test`
8. Arrancar la API: crear `apps/api/.env` con `DATABASE_URL` y `SUPABASE_URL`, y ejecutar `pnpm --filter @newcrm/api start:dev`. La documentación interactiva queda en `http://localhost:3001/api/docs`.
9. Arrancar la web: crear `apps/web/.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `API_URL` y `NEXT_PUBLIC_SITE_URL`, y ejecutar `pnpm --filter @newcrm/web dev`. El panel queda en `http://localhost:3000`.
10. Recorrido en navegador (requiere Google Chrome): `pnpm --filter @newcrm/web e2e`.

Las pruebas crean y destruyen sus propias bases (`newcrm_test`, `newcrm_api_test` y `newcrm_web_e2e`); no tocan la base de desarrollo.

## Cambiar el modelo de datos

1. Editar `packages/database/prisma/schema.prisma`.
2. Crear la migración: `pnpm --filter @newcrm/database migrate:dev --name descripcion_corta`.
3. Si la migración crea tablas con `tenant_id` o claves foráneas nuevas, agregar al final del SQL generado:

   ```sql
   SELECT app.enable_tenant_rls();
   SELECT app.install_tenant_guards();
   ```

   La prueba "toda tabla con tenant_id tiene RLS" falla si se olvida la primera línea.
4. Ejecutar `pnpm --filter @newcrm/database migrate:check`: debe responder "No difference detected".

## Usar Supabase en lugar de Docker

Poner en `DATABASE_URL` la cadena de conexión directa del proyecto de Supabase (no la del agrupador en modo transacción para migrar) y ejecutar `pnpm db:migrate`. La migración de seguridad crea el rol `app_rls` y activa la extensión `btree_gist`.

## Configurar Supabase Auth para la web

En el panel de Supabase, en Authentication:

1. **URL Configuration.** Poner en "Site URL" la dirección pública de la web y añadir `<esa dirección>/auth/confirm` a "Redirect URLs".
2. **Plantilla de correo "Confirm signup".** El enlace debe apuntar a la web:
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
3. Mantener activa la confirmación de correo: es lo que impide que alguien reclame una invitación con un correo que no es suyo.
