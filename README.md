# NEWCRM

Plataforma SaaS de agenda, CRM y fidelización para manicuristas, barberías, peluquerías y estilistas en Colombia.

Estado: **fase 2 de 14**. Están listos el modelo de datos, la API de identidad, empresas, sucursales, miembros y roles, y el panel web para esas mismas funciones. El avance detallado está en [docs/PROGRESO.md](docs/PROGRESO.md).

## Qué hay en el repositorio

```
apps/web/               Panel web Next.js: acceso, registro del negocio, sucursales, equipo
apps/api/               API NestJS: autenticación, empresas, sucursales, miembros, roles
packages/database/      esquema Prisma, migraciones SQL y pruebas de la base de datos
docs/                   progreso, arquitectura e instalación
docker-compose.yml      PostgreSQL y Redis para desarrollo local
.env.example            todas las variables que el proyecto va a necesitar
.github/workflows/      integración continua
```


## Empezar

Requisitos: Node.js 22 o superior, pnpm 10 y Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # levanta PostgreSQL y Redis
pnpm db:migrate     # aplica las migraciones
pnpm db:generate    # genera el cliente Prisma
pnpm test           # pruebas contra PostgreSQL real
pnpm --filter @newcrm/api start:dev   # API en http://localhost:3001/api/v1 (documentación en /api/docs)
pnpm --filter @newcrm/web dev         # panel en http://localhost:3000
```

Guía completa: [docs/instalacion.md](docs/instalacion.md).
