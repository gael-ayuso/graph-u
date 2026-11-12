# Demo de canciones

Abre `/demo`. Busca por título, artista o ambos; añade canciones a la lista y quítalas cuando quieras. La lista se conserva en el almacenamiento local del navegador y no se sincroniza con las cuentas de Clerk.

Con canciones en la lista, pulsa «Recomendar con mi lista»: el backend devuelve canciones parecidas con su porcentaje de parecido y lo que lo explica: etiquetas compartidas, canciones o artistas similares según Last.fm, o colaboraciones entre artistas. El algoritmo se describe en [backend/README.md](../backend/README.md).

Si no te convencen, «Otras recomendaciones» trae artistas distintos con los mismos criterios, sin repetir los que ya viste. El explorador del grafo tiene el mismo botón.

«Ver en el grafo →» abre `/explorar`, que dibuja las recomendaciones de tu lista como un grafo: tu canción → etiquetas, similitud en Last.fm o colaboraciones → artistas → canciones. Al seleccionar un nodo se muestra por qué aparece.

## Requisitos

La demo necesita el backend FastAPI en ejecución (`backend/`, puerto 8000) y las claves de Clerk en `.env.local`, porque el middleware de Clerk envuelve todas las rutas.

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000
npm run dev
```

## Fuente de datos

Next.js no consulta MusicBrainz directamente: `lib/musicbrainz.ts` reenvía las búsquedas y recomendaciones al backend (`BACKEND_URL`, por defecto `http://127.0.0.1:8000`). El backend usa ahora la API pública de MusicBrainz, limitada a 1 petición por segundo, por lo que la primera recomendación tarda varios segundos.

La alternativa prevista es un MusicBrainz local en Docker (PostgreSQL en `127.0.0.1:5433`, base y usuario `musicbrainz`). Cuando esté importado, el backend podrá consultarlo directamente con las tablas `recording`, `artist_credit`, `artist_tag` y `recording_tag`.
