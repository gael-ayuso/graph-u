# Demo de canciones

Abre `/demo`. Busca por título, artista o ambos; añade canciones a la lista y quítalas cuando quieras. La lista se conserva en el almacenamiento local del navegador y no se sincroniza con las cuentas de Clerk.

## Fuente local

Las búsquedas usan una conexión PostgreSQL directa al MusicBrainz local de Docker, no la API pública ni comandos de Docker por búsqueda. El servidor usa `pg`, consultas parametrizadas, conexiones de solo lectura, un límite de 20 resultados y un timeout de 8 segundos. Las credenciales permanecen en el servidor.

Valores predeterminados de esta instalación:

- Contenedor: `musicbrainz-docker-db-1`.
- Dirección PostgreSQL: `127.0.0.1:5433`, publicada hacia el puerto interno `5432`. No es una dirección HTTP.
- Base y usuario: `musicbrainz`.
- Tablas: `musicbrainz.recording` y `musicbrainz.artist_credit`.

La conexión se configura con `MUSICBRAINZ_DATABASE_URL` en `.env.local` (ignorado por Git). Es independiente de `DATABASE_URL`, utilizado por Prisma para los perfiles de la aplicación. El proceso de Next.js solo necesita acceso al puerto PostgreSQL; no necesita acceso al daemon de Docker.

El catálogo debe estar importado en la base. Si faltan las tablas, la demo informa de ello y no muestra canciones ficticias. En la inspección inicial el contenedor estaba activo, pero la base todavía no tenía tablas de MusicBrainz. No se ha importado ni modificado ningún dato del catálogo.
