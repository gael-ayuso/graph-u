# API de consultas de la aplicación

Estos endpoints `GET` consultan las tablas del esquema PostgreSQL `app` mediante Prisma. Se implementan en Next.js dentro de `app/api/`; el navegador llama a estas rutas y el servidor accede a la base mediante `DATABASE_URL`.

## Preparación y autenticación

1. Inicia PostgreSQL y aplica las migraciones siguiendo [DATABASE_LOCAL.md](DATABASE_LOCAL.md).
2. Configura Clerk según [AUTH.md](AUTH.md).
3. Inicia Next.js con `npm.cmd run dev` e inicia sesión en la aplicación.

La URL local es `http://localhost:3000`. Las rutas requieren una sesión válida de Clerk y un perfil activo. La identidad se obtiene en el servidor: enviar un `userId` en la URL no permite consultar los datos de otro usuario. Un perfil pendiente de sincronización se crea siguiendo el comportamiento existente de `/api/me`.

Todas las respuestas de estas consultas, incluidos los errores, llevan `Cache-Control: private, no-store`.

## Endpoints disponibles

| Método y ruta | Datos devueltos |
| --- | --- |
| `GET /api/me` | Perfil del usuario autenticado; ruta existente. |
| `GET /api/me/preferences` | Preferencias propias, en `{ "preferences": ... }`; devuelve `null` si no existe una fila. |
| `GET /api/me/favorites/recordings` | Grabaciones favoritas propias. |
| `GET /api/me/favorites/artists` | Artistas favoritos propios. |
| `GET /api/me/playlists` | Playlists propias, con `_count.tracks`. |
| `GET /api/me/playlists/{playlistId}` | Detalle de una playlist propia en `{ "playlist": ... }`, con `_count.tracks`. |
| `GET /api/me/playlists/{playlistId}/tracks` | Canciones de una playlist propia, por posición ascendente. |
| `GET /api/recommendation-models` | Modelos activos: `id`, `name` y `version`. Requiere autenticación. |
| `GET /api/me/recommendations` | Historial propio, con modelo y `_count.seeds` y `_count.results`. |
| `GET /api/me/recommendations/{requestId}` | Detalle propio en `{ "recommendation": ... }`, con modelo y conteos de sus datos relacionados. |
| `GET /api/me/recommendations/{requestId}/seeds` | Semillas de la solicitud, por posición ascendente. |
| `GET /api/me/recommendations/{requestId}/results` | Resultados de la solicitud, por ranking ascendente. |
| `GET /api/me/recommendations/{requestId}/events` | Eventos propios asociados a la solicitud. |
| `GET /api/me/recommendations/{requestId}/feedback` | Valoraciones propias asociadas a la solicitud. |
| `GET /api/me/recommendations/{requestId}/evaluations` | Métricas asociadas a una solicitud propia. |

Sustituye `{playlistId}` y `{requestId}` por los UUID recibidos al consultar los listados. Los recursos que pertenecen a otro usuario devuelven el mismo `404` que un recurso inexistente. Las subrutas también verifican la propiedad del recurso padre antes de consultar sus datos.

Los listados de favoritos, playlists, solicitudes, eventos, feedback y evaluaciones se ordenan por fecha de creación descendente y, ante fechas iguales, por su identificador ascendente. Los modelos se ordenan por nombre, versión e identificador. Las canciones y los artistas se referencian mediante sus MBID; estas rutas no añaden metadatos musicales desde MusicBrainz.

## Paginación

Todos los listados aceptan:

- `limit`: cantidad por página; por defecto `20`, entre `1` y `100`.
- `offset`: filas que se omiten; por defecto `0`, entre `0` y `10000`.

Ambos parámetros deben ser enteros escritos con dígitos, sin signos ni decimales, y no se pueden repetir en la misma URL. Los detalles y las preferencias no usan paginación.

Ejemplo:

```text
GET /api/me/playlists?limit=10&offset=0
```

