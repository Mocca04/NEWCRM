# Despliegue de un entorno de pruebas

> **Estado de esta guía:** la parte que vive en este repositorio (migraciones por GitHub Actions e imagen de la API) se comprueba en la integración continua. Los pasos en los paneles de Supabase, Vercel y el alojamiento de la API **no se han ejecutado todavía**: los nombres de menús pueden variar. Cuando hagamos el primer despliegue se corrige lo que no coincida.

Son tres piezas:

| Pieza | Dónde | Qué necesita |
| --- | --- | --- |
| Base de datos y cuentas de usuario | Supabase (proyecto ya creado) | Aplicar las migraciones |
| API | Un servicio que ejecute contenedores (Railway, Render o similar) | La imagen `apps/api/Dockerfile` y 3 variables |
| Web | Vercel | La carpeta `apps/web` y 4 variables |

Los secretos van siempre en el panel de cada servicio o en los secretos de GitHub. **Nunca en el chat, en un archivo del repositorio ni en una captura de pantalla.**

## 1. Base de datos: aplicar las migraciones

1. En Supabase, abrir el proyecto y buscar la cadena de conexión de la base (botón **Connect**). Elegir la conexión **Session pooler** (puerto 5432), no la de modo transacción (puerto 6543): las migraciones necesitan una sesión completa.
2. Reemplazar `[YOUR-PASSWORD]` por la contraseña de la base. Si no la recuerdas, se puede restablecer en la configuración de la base de datos del proyecto.
3. En GitHub, en el repositorio: **Settings > Secrets and variables > Actions > New repository secret**. Nombre: `PRODUCTION_DATABASE_URL`. Valor: la cadena completa.
4. En la pestaña **Actions**, elegir **Aplicar migraciones** y pulsar **Run workflow**.

Cuando termine en verde, la base tiene las 42 tablas, la seguridad por empresa y los datos de referencia. Se repite el paso 4 cada vez que haya migraciones nuevas.

## 2. API

Crear un servicio a partir de este repositorio de GitHub, indicando que use el Dockerfile `apps/api/Dockerfile` con la raíz del repositorio como contexto. Variables:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | La misma cadena del paso 1 |
| `SUPABASE_URL` | `https://zvvfxagpyiibfjmwbsqz.supabase.co` |
| `CORS_ORIGINS` | La dirección de la web (paso 3), por ejemplo `https://newcrm.vercel.app` |

`PORT` lo define el propio servicio. Para comprobar que arrancó, abrir `https://<dirección-de-la-api>/api/v1/health`: debe responder `{"status":"ok"}`. La documentación queda en `/api/docs`.

## 3. Web

En Vercel, importar el repositorio y elegir `apps/web` como directorio raíz. Variables:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zvvfxagpyiibfjmwbsqz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | La llave publicable del proyecto (`sb_publishable_...`) |
| `API_URL` | La dirección de la API del paso 2, sin `/api/v1` |
| `NEXT_PUBLIC_SITE_URL` | La dirección que Vercel le asigne a la web |

## 4. Supabase: a dónde vuelve el enlace de confirmación

En la configuración de autenticación del proyecto (URL Configuration):

- **Site URL:** la dirección de la web.
- **Redirect URLs:** agregar `https://<dirección-de-la-web>/auth/confirm`.

Sin esto, el enlace del correo de confirmación lleva a una dirección equivocada.

## 5. Prueba real

1. Abrir la web, crear una cuenta y confirmar el correo.
2. Registrar un negocio, cargar servicios, agregar un profesional con horario.
3. Invitar a una segunda persona y entrar con ella.

Esto cierra el punto 1 de "Errores conocidos" en `docs/PROGRESO.md`. Lo que falle se corrige antes de seguir.

## Límites conocidos de este entorno de pruebas

- Los correos de confirmación salen por el servicio de correo integrado de Supabase, que es para pruebas y tiene un tope bajo de envíos por hora. Para producción hay que conectar un proveedor de correo propio.
- La API se ejecuta compilando TypeScript al arrancar. Es suficiente para pruebas; antes de producción se cambia por una compilación previa.
