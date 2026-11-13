# GraphU

Aplicación web de exploración y recomendación musical que busca conectar canciones, artistas, álbumes y géneros mediante grafos interactivos y recomendaciones personalizadas con datos de MusicBrainz.

Este README integra el alcance de [REQUIEREMENTS.md](REQUIEREMENTS.md). El nombre del proyecto es **GraphU**; su identificador de paquete es `graph-u`.

## Contenido

- [Descripción](#descripción)
- [Funcionalidades](#funcionalidades)
- [Tecnologías y arquitectura](#tecnologías-y-arquitectura)
- [Requisitos](#requisitos)
- [Instalación y uso](#instalación-y-uso)
- [Comandos](#comandos)
- [Modelo de datos propuesto](#modelo-de-datos-propuesto)
- [Hoja de ruta](#hoja-de-ruta)
- [Pruebas](#pruebas)
- [Despliegue](#despliegue)
- [Documentación](#documentación)
- [Contribuciones](#contribuciones)

## Descripción

Los grandes catálogos musicales facilitan encontrar canciones conocidas, pero descubrir nuevos artistas y comprender las relaciones musicales puede resultar complicado. Además, muchas recomendaciones no explican cómo se obtuvieron sus resultados.

GraphU propone combinar el catálogo y las relaciones de MusicBrainz con canciones semilla y preferencias del usuario para descubrir música y comprender las conexiones que justifican cada recomendación.

## Funcionalidades

El alcance previsto del producto contempla:

- **Búsqueda musical:** consultar canciones, artistas y álbumes de MusicBrainz, junto con sus datos y relaciones.
- **Grafos interactivos:** explorar conexiones entre artistas, canciones, álbumes y géneros.
- **Recomendaciones:** seleccionar una o varias canciones semilla y obtener resultados inicialmente mediante etiquetas musicales, TF-IDF y similitud coseno.
- **Usuarios y preferencias:** registrar cuentas, administrar perfiles y configurar preferencias individuales.
- **Favoritos:** guardar, consultar y eliminar canciones y artistas favoritos para personalizar resultados.
- **Playlists:** crear, consultar, modificar y eliminar listas, administrar sus canciones y cambiar su orden.
- **Evaluación:** registrar interacciones positivas y negativas para medir y mejorar los algoritmos.

Estas funciones corresponden al alcance de los requisitos y se desarrollarán progresivamente; no todas están implementadas en la versión actual.

## Tecnologías y arquitectura

### Base actual del repositorio

| Área | Tecnologías |
| --- | --- |
| Aplicación web | Next.js 16, React 19 y TypeScript |
| Interfaz | Tailwind CSS 4, shadcn/ui y Radix UI |
| Estado y consultas | Zustand y TanStack Query |
| Cuentas y sesiones | Clerk |
| Persistencia de perfiles | PostgreSQL y Prisma 7 |
| Pruebas | Vitest |

Clerk administra las cuentas OAuth y las sesiones; PostgreSQL y Prisma almacenan los perfiles de la aplicación. Consulta [la guía de autenticación](docs/AUTH.md) para conocer este flujo.

### Arquitectura objetivo

La visualización de grafos utilizará [react-vis-graph-wrapper](https://github.com/Wokstym/react-vis-graph-wrapper), un componente de React basado en vis.js para representar nodos y conexiones musicales de forma interactiva.

El documento de requisitos plantea una arquitectura cliente-servidor que separa interfaz, lógica de negocio y persistencia:

```text
Usuario
   |
   v
Next.js + React + TypeScript
Zustand · TanStack Query · Tailwind CSS · shadcn/ui · react-vis-graph-wrapper
   |
   | HTTP / JSON
   v
FastAPI + Python
CRUD · Recomendaciones · scikit-learn · NetworkX · NumPy
   |
   v
PostgreSQL
Esquemas propuestos: musicbrainz y app
```

En esta propuesta, Zustand administra canciones semilla, filtros y nodos activos; TanStack Query gestiona consultas y mutaciones; react-vis-graph-wrapper representa las relaciones musicales; y FastAPI concentra las operaciones de negocio, las consultas al catálogo y los algoritmos. Las credenciales de PostgreSQL permanecen en el servidor.

El backend FastAPI ya existe en [backend/](backend/README.md): busca en MusicBrainz y recomienda de forma híbrida: etiquetas (TF-IDF y similitud coseno), canciones y artistas similares según Last.fm (`getSimilar`) y colaboraciones entre artistas. La pantalla `/explorar` dibuja esas recomendaciones como un grafo con react-vis-graph-wrapper. Personalized PageRank y los demás algoritmos forman parte de la arquitectura prevista. La autenticación actual utiliza Clerk y los perfiles se gestionan desde Next.js con Prisma.

## Requisitos

Para ejecutar la aplicación actual:

- Node.js **20.19+, 22.12+ o 24+** y npm.
- Una base de datos PostgreSQL de GraphU instalada, configurada y accesible. Para el desarrollo local, sigue [la instalación con Docker](docs/DATABASE_LOCAL.md) antes de ejecutar las migraciones o iniciar la aplicación.
- Una aplicación de Clerk con sus claves pública y privada.
- Un endpoint de webhook y su secreto de firma para sincronizar cambios y eliminaciones de usuarios desde Clerk.
- Python 3.11+ para el backend FastAPI de búsqueda y recomendaciones.

### Bases de datos para desarrollo

Cada integrante debe preparar su base de GraphU y configurar `DATABASE_URL` en `.env.local`. Clonar el repositorio o instalar las dependencias no crea la base ni sus tablas; después de levantar PostgreSQL hay que aplicar las migraciones.

| Base | Cuándo se necesita | Preparación |
| --- | --- | --- |
| GraphU (`graphu`, puerto local `5431`) | Para desarrollar las funciones que guardan usuarios, preferencias, favoritos, playlists y recomendaciones | [Instalar PostgreSQL con Docker y aplicar las migraciones](docs/DATABASE_LOCAL.md) |
| MusicBrainz (`musicbrainz_db`, puerto local `5434` en el equipo migrado) | Para desarrollar y probar consultas contra el catálogo local de MusicBrainz | Instalar MusicBrainz e importar el catálogo antes de seguir [la guía de actualización](docs/MUSICBRAINZ_UPDATE.md#antes-de-desarrollar-con-musicbrainz-local) |

El backend verifica primero si `MUSICBRAINZ_DATABASE_URL` está configurada y activa; si no lo está, utiliza automáticamente la API pública de MusicBrainz. La copia local del catálogo es opcional; la persistencia propia de GraphU sigue necesitando su base de datos.

## Instalación y uso

1. Clona el repositorio y abre su directorio.
2. Instala las dependencias de Node.js:

   ```bash
   npm install
   ```

3. Crea `.env.local` a partir de [.env.example](.env.example). Si ya existe, incorpora los campos necesarios conservando sus valores actuales. Configura estas variables:

   | Variable | Uso |
   | --- | --- |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk |
   | `CLERK_SECRET_KEY` | Clave privada de Clerk, exclusiva del servidor |
   | `CLERK_WEBHOOK_SIGNING_SECRET` | Verificación de firmas de los webhooks |
   | `DATABASE_URL` | Conexión a PostgreSQL para los perfiles |
   | `POSTGRES_PASSWORD` | Contraseña de PostgreSQL si utilizas la configuración local de Compose |
   | `TEST_DATABASE_URL` | Conexión opcional a una base exclusiva para pruebas de integración |
   | `BACKEND_URL` | URL del backend FastAPI (por defecto `http://127.0.0.1:8000`) |
   | `MUSICBRAINZ_DATABASE_URL` | Conexión opcional al catálogo local de MusicBrainz en PostgreSQL; si está inactiva o vacía, el backend usa la API pública |
   | `LASTFM_API_KEY` | Clave opcional de Last.fm para señales de canciones y artistas similares (también la lee el backend desde `.env.local`) |

   Ajusta las credenciales de ejemplo a tu entorno. No publiques `.env.local` ni uses el prefijo `NEXT_PUBLIC_` para secretos o conexiones de base de datos.

4. Con PostgreSQL disponible, genera el cliente y aplica las migraciones:

   ```bash
   npm run db:generate
   npm run db:deploy
   ```

5. Prepara (solo la primera vez) e inicia el backend FastAPI en una terminal.

   **Windows (PowerShell o CMD):**

   ```powershell
   # Primera vez: crear entorno virtual e instalar dependencias de desarrollo
   cd backend
   python -m venv .venv
   .venv\Scripts\python -m pip install -r requirements-dev.txt

   # Iniciar el servidor FastAPI en el puerto 8000
   .venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

   También puedes iniciarlo directamente desde la raíz del repositorio sin cambiar de directorio:

   ```powershell
   backend\.venv\Scripts\python -m uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 8000
   ```

   **Linux / macOS:**

   ```bash
   cd backend
   python3 -m venv .venv
   .venv/bin/python -m pip install -r requirements-dev.txt
   .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

   Si solo necesitas ejecutar el servidor sin herramientas de desarrollo (`pytest` y `ruff`), instala [backend/requirements.txt](backend/requirements.txt) en lugar de [backend/requirements-dev.txt](backend/requirements-dev.txt).

   Comprueba que responda entrando a [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) (`{"status":"ok","musicbrainz":"local_db"}` o `"public_api"`) o revisando Swagger UI en [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). Para más detalles sobre variables y solución de problemas, consulta [backend/README.md](backend/README.md).

6. En **otra terminal**, inicia el servidor de Next.js en la raíz del repositorio:

   ```bash
   npm run dev
   ```

7. Abre [http://localhost:3000](http://localhost:3000).

En PowerShell, utiliza `npm.cmd` o `npx.cmd` si la política de ejecución bloquea los archivos `.ps1`. Consulta [docs/AUTH.md](docs/AUTH.md) para configurar proveedores OAuth y el webhook de Clerk.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia el servidor de desarrollo de Next.js |
| `npm run build` | Genera el cliente Prisma y compila la aplicación |
| `npm start` | Inicia la aplicación compilada |
| `npm run lint` | Ejecuta ESLint |
| `npm test` | Ejecuta las pruebas con Vitest |
| `npm run db:generate` | Genera el cliente Prisma |
| `npm run db:migrate -- --name NOMBRE` | Crea y aplica una migración en desarrollo |
| `npm run db:deploy` | Aplica las migraciones existentes |
| `npm run db:studio` | Abre Prisma Studio |
| `backend\.venv\Scripts\python -m uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 8000` | Inicia el backend FastAPI en Windows desde la raíz |
| `backend\.venv\Scripts\python -m pytest backend\tests` | Ejecuta las pruebas del backend Python |
| `backend\.venv\Scripts\python -m ruff check backend\app backend\tests` | Ejecuta el linter Ruff en el backend Python |

## Modelo de datos

PostgreSQL almacena los datos propios en el esquema `app`. Las referencias musicales usan MBID de tipo UUID sin duplicar el catálogo ni exigir que MusicBrainz esté importado. El esquema `musicbrainz` sigue previsto para el catálogo local.

El esquema `app`, definido en `prisma/schema.prisma`, agrupa **13 tablas** en cuatro módulos:

| Módulo | Tablas | Propósito |
| --- | --- | --- |
| Usuarios | `users`, `user_preferences` | Cuentas y preferencias |
| Biblioteca personal | `user_favorite_recording`, `user_favorite_artist`, `playlist`, `playlist_track` | Favoritos, listas y sus canciones |
| Recomendaciones | `recommendation_model`, `recommendation_request`, `recommendation_seed`, `recommendation_result` | Algoritmos, versiones, solicitudes, semillas y resultados |
| Evaluación | `recommendation_event`, `user_feedback`, `recommendation_evaluation` | Interacciones y métricas de desempeño |

Las operaciones CRUD previstas incluyen registrar y eliminar cuentas; consultar y modificar perfiles y preferencias; gestionar favoritos; crear, consultar, editar y eliminar playlists; agregar, quitar y reordenar sus canciones; y consultar información musical y recomendaciones.

Las migraciones crean las tablas, relaciones, índices y restricciones. La migración de `public."User"` a `app.users` conserva los perfiles y sus identificadores; Prisma mantiene el modelo `User` y el acceso `db.user`. La sincronización de perfiles se documenta en [docs/AUTH.md](docs/AUTH.md). Las nuevas tablas todavía requieren su integración con las rutas de biblioteca, recomendaciones y evaluación; crearlas no habilita automáticamente esas funciones.

Las posiciones de canciones y semillas empiezan en 0; el ranking de resultados empieza en 1. No se permiten canciones repetidas ni posiciones repetidas dentro de una playlist o solicitud. Los eventos y el feedback deben pertenecer al usuario de la solicitud y sus resultados deben corresponder a esa misma solicitud. El feedback usa `LIKE` o `DISLIKE`; las métricas y los parámetros se guardan como objetos JSON. Las restricciones `CHECK` viven en la migración SQL porque Prisma no las representa en su esquema.

## Hoja de ruta

| Etapa | Alcance previsto |
| --- | --- |
| 1. Funcionalidades principales | Usuarios, búsqueda musical, favoritos, playlists, CRUD y recomendaciones por etiquetas con TF-IDF y similitud coseno |
| 2. Grafos | Visualización con react-vis-graph-wrapper, Personalized PageRank con NetworkX y recomendaciones explicables mediante conexiones musicales |
| 3. Recomendador híbrido | Integración de ListenBrainz para similitud colaborativa, combinación de algoritmos y diversificación de resultados |
| 4. Similitud acústica | Características acústicas cuando existan datos disponibles, análisis con Essentia, integración prevista con AcousticBrainz y embeddings con pgvector |
| 5. Evaluación | Registro de interacciones, análisis de favoritos y rechazos, métricas, comparación de algoritmos y mejoras progresivas |

## Pruebas

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
backend\.venv\Scripts\python -m pytest backend\tests
backend\.venv\Scripts\python -m ruff check backend\app backend\tests
```

Las pruebas de integración con PostgreSQL requieren `TEST_DATABASE_URL` en el entorno del proceso y una base exclusiva para pruebas con las migraciones aplicadas. Sin esa variable, esas pruebas se omiten. Consulta [las instrucciones detalladas](docs/AUTH.md#pruebas-y-despliegue).

## Despliegue

Configura las variables de aplicación en producción, utiliza una conexión PostgreSQL adecuada para tu proveedor y configura el webhook de la instancia de producción de Clerk.

Aplica las migraciones con `npm run db:deploy` como paso de publicación y compila con `npm run build`. Si utilizas un servidor Node.js, inicia la aplicación compilada con `npm start` junto con el servicio FastAPI en ejecución y accesible mediante `BACKEND_URL`.

La generación de Prisma durante el build no necesita una conexión activa a PostgreSQL. Consulta [docs/AUTH.md](docs/AUTH.md) para los detalles de conexiones, webhooks y migraciones.

## Documentación

- [API de consultas de la aplicación](docs/APP_API.md): endpoints autenticados de preferencias, favoritos, playlists e historial, con ejemplos y paginación.
- [Base de datos local con Docker](docs/DATABASE_LOCAL.md): puesta en marcha para el equipo, migraciones, consulta de tablas y solución de problemas.
- [Actualizar el catálogo de MusicBrainz](docs/MUSICBRAINZ_UPDATE.md): respaldo, replicación incremental, verificación y programación opcional en Docker Desktop.
- [Documento original de requisitos](REQUIEREMENTS.md): alcance funcional, arquitectura propuesta y etapas de desarrollo.
- [Autenticación y PostgreSQL](docs/AUTH.md): configuración de Clerk, perfiles, webhooks, pruebas y despliegue.
- [Backend y recomendador](backend/README.md): puesta en marcha del servidor FastAPI, endpoints y explicación del algoritmo.
- [Demo de canciones](docs/DEMO.md): búsqueda, lista y recomendaciones.

## Contribuciones

Antes de proponer cambios, revisa los requisitos y las instrucciones de [AGENTS.md](AGENTS.md). Describe el problema o la funcionalidad, mantén la documentación alineada con el comportamiento implementado y ejecuta las verificaciones correspondientes al cambio.
