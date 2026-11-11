# NEWCRM

Plataforma SaaS de agenda, CRM y fidelización para manicuristas, barberías, peluquerías y estilistas en Colombia.

Estado: **fase 1 de 14** (modelo de datos y seguridad de la base). Todavía no hay API ni interfaz. El avance detallado está en [docs/PROGRESO.md](docs/PROGRESO.md).

## Qué hay en el repositorio

```
packages/database/      esquema Prisma, migraciones SQL y pruebas de la base de datos
docs/                   progreso, arquitectura e instalación
docker-compose.yml      PostgreSQL y Redis para desarrollo local
.env.example            todas las variables que el proyecto va a necesitar
.github/workflows/      integración continua
```

`apps/api` (NestJS) y `apps/web` (Next.js) se crean en la fase 2.

## Empezar

Requisitos: Node.js 22 o superior, pnpm 10 y Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # levanta PostgreSQL y Redis
pnpm db:migrate     # aplica las migraciones
pnpm test           # pruebas contra PostgreSQL real
```

Guía completa: [docs/instalacion.md](docs/instalacion.md).
