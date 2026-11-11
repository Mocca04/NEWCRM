# Documento de progreso

Última actualización: 11 de noviembre de 2026 · Fases 1 a 3 construidas y probadas en local y en integración continua · **Falta probarlas contra Supabase real en un entorno desplegado**

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

Panel web (`apps/web`, Next.js 16):

- Crear cuenta, iniciar y cerrar sesión con Supabase Auth; confirmación de correo por enlace.
- Registro del negocio en un paso.
- Inicio, Sucursales (agregar, editar, desactivar, reactivar), Equipo (dar acceso, cambiar rol, quitar acceso) y Negocio (datos).
- Cada pantalla muestra solo lo que el rol permite; el token de sesión nunca llega al navegador más allá de la cookie de Supabase: todas las llamadas a la API salen del servidor de la web.
- Pensado primero para celular: barra de secciones abajo, campos grandes; en computador, menú lateral.

Rutas de la API: `GET /health`, `GET /me`, `POST /tenants`, `GET|PATCH /tenant`, `GET|POST /branches`, `PATCH /branches/:id`, `POST /branches/:id/deactivate|activate`, `GET|POST /members`, `PATCH /members/:id`, `GET /permissions`, `GET|POST /roles`, `PUT /roles/:id/permissions`.

### Fase 3 · Servicios, profesionales y horarios

API:

- Categorías y servicios: precio, duración, preparación, limpieza, anticipo, tipo de recurso, publicación en el portal y profesionales habilitados. Eliminar un servicio lo retira sin perder el historial.
- Catálogo inicial cargable de las tres verticales (barbería, manicure y peluquería) con los servicios del prompt. Entra sin precio y sin publicar; cargarlo dos veces no duplica.
- Tarifas distintas por profesional y por sucursal.
- Profesionales: sucursal, especialidades, comisión, servicios que prestan, activar y desactivar, con el límite de profesionales del plan aplicado en el backend (402).
- Horario semanal por profesional, con varios tramos por día (el hueco entre tramos es el descanso).
- Bloqueos, vacaciones y festivos por profesional, sucursal o todo el negocio.
- Recursos físicos (sillas, cabinas) por sucursal.
- Un miembro limitado a ciertas sucursales solo ve y gestiona los profesionales, bloqueos y recursos de esas sucursales.
- Dinero en centavos de COP en toda la API; la web lo muestra y lo recibe en pesos.

Panel web:

- Servicios: cargar una lista hecha, agregar, editar, poner precio, publicar, asignar profesionales, eliminar. No deja publicar un servicio sin precio.
- Profesionales: agregar, asignar servicios, definir el horario día por día con descanso, editar datos y comisión, desactivar.
- En celular la barra inferior queda en cuatro secciones (Inicio, Servicios, Profesionales, Negocio); Sucursales y Equipo se abren desde Negocio.

Rutas nuevas: `GET|POST /service-categories`, `PATCH|DELETE /service-categories/:id`, `POST /catalog/templates`, `GET|POST /services`, `PATCH|DELETE /services/:id`, `PUT /services/:id/prices`, `GET|POST /employees`, `PATCH /employees/:id`, `POST /employees/:id/deactivate|activate`, `PUT /employees/:id/services`, `PUT /employees/:id/schedule`, `GET|POST /time-blocks`, `DELETE /time-blocks/:id`, `GET|POST /resources`, `PATCH /resources/:id`.

## Funcionalidades pendientes

- Fase 2: recuperación de contraseña, envío de correo al invitar a un miembro, edición de roles personalizados y selector de negocio en celular (la API ya los soporta salvo el correo).
- Fase 2: eliminación de una empresa y transferencia de propiedad.
- Fase 3: pantallas para bloqueos y festivos, recursos físicos y tarifas por profesional (la API ya está; las pantallas se hacen junto con la agenda, donde se usan). Foto del profesional e imagen del servicio (dependen del almacenamiento de archivos). Vincular un profesional con su usuario para que vea solo su agenda (fase 4).
- Fases 3 a 14. Ver el plan en el documento de arquitectura.

## Errores conocidos y puntos sin verificar

