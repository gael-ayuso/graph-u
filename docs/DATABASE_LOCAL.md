# Ejecutar la base de datos local con Docker

Esta guía permite que cada integrante del equipo cree su propia base PostgreSQL de GraphU con las mismas 13 tablas. Cada computadora conserva sus propios registros; las migraciones no copian los datos de otros integrantes.

## Requisitos

- Tener el repositorio completo, incluidas las migraciones recientes.
- Docker Desktop instalado y en ejecución, con contenedores Linux.
- Node.js 20.19+, 22.12+ o 24+, con npm.
- Tener disponible el puerto local `5431`.

No necesitas instalar PostgreSQL directamente en tu computadora ni recibir un contenedor exportado. Docker descarga la imagen `postgres:18` indicada en [compose.yaml](../compose.yaml).

Los comandos de esta guía están escritos para PowerShell y se ejecutan desde la raíz del repositorio, donde están `compose.yaml` y `package.json`. En Linux o macOS, utiliza `npm` en lugar de `npm.cmd` y crea `.env.local` con `cp .env.example .env.local` únicamente si todavía no existe.

## 1. Preparar la configuración local

Si todavía no tienes `.env.local`, créalo a partir de la plantilla:

```powershell
if (-not (Test-Path .env.local)) {
    Copy-Item .env.example .env.local
}
```

Abre `.env.local` y configura estas dos variables. Si el archivo ya existía, conserva las demás claves:

```dotenv
POSTGRES_PASSWORD=clave_local_123
DATABASE_URL=postgresql://graphu:clave_local_123@localhost:5431/graphu
```

Sustituye la contraseña de ejemplo por una propia y usa la misma en ambas variables. Si la contraseña contiene caracteres especiales, codifícalos para una URL en `DATABASE_URL`; en `POSTGRES_PASSWORD` conserva el valor original.

- `POSTGRES_PASSWORD` establece la contraseña al inicializar por primera vez el volumen de PostgreSQL.
- `DATABASE_URL` es la conexión que utiliza la aplicación y Prisma.
- El usuario y la base se llaman `graphu`, según `compose.yaml`.

No subas `.env.local` al repositorio. Para crear y consultar las tablas no necesitas las claves de Clerk; para ejecutar la aplicación completa, consulta [AUTH.md](AUTH.md).

## 2. Iniciar PostgreSQL

Con Docker Desktop abierto, ejecuta:

```powershell
docker compose --env-file .env.local up -d --wait db
```

Docker descarga la imagen si hace falta, crea el contenedor y el volumen de datos, y espera a que PostgreSQL esté listo para aceptar conexiones.

El parámetro `--env-file .env.local` es necesario porque el proyecto guarda allí la contraseña; Compose no carga ese archivo automáticamente por su nombre.

Comprueba el estado:

```powershell
docker compose --env-file .env.local ps
```

El servicio `db` debe aparecer iniciado y con estado `healthy`. La conexión queda disponible en `127.0.0.1:5431`, únicamente desde esta computadora.

## 3. Instalar dependencias y crear las tablas

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:deploy
```

`db:generate` genera el cliente Prisma. `db:deploy` aplica las migraciones pendientes y crea las tablas en el esquema `app`. Puedes volver a ejecutar ambos comandos cuando recibas cambios del repositorio; las migraciones ya aplicadas no se repiten.

Al terminar tendrás las tablas de usuarios y preferencias, favoritos, playlists, recomendaciones, eventos, feedback y evaluación. También verás el esquema `public`, donde Prisma conserva su historial en `_prisma_migrations`.

Las tablas estarán inicialmente vacías. El perfil de un usuario se crea al iniciar sesión en la aplicación con Clerk configurado. La creación de las tablas no conecta automáticamente todas las funciones de la app con esa persistencia.

## 4. Consultar la base

Para abrir el explorador de Prisma:

```powershell
npm.cmd run db:studio
```

Si prefieres DBeaver o pgAdmin, crea una conexión PostgreSQL con:

- Host: `localhost`.
- Puerto: `5431`.
- Base: `graphu`.
- Usuario: `graphu`.
- Contraseña: el valor de `POSTGRES_PASSWORD`.
- Esquema de las tablas de la aplicación: `app`.

## 5. Detener y volver a iniciar

Para detener PostgreSQL conservando el contenedor y los datos:

```powershell
docker compose --env-file .env.local stop db
```

Para volver a iniciarlo:

```powershell
docker compose --env-file .env.local up -d --wait db
```

Los datos persisten en el volumen `postgres_data`, aunque detengas o recrees el contenedor. No añadas `-v` a `docker compose down` si quieres conservarlos: esa opción elimina los volúmenes del proyecto.

## Problemas frecuentes

- **Docker no responde:** abre Docker Desktop, espera a que termine de iniciar y repite el comando.
- **El puerto 5431 está ocupado:** comprueba si PostgreSQL de este proyecto ya está iniciado. Si necesitas usar otro puerto, cambia el puerto del host en `ports` de `compose.yaml` y el puerto en `DATABASE_URL`, manteniendo el puerto interno `5431`.
- **Aparece un aviso de `POSTGRES_PASSWORD` sin configurar:** completa la variable en `.env.local` y utiliza `--env-file .env.local` en los comandos de Compose.
- **La autenticación de PostgreSQL falla:** comprueba que las dos variables usan la misma contraseña. Cambiar `.env.local` no modifica la contraseña de una base ya inicializada en el volumen; debes usar su contraseña vigente o cambiarla dentro de PostgreSQL.
- **Faltan tablas después de actualizar el repositorio:** ejecuta `npm.cmd run db:generate` y `npm.cmd run db:deploy`. Reinicia Next.js si ya estaba ejecutándose para que cargue el cliente actualizado.

Para consultar los mensajes del servicio:

```powershell
docker compose --env-file .env.local logs --tail 50 db
```

## Qué compartir con el equipo

Comparte el repositorio con `compose.yaml`, `.env.example`, `package.json`, el archivo de bloqueo de dependencias y la carpeta `prisma/`, incluidas sus migraciones. Cada integrante prepara su propio `.env.local` y sigue esta guía.

Si necesitan registros de ejemplo, se pueden incorporar mediante un script de semillas o importar desde una exportación de PostgreSQL. Si necesitan trabajar sobre los mismos registros en tiempo real, deben conectarse a una base central en lugar de usar una base local por persona.

Esta configuración levanta la base de la aplicación. El backend FastAPI se inicia por separado siguiendo [backend/README.md](../backend/README.md). El catálogo local de MusicBrainz es independiente y no se instala con este servicio `db`.
