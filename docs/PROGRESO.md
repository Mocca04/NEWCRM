# Documento de progreso

Última actualización: 11 de noviembre de 2026 · Fase 1 terminada · Fase 2: **API terminada, interfaz web pendiente**

## Funcionalidades terminadas

### Fase 1 · Modelo de datos y seguridad de la base

- Repositorio con pnpm, `docker-compose.yml`, `.env.example` e integración continua.
- Esquema Prisma con 42 tablas y 22 enumeraciones: las 30 entidades del prompt más 12 de apoyo.
- Migración inicial (tablas, índices, claves foráneas).
- Migración de seguridad: RLS forzado en 40 tablas, rol `app_rls`, 50 disparadores contra referencias entre empresas, 5 restricciones de exclusión, estados de cita y de canje validados en la base, ledger y auditoría de solo inserción, saldos derivados del ledger, pagos aprobados inmutables.
- Datos de referencia: 22 códigos de permiso y los 4 planes (precios en 0).
- `runAsTenant` y `runAsPlatform` para abrir transacciones con o sin filtro de empresa.

### Fase 2 · Autenticación, empresas y sucursales (API)

- `apps/api` con NestJS 11, documentada con Swagger en `/api/docs`.
- Validación de sesiones de Supabase Auth con las llaves públicas del proyecto (sin secretos en el backend).
- Registro de empresa: crea la empresa, los cuatro roles con sus permisos, la sucursal principal, al propietario y un periodo de prueba.
- Sucursales: listar, crear, editar, desactivar y reactivar, con el límite de sucursales del plan aplicado en el backend (402).
- Miembros: invitar por correo, cambiar rol, limitar a sucursales, desactivar.
- Roles: los cuatro de sistema más roles personalizados; edición de permisos.
- Permisos leídos en cada petición (efecto inmediato) y reglas contra la escalada de privilegios.
- Auditoría de altas, cambios de rol, permisos y datos de empresa.
- Cliente Prisma con contexto de empresa (`forTenant`).

Rutas: `GET /health`, `GET /me`, `POST /tenants`, `GET|PATCH /tenant`, `GET|POST /branches`, `PATCH /branches/:id`, `POST /branches/:id/deactivate|activate`, `GET|POST /members`, `PATCH /members/:id`, `GET /permissions`, `GET|POST /roles`, `PUT /roles/:id/permissions`.

## Funcionalidades pendientes

- Fase 2: `apps/web` (inicio de sesión, registro de empresa, pantallas de sucursales y miembros).
- Fase 2: eliminación de una empresa y transferencia de propiedad.
- Fases 3 a 14. Ver el plan en el documento de arquitectura.

## Errores conocidos y puntos sin verificar

1. **Inicio de sesión real con Supabase sin probar.** El entorno de desarrollo de Claude no puede conectarse a `supabase.co`. Las pruebas firman tokens con el mismo formato de Supabase (ES256) usando una llave local, y la API los valida con su verificador real; lo que falta comprobar es un inicio de sesión de verdad contra el proyecto. Se comprueba al conectar la interfaz web.
2. **Proyectos antiguos de Supabase (HS256).** Hay soporte con `SUPABASE_JWT_SECRET`, pero esa ruta no tiene prueba automática.
3. **El periodo de prueba no vence solo.** La empresa nace con una suscripción en prueba; el corte al vencer llega con la fase 11.

Resueltos: los cinco puntos abiertos de la fase 1 se cerraron en la primera ejecución de la integración continua (Prisma valida, genera y migra; `prisma migrate diff` no reporta diferencias; pruebas en verde en PostgreSQL 17).

Notas de versiones y entorno:

- **NestJS 11, no 12.** La versión 12 solo se distribuye como módulos ES, incompatibles con las herramientas de pruebas actuales del proyecto. La 11 sigue recibiendo parches.
- Prisma fijado en 7.10.1 (decisión 7) y TypeScript en 5.9.
- **Rama `prisma-client`.** El entorno de desarrollo de Claude no puede descargar los motores de Prisma. La integración continua genera el cliente y lo publica en esa rama, de donde se toma para desarrollar. No se debe editar ni fusionar; se puede eliminar si se trabaja solo desde un computador propio.

## Pruebas realizadas

54 pruebas automáticas contra PostgreSQL real, todas en verde (`pnpm test`): 36 de base de datos y 18 de la API de extremo a extremo.

Base de datos:

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

API (peticiones HTTP reales contra la aplicación completa):

| Área | Qué comprueba | Escenario del prompt |
| --- | --- | --- |
| Autenticación | Rechaza sin token, firma falsa, token vencido, otro emisor, otra audiencia y `alg: none` | Seguridad |
| Registro | Validación de datos, direcciones reservadas y repetidas, alta completa de la empresa | Fase 2 |
| Aislamiento | Un usuario no entra a una empresa ajena ni toca sus sucursales, roles o miembros | 2 |
| Permisos | Con el mismo token, perder el rol, un permiso o el acceso se aplica en la siguiente petición | 10 |
| Escalada | Nadie concede permisos que no tiene, ni toca al propietario, ni su propio acceso | Seguridad |
| Sucursales | Miembro limitado a una sucursal; límite del plan (402) y cambio de plan inmediato; desactivar conserva datos | 9 y 11 (parcial) |
| Auditoría | Los cambios sensibles quedan registrados en la empresa correcta | Seguridad |

Los escenarios 7 y 8, y lo que falta de 9, 11 y 12, dependen de módulos de fases posteriores.

## Dependencias

| Necesidad | Para | Estado |
| --- | --- | --- |
| Proyecto de Supabase | Autenticación y base de datos alojada | Creado (`zvvfxagpyiibfjmwbsqz`). Falta la cadena de conexión de la base para aplicar las migraciones allí |
| Apple Developer, emisor de Google Wallet, Wompi | Etapa 2 | Trámites por iniciar |
| Meta Business verificado | Etapa 3 | Trámite por iniciar |

## Próximas tareas

1. `apps/web`: inicio de sesión con Supabase, registro de empresa y pantallas de sucursales y miembros.
2. Aplicar las migraciones al proyecto de Supabase y desplegar API y web en un entorno de pruebas.
3. Probar un inicio de sesión real de punta a punta (cierra el punto 1 de errores conocidos).
4. Revisión de la fase 2 contigo y paso a la fase 3 (servicios, profesionales y horarios).
