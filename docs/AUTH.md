# Clerk y PostgreSQL

Clerk administra las cuentas OAuth y las sesiones. PostgreSQL guarda el perfil de la aplicación; no almacena contraseñas ni tokens.

## Configuración local

Requiere Node.js 20.19+, 22.12+ o 24+ y PostgreSQL. En PowerShell, usa `npm.cmd` y `npx.cmd` si la política de ejecución bloquea los archivos `.ps1`.

1. Instala las dependencias con `npm install`.
2. Copia los campos de `.env.example` a `.env.local`, conservando las claves existentes. Completa `DATABASE_URL` con la conexión de tu proveedor PostgreSQL y las claves de tu aplicación Clerk. Nunca uses el prefijo `NEXT_PUBLIC_` para secretos o la conexión PostgreSQL.
3. Ejecuta `npm run db:generate` y `npm run db:deploy` para generar el cliente y aplicar la migración inicial.
4. Inicia la aplicación con `npm run dev`.

Prisma CLI y Next.js leen `.env.local`. Las variables del entorno de despliegue tienen prioridad. Usa conexiones cifradas y las opciones indicadas por tu proveedor. En despliegues con múltiples instancias, utiliza su conexión con pool si está disponible y respeta el límite de conexiones.

## Webhook de Clerk

1. Habilita los proveedores deseados, como Google o GitHub, en la configuración de Clerk.
2. Expón el servidor local con una herramienta como `ngrok http 3000`.
3. En Clerk, crea un endpoint: `https://TU-DOMINIO/api/webhooks/clerk`. Suscríbelo a `user.created`, `user.updated` y `user.deleted`.
4. Copia su Signing Secret a `CLERK_WEBHOOK_SIGNING_SECRET` en `.env.local` y reinicia el servidor.
5. Registra un usuario y revisa la entrega en Clerk. Comprueba que aparece un único perfil en PostgreSQL con `npm run db:studio`.

El endpoint es público para permitir entregas sin sesión de navegador, pero verifica la firma del cuerpo original con `verifyWebhook`. El `clerkMiddleware()` existente mantiene esta ruta accesible; si añades protección global, excluye explícitamente `/api/webhooks/clerk`.

Las altas y actualizaciones usan `data.updated_at` para ordenar versiones. Una escritura atómica de PostgreSQL evita duplicados y descarta versiones antiguas o repetidas, incluso con solicitudes concurrentes. La eliminación es terminal: limpia correo, nombre y avatar, y conserva el ID interno, `clerkId` y fechas como referencia mínima para impedir que entregas retrasadas restauren el perfil.

Los errores de PostgreSQL devuelven `500` para permitir reintentos de Clerk. Revisa las entregas fallidas en su panel y reenvíalas después de resolver el problema. Los mensajes de error no incluyen cuerpos del webhook, datos personales ni detalles de conexión.

## Perfil autenticado

El componente global `ProfileSync` llama a `/api/me` cuando Clerk termina de cargar una sesion autenticada, incluso si ya estaba iniciada antes de configurar PostgreSQL. Repite la llamada al cambiar de usuario o sesion y reintenta hasta dos veces ante fallos temporales. No requiere un webhook para crear el perfil al entrar; los webhooks siguen siendo necesarios para sincronizar cambios y eliminaciones sin una visita del usuario.

`GET /api/me` devuelve:

```json
{
  "user": {
    "id": "ID_INTERNO",
    "clerkId": "user_...",
    "email": null,
    "name": "Ana",
    "avatarUrl": null,
    "createdAt": "2026-10-29T00:00:00.000Z",
    "updatedAt": "2026-10-29T00:00:00.000Z"
  }
}
```

La identidad procede exclusivamente de `await auth()`: el endpoint no acepta IDs del cliente. Devuelve `401` sin sesión o para un perfil eliminado, `503` si no puede cargar el perfil y `Cache-Control: private, no-store` para evitar almacenar respuestas privadas en caché.

Si el perfil aún no existe, el servidor consulta Clerk y lo crea de forma idempotente. Esto cubre usuarios existentes y el primer acceso antes del webhook. Desde otras rutas o componentes del servidor, usa `getCurrentUserProfile()` de `lib/users/current-user.ts`. Comprueba siempre la autenticación y la propiedad de los recursos al acceder a datos privados. Usa `User.id` para relacionar futuros favoritos o playlists; `clerkId` es el vínculo único con Clerk. El correo puede cambiar o faltar y no es una clave de identidad.

## Pruebas y despliegue

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Las pruebas habituales verifican firmas reales de webhook, aislamiento de perfiles, primer acceso y respuestas ante fallos. Las pruebas de concurrencia, duplicados, eventos desordenados y eliminación se ejecutan contra PostgreSQL solamente cuando proporcionas `TEST_DATABASE_URL` en el entorno del proceso. No toman `DATABASE_URL` como alternativa.

Para ejecutarlas en PowerShell, usa una base de datos **exclusiva para pruebas**:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/graphu_test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm.cmd run db:deploy
npm.cmd test
Remove-Item Env:DATABASE_URL
Remove-Item Env:TEST_DATABASE_URL
```

Las pruebas crean identificadores únicos y eliminan únicamente sus propios registros. Sin `TEST_DATABASE_URL`, esas pruebas se omiten explícitamente.

En producción, configura las cuatro variables de aplicación de `.env.example` (sin `TEST_DATABASE_URL`), aplica `npm run db:deploy` como paso de publicación y ejecuta `npm run build`. Configura el endpoint y el Signing Secret de la instancia de producción de Clerk. El build genera Prisma sin necesitar conexión a PostgreSQL. Para cambios posteriores, crea migraciones con `npm run db:migrate -- --name NOMBRE` contra desarrollo; aplica las migraciones revisadas en producción con `db:deploy`.

Referencias: [sincronización con Clerk](https://clerk.com/docs/guides/development/webhooks/syncing) y [Prisma 7 con Clerk y Next.js](https://www.prisma.io/docs/guides/v7/authentication/clerk/nextjs).
