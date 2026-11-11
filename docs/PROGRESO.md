# Documento de progreso

Última actualización: 10 de noviembre de 2026 · Fase 1 **terminada y verificada en integración continua**; sigue la fase 2

## Funcionalidades terminadas

### Fase 1 · Modelo de datos y seguridad de la base

- Repositorio con pnpm, `docker-compose.yml`, `.env.example` e integración continua.
- Esquema Prisma con 42 tablas y 22 enumeraciones: las 30 entidades del prompt más 12 de apoyo.
- Migración inicial (tablas, índices, claves foráneas).
- Migración de seguridad: RLS forzado en 40 tablas, rol `app_rls`, 50 disparadores contra referencias entre empresas, 5 restricciones de exclusión, estados de cita y de canje validados en la base, ledger y auditoría de solo inserción, saldos derivados del ledger, pagos aprobados inmutables.
- Datos de referencia: 22 códigos de permiso y los 4 planes (precios en 0).
- `runAsTenant` y `runAsPlatform` para abrir transacciones con o sin filtro de empresa.

## Funcionalidades pendientes

- Fase 1: `apps/api` y `apps/web` no se crearon; se crean al iniciar la fase 2, cuando tengan contenido real.
- Fases 2 a 14 completas. Ver el plan en el documento de arquitectura.

## Errores conocidos y puntos sin verificar

Ninguno abierto. Los cinco puntos que quedaron sin verificar al construir la fase 1 se resolvieron en la primera ejecución de la integración continua (11 de noviembre de 2026):

- `prisma validate`, `prisma generate` y `prisma migrate deploy` corren sin errores sobre una base vacía.
- `prisma migrate diff` reporta "No difference detected": las migraciones escritas a mano coinciden con `schema.prisma`, y Prisma no intenta borrar las restricciones de exclusión, los disparadores ni las políticas. Ese paso ahora bloquea la integración continua.
- Las 32 pruebas pasan también en PostgreSQL 17.

Notas de versiones: Prisma fijado en 7.10.1 (decisión 7) y TypeScript en 5.9, porque las herramientas de pruebas aún no admiten TypeScript 7. NestJS va por la versión 12; se usará esa en la fase 2.

Limitación del entorno de desarrollo de Claude: no puede descargar los motores de Prisma, así que los comandos de Prisma solo se verifican en la integración continua de GitHub.

## Pruebas realizadas

32 pruebas automáticas contra PostgreSQL real (versiones 16 y 17), todas en verde (`pnpm test`):

| Área | Qué comprueba | Escenario del prompt |
| --- | --- | --- |
| Migraciones | Se aplican en orden sobre una base vacía | Cierre de fase 1 |
| RLS | Todas las tablas con `tenant_id` tienen RLS forzado y política | 2 |
| Aislamiento | Una empresa no ve, inserta, modifica ni borra datos de otra; sin contexto no se ve nada; el contexto no se filtra entre transacciones | 2 |
| Referencias | Una cita no puede apuntar a un cliente ni a un profesional de otra empresa | 2 |
| Doble reserva | Solape rechazado; preparación y limpieza cuentan; con 4 reservas simultáneas queda exactamente 1; cancelar libera el horario; recursos físicos | 1 |
| Estados de cita | Flujo permitido; completar dos veces solo tiene efecto una | 3 |
| Ledger | Saldo derivado; sin duplicados por llave ni por cita y campaña; inalterable incluso para la plataforma; la empresa no escribe saldos | 4 |
| Reversión | Apunta al original, una sola vez, puede dejar saldo negativo | 5 |
| Canje | Con 3 validaciones simultáneas la recompensa se usa una vez | 6 |
| Pagos | Pago aprobado inmutable; reembolso como fila negativa enlazada | 5 |

Los escenarios 7 a 12 dependen de módulos de fases posteriores.

## Dependencias

| Necesidad | Para | Estado |
| --- | --- | --- |
| Proyecto de Supabase | Fase 2: autenticación y base de datos alojada | Por crear |
| Apple Developer, emisor de Google Wallet, Wompi | Etapa 2 | Trámites por iniciar |
| Meta Business verificado | Etapa 3 | Trámite por iniciar |

## Próximas tareas

1. Revisión de la fase 1 contigo.
2. Fase 2: `apps/api` con NestJS, autenticación con Supabase, empresas, sucursales, miembros, roles y permisos; cliente Prisma con contexto de empresa; escenarios 2 y 10 a nivel de API.