Ejemplo de respuesta de un listado vacío:

```json
{
  "items": [],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "hasMore": false,
    "nextOffset": null
  }
}
```

`hasMore` indica si existe al menos otro elemento después de la página. `nextOffset` indica el siguiente desplazamiento permitido o es `null` si no hay más filas o se ha alcanzado el máximo de desplazamiento. Si `hasMore` es `true` y `nextOffset` es `null`, existen más datos fuera del rango de paginación permitido. Las páginas reflejan el estado de la base en cada consulta; no constituyen una instantánea estable si se insertan o eliminan registros entre peticiones.

## Llamadas desde el frontend

Desde el mismo sitio y con la sesión iniciada, el navegador envía las cookies de sesión en la petición:

```typescript
async function loadPlaylists() {
  const response = await fetch("/api/me/playlists?limit=20&offset=0", {
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "No se pudieron cargar las playlists.");
  }

  return data.items;
}
```

Para consultar las canciones, usa el `id` de una playlist obtenida del listado:

```typescript
const response = await fetch(`/api/me/playlists/${playlistId}/tracks?limit=50`, {
  cache: "no-store",
});
```

Un cliente externo al navegador también debe presentar una sesión o un token válido de Clerk para esta aplicación. Abrir la URL sin autenticación devuelve `401`.

## Respuestas de error

Los nuevos endpoints devuelven errores con el formato `{ "error": "mensaje" }`:

- `400`: identificador UUID o parámetros de paginación inválidos.
- `401`: falta una sesión válida o el perfil está eliminado.
- `404`: playlist o solicitud inexistente o perteneciente a otro usuario.
- `503`: no se pudo obtener el perfil o consultar los datos. La respuesta no expone mensajes internos de PostgreSQL ni credenciales.

## Alcance de las consultas

Las rutas GET consultan los registros del usuario autenticado. Las operaciones de playlists siguen siendo de consulta.

`POST /api/recommendations` genera recomendaciones mediante FastAPI. Con sesión, registra el modelo, la solicitud, las semillas, los resultados (incluyendo los datos de cada canción) y un evento `GENERATED`; la respuesta añade `requestId` y `resultId` por recomendación. Sin sesión, mantiene la generación pública sin escribir en PostgreSQL.

## Guardar y evaluar recomendaciones

Estas operaciones requieren sesión y verifican que el resultado pertenezca a la solicitud y al usuario:

- `PUT /api/me/recommendations/{requestId}/feedback`: JSON `{ "resultId": "UUID", "value": "LIKE" }`. Acepta `LIKE`, `DISLIKE` o `null` para quitar la evaluación. Mantiene una respuesta por resultado y registra un evento `FEEDBACK` en la misma transacción.
- `PUT /api/me/recommendations/{requestId}/saved`: JSON `{ "resultId": "UUID", "saved": true }`. Guarda sin duplicados; `false` quita el favorito. Registra `SAVE` o `UNSAVE` en la misma transacción.
- `GET /api/me/saved-recommendations`: devuelve `{ "songs": [...] }` con las canciones favoritas cuyo detalle se conserva en el historial de recomendaciones del usuario.
- `DELETE /api/me/favorites/recordings`: JSON `{ "recordingId": "UUID" }`. Quita una canción de los favoritos propios, incluso si su tanda ya no está visible.

La demo sin sesión conserva canciones guardadas y evaluaciones en `graphu.recommendations.v1` del navegador. Las canciones semilla siguen en `graphu.demo.songs.v1`: guardar una recomendación no cambia la tanda ni sincroniza automáticamente las semillas con PostgreSQL. Las evaluaciones se registran como feedback; no modifican los pesos del algoritmo ni generan métricas comparativas automáticamente.

La configuración compartida está en `lib/app-api.ts`, las consultas en `lib/app-queries.ts` y las acciones de recomendaciones en `lib/recommendation-actions.ts`.
