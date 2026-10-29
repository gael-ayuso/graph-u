# GraphU

Aplicación web de exploración y recomendación musical que busca conectar canciones, artistas, álbumes y géneros mediante grafos interactivos y recomendaciones personalizadas con datos de MusicBrainz.

Este README integra el alcance de [REQUIEREMENTS.md](REQUIEREMENTS.md), donde el proyecto se denomina **MusicGraph**. En este repositorio se utiliza el nombre **GraphU**.

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

El documento de requisitos plantea una arquitectura cliente-servidor que separa interfaz, lógica de negocio y persistencia:

```text
Usuario
   |
   v
Next.js + React + TypeScript
Zustand · TanStack Query · Tailwind CSS · shadcn/ui · Cytoscape.js
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

En esta propuesta, Zustand administra canciones semilla, filtros y nodos activos; TanStack Query gestiona consultas y mutaciones; Cytoscape.js representa las relaciones musicales; y FastAPI concentra las operaciones de negocio, las consultas al catálogo y los algoritmos. Las credenciales de PostgreSQL permanecen en el servidor.

FastAPI, Cytoscape.js y los algoritmos de Python forman parte de la arquitectura prevista. La autenticación actual utiliza Clerk y los perfiles se gestionan desde Next.js con Prisma.

## Requisitos

Para ejecutar la aplicación actual:

- Node.js **20.19+, 22.12+ o 24+** y npm.
- Una base de datos PostgreSQL accesible.
- Una aplicación de Clerk con sus claves pública y privada.
- Un endpoint de webhook y su secreto de firma para sincronizar cambios y eliminaciones de usuarios desde Clerk.

Python y las bibliotecas del recomendador corresponden a etapas futuras y no son necesarios para iniciar la aplicación Next.js actual.

## Instalación y uso

1. Clona el repositorio y abre su directorio.
2. Instala las dependencias:

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

   Ajusta las credenciales de ejemplo a tu entorno. No publiques `.env.local` ni uses el prefijo `NEXT_PUBLIC_` para secretos o conexiones de base de datos.

4. Con PostgreSQL disponible, genera el cliente y aplica las migraciones:

   ```bash
   npm run db:generate
   npm run db:deploy
   ```

5. Inicia el servidor:

   ```bash
   npm run dev
   ```

6. Abre [http://localhost:3000](http://localhost:3000).

En PowerShell, utiliza `npm.cmd` o `npx.cmd` si la política de ejecución bloquea los archivos `.ps1`. Consulta [docs/AUTH.md](docs/AUTH.md) para configurar proveedores OAuth y el webhook de Clerk.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia el servidor de desarrollo |
| `npm run build` | Genera el cliente Prisma y compila la aplicación |
| `npm start` | Inicia la aplicación compilada |
| `npm run lint` | Ejecuta ESLint |
| `npm test` | Ejecuta las pruebas con Vitest |
| `npm run db:generate` | Genera el cliente Prisma |
| `npm run db:migrate -- --name NOMBRE` | Crea y aplica una migración en desarrollo |
| `npm run db:deploy` | Aplica las migraciones existentes |
| `npm run db:studio` | Abre Prisma Studio |

## Modelo de datos propuesto

Los requisitos plantean PostgreSQL con dos esquemas: `musicbrainz`, para el catálogo importado, y `app`, para los datos propios. Las entidades de la aplicación se relacionarían con el catálogo mediante identificadores musicales para evitar duplicaciones innecesarias.

El esquema `app` propuesto agrupa **13 tablas** en cuatro módulos:

| Módulo | Tablas | Propósito |
| --- | --- | --- |
| Usuarios | `users`, `user_preferences` | Cuentas y preferencias |
| Biblioteca personal | `user_favorite_recording`, `user_favorite_artist`, `playlist`, `playlist_track` | Favoritos, listas y sus canciones |
| Recomendaciones | `recommendation_model`, `recommendation_request`, `recommendation_seed`, `recommendation_result` | Algoritmos, versiones, solicitudes, semillas y resultados |
| Evaluación | `recommendation_event`, `user_feedback`, `recommendation_evaluation` | Interacciones y métricas de desempeño |

Las operaciones CRUD previstas incluyen registrar y eliminar cuentas; consultar y modificar perfiles y preferencias; gestionar favoritos; crear, consultar, editar y eliminar playlists; agregar, quitar y reordenar sus canciones; y consultar información musical y recomendaciones.

Este modelo representa el diseño objetivo. La persistencia de perfiles implementada actualmente se documenta en [docs/AUTH.md](docs/AUTH.md).

## Hoja de ruta

| Etapa | Alcance previsto |
| --- | --- |
| 1. Funcionalidades principales | Usuarios, búsqueda musical, favoritos, playlists, CRUD y recomendaciones por etiquetas con TF-IDF y similitud coseno |
| 2. Grafos | Visualización con Cytoscape.js, Personalized PageRank con NetworkX y recomendaciones explicables mediante conexiones musicales |
| 3. Recomendador híbrido | Integración de ListenBrainz para similitud colaborativa, combinación de algoritmos y diversificación de resultados |
| 4. Similitud acústica | Características acústicas cuando existan datos disponibles, análisis con Essentia, integración prevista con AcousticBrainz y embeddings con pgvector |
| 5. Evaluación | Registro de interacciones, análisis de favoritos y rechazos, métricas, comparación de algoritmos y mejoras progresivas |

## Pruebas

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Las pruebas de integración con PostgreSQL requieren `TEST_DATABASE_URL` en el entorno del proceso y una base exclusiva para pruebas con las migraciones aplicadas. Sin esa variable, esas pruebas se omiten. Consulta [las instrucciones detalladas](docs/AUTH.md#pruebas-y-despliegue).

## Despliegue

Configura las variables de aplicación en producción, utiliza una conexión PostgreSQL adecuada para tu proveedor y configura el webhook de la instancia de producción de Clerk.

Aplica las migraciones con `npm run db:deploy` como paso de publicación y compila con `npm run build`. Si utilizas un servidor Node.js, inicia la aplicación compilada con `npm start`.

La generación de Prisma durante el build no necesita una conexión activa a PostgreSQL. Consulta [docs/AUTH.md](docs/AUTH.md) para los detalles de conexiones, webhooks y migraciones.

## Documentación

- [Documento original de requisitos](REQUIEREMENTS.md): alcance funcional, arquitectura propuesta y etapas de desarrollo.
- [Autenticación y PostgreSQL](docs/AUTH.md): configuración de Clerk, perfiles, webhooks, pruebas y despliegue.

## Contribuciones

Antes de proponer cambios, revisa los requisitos y las instrucciones de [AGENTS.md](AGENTS.md). Describe el problema o la funcionalidad, mantén la documentación alineada con el comportamiento implementado y ejecuta las verificaciones correspondientes al cambio.
