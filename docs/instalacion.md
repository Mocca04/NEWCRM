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
6. Ejecutar las pruebas: `pnpm test`

Las pruebas crean y destruyen su propia base (`newcrm_test`); no tocan la base de desarrollo.

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