1. **Inicio de sesión real con Supabase sin probar.** El entorno de desarrollo de Claude no puede conectarse a `supabase.co`. Las pruebas usan un sustituto local de Supabase Auth (`apps/web/e2e/fake-supabase.mjs`, solo para pruebas) que emite tokens con el mismo formato (ES256); la API los valida con su verificador real. Falta comprobar registro, confirmación de correo e inicio de sesión contra el proyecto verdadero. Eso solo se puede hacer con la web desplegada o corriendo en un computador con internet.
2. **Proyectos antiguos de Supabase (HS256).** Hay soporte con `SUPABASE_JWT_SECRET`, pero esa ruta no tiene prueba automática.
3. **Duraciones del catálogo inicial.** Son estimaciones mías para arrancar, no datos de ningún negocio; cada establecimiento debe ajustarlas.
4. **El periodo de prueba no vence solo.** La empresa nace con una suscripción en prueba; el corte al vencer llega con la fase 11.

Resueltos: los cinco puntos abiertos de la fase 1 se cerraron en la primera ejecución de la integración continua (Prisma valida, genera y migra; `prisma migrate diff` no reporta diferencias; pruebas en verde en PostgreSQL 17).

Notas de versiones y entorno:

- **NestJS 11, no 12.** La versión 12 solo se distribuye como módulos ES, incompatibles con las herramientas de pruebas actuales del proyecto. La 11 sigue recibiendo parches.
- Prisma fijado en 7.10.1 (decisión 7) y TypeScript en 5.9.
- **Rama `prisma-client`.** El entorno de desarrollo de Claude no puede descargar los motores de Prisma. La integración continua genera el cliente y lo publica en esa rama, de donde se toma para desarrollar. No se debe editar ni fusionar; se puede eliminar si se trabaja solo desde un computador propio.

## Pruebas realizadas

66 pruebas automáticas contra PostgreSQL real, todas en verde (`pnpm test`): 36 de base de datos y 30 de la API de extremo a extremo. Además, un recorrido de 16 pasos en un navegador real, en tamaño de celular y de computador (`pnpm --filter @newcrm/web e2e`).

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

Recorrido en navegador (Chrome, tamaño de celular y de computador; web, API y base reales, Supabase sustituido):

1. Sin sesión, el panel lleva a iniciar sesión.
2. Registro de la dueña.
3. Una dirección web reservada se rechaza con mensaje claro y sin borrar lo escrito.
4. Alta del negocio.
5. La sucursal principal existe y el plan frena la segunda.
6. Editar la sucursal.
7. Dar acceso a una recepcionista.
8. Guardar datos del negocio.
9. Cerrar sesión y contraseña equivocada.
10. La recepcionista invitada entra y ve solo lo de su rol.
11. Vista de computador.

| Catálogo (fase 3) | Las tres verticales cargan sin duplicar; validación de precios, duraciones y anticipos; el cambio de precio queda en auditoría; eliminar conserva el historial | Cierre de fase 3 |
| Profesionales (fase 3) | Servicios asignados; horario con descansos que se guarda y se devuelve igual; horarios imposibles rechazados; límite del plan (402) que se libera al desactivar | 9 (parcial) |
| Tarifas, bloqueos y recursos (fase 3) | Tarifas por profesional y sucursal sin duplicados; bloqueos por rango; recursos | Fase 3 |
| Aislamiento del catálogo (fase 3) | Una empresa no ve ni usa servicios o profesionales de otra; recepción consulta pero no modifica; un administrador de una sucursal no toca las demás | 2 |

Los escenarios 7 y 8, y lo que falta de 9, 11 y 12, dependen de módulos de fases posteriores.

## Dependencias

| Necesidad | Para | Estado |
| --- | --- | --- |
| Proyecto de Supabase | Autenticación y base de datos alojada | Creado (`zvvfxagpyiibfjmwbsqz`). Falta la cadena de conexión de la base para aplicar las migraciones allí |
| Apple Developer, emisor de Google Wallet, Wompi | Etapa 2 | Trámites por iniciar |
| Meta Business verificado | Etapa 3 | Trámite por iniciar |

## Próximas tareas

1. Desplegar un entorno de pruebas: migraciones en Supabase, API y web publicadas. Requiere cuentas y secretos que solo puede crear el dueño del proyecto (ver `docs/despliegue.md`).
2. Probar registro, confirmación de correo e inicio de sesión reales (cierra el punto 1 de errores conocidos).
3. Fase 4: motor de disponibilidad, citas y calendario (escenarios 1, 3 y 11 a nivel de API).
