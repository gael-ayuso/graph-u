# Backend de GraphU (FastAPI)

API en Python que concentra el acceso a MusicBrainz y el recomendador. Next.js la llama desde el servidor (`lib/musicbrainz.ts`), así el navegador nunca habla con ella directamente.

## Puesta en marcha

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # Windows
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

En Linux/macOS usa `.venv/bin/python`. Documentación interactiva: http://127.0.0.1:8000/docs.

Next.js usa `BACKEND_URL` (por defecto `http://127.0.0.1:8000`). `MUSICBRAINZ_USER_AGENT` permite identificar la aplicación ante MusicBrainz. `LASTFM_API_KEY` activa las señales de Last.fm (sin ella se recomienda con etiquetas y colaboraciones); el backend la lee del entorno o del `.env.local` de la raíz.

Prueba del algoritmo: `.venv/Scripts/python tests/test_recommender.py`.

> En Windows, `--reload` puede dejar un proceso colgado ocupando el puerto 8000. Si pasa, reinicia sin `--reload`.

## Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/health` | Comprobación de estado |
| GET | `/api/music/search?q=&artist=` | Busca canciones. Devuelve `{ songs: Song[] }`, el mismo contrato que la demo |
| POST | `/api/recommendations` | Cuerpo `{ seeds: [mbid, ...], limit?: 1-30, excludeArtists?: [mbid, ...] }`. Devuelve `{ seedTags, recommendations: [{ song, score, sharedTags, signals, artistId }], graph: { nodes, edges } }` |

Los errores devuelven `{ detail: "mensaje en español" }`.

## Cómo recomienda (RF-19, RF-20)

MusicBrainz **no tiene un endpoint de recomendaciones** (`/ws/2/recommendation` devuelve 404); solo guarda metadatos. El recomendador es **híbrido** y combina cuatro señales:

| Señal | Fuente | Qué mide | Peso |
| --- | --- | --- | --- |
| Etiquetas | MusicBrainz (`/artist?query=tag:...`) | Contenido: TF-IDF y coseno sobre las etiquetas de la comunidad | 0.4 |
| Canciones similares | Last.fm `track.getSimilar` | Filtrado colaborativo a nivel de **canción** (scrobbles) | 0.25 |
| Artistas similares | Last.fm `artist.getSimilar` | Filtrado colaborativo a nivel de artista | 0.2 |
| Colaboraciones | MusicBrainz (créditos de grabaciones y relaciones `member of band` / `collaboration`) | Artistas que han hecho featurings o comparten banda con los tuyos | 0.15 |

`puntuación = 0.4·etiquetas + 0.25·canciones + 0.2·artistas + 0.15·colaboración`. Cada señal va de 0 a 1 respecto a su mejor candidato (el coseno de etiquetas también se divide entre el mejor). El peso se reparte **solo entre las señales que devolvieron datos**: si Last.fm está caído, falta la clave o una canción no tiene similares, la puntuación no baja por eso. Un artista que es el mejor en todas las señales activas llega a 1; uno que solo aparece en una suma solo esa parte.

Las señales de Last.fm y de colaboraciones son **opcionales**: si su servicio falla, se recomienda sin ellas en lugar de devolver error. Ninguna señal es imprescindible: basta con que alguna devuelva datos.

1. **Perfil de gusto.** Por cada canción semilla se suman sus etiquetas y las de su artista principal (las grabaciones suelen tener pocas etiquetas; los artistas, muchas). Guían la búsqueda las 3 etiquetas con más votos **más la principal de cada semilla**, para que una canción de un género minoritario en la lista (un corrido entre canciones de pop) también traiga candidatos de su estilo.
2. **Etiquetas (TF-IDF + coseno).** Hasta 100 artistas que tienen alguna de esas etiquetas. Cada artista y cada semilla se convierte en un vector de etiquetas. TF (con escala logarítmica) mide cuánto pesa una etiqueta en ese elemento; IDF reduce el peso de las etiquetas que tiene casi todo el mundo (“rock”) y premia las distintivas (“art rock”, “british”). El coseno entre el perfil medio de las semillas y cada candidato da un valor de 0 a 1.
3. **Canciones similares (Last.fm).** `track.getSimilar` con el título y el artista de cada semilla (`match` de 0 a 1). Solo se aprovechan las canciones que Last.fm devuelve con MBID de grabación y de artista, para enlazar con MusicBrainz sin una búsqueda extra por canción. Se descartan otras versiones de tus canciones (mismo título). Ojo: devuelve vacío para muchas canciones, incluso muy populares («Blinding Lights»). Estas canciones suman puntos a su artista y además son las que se recomiendan de él.
4. **Artistas similares (Last.fm).** `artist.getSimilar` con el artista de cada semilla, hasta 100 (solo los que traen MBID).
5. **Colaboraciones.** Se cuentan los artistas que aparecen en los créditos de las primeras 100 grabaciones del artista semilla, más sus miembros o colaboradores, y se divide entre el que más aparece.
6. **Versiones (último recurso).** Solo para semillas sin ninguna de las señales anteriores (p. ej. «Arturo Garza Treviño» de Los Hnos Banda: sin etiquetas ni datos en Last.fm): artistas que grabaron una canción con el mismo título, con peso 0.15. Quien canta el mismo repertorio suele ser del mismo estilo.
7. **Mezcla y cobertura.** Se suman las señales con sus pesos y se excluyen los artistas de las semillas y los ya mostrados. Antes de repartir los cupos por puntuación, **cada semilla tiene asegurado su mejor artista conectado** (por etiqueta compartida o por una señal que ella originó), así ninguna canción de tu lista se queda sin recomendaciones ni aislada en el grafo.
8. **Canciones.** De cada artista ganador se recomiendan primero sus canciones similares de Last.fm; si no llegan a 2, se completa con canciones de álbumes oficiales (sin directos). Se intercala una por artista para variar los resultados.

Cada resultado incluye `sharedTags` (etiquetas compartidas) y `signals` (`"songs"`, `"listeners"`, `"collab"`, `"versions"`), que **explican** la recomendación. `"songs"` solo aparece en las canciones que vienen de `track.getSimilar`. Un artista que llega solo por Last.fm o colaboración puede no tener etiquetas compartidas.

> Se probó ListenBrainz (`similar-artists`, `similar-recordings`): da buenos resultados y usa MBID, pero el servidor *labs* respondía `502` con frecuencia, así que se dejó fuera.

**Otras recomendaciones:** si al usuario no le convencen los resultados, el front reenvía en `excludeArtists` los artistas que ya vio (hasta 200). El ranking los salta y devuelve los siguientes más parecidos. Cuando se agotan los candidatos, la lista llega vacía y el front ofrece «Empezar de nuevo».

### Grafo explicativo

La respuesta incluye `graph`, que dibuja la pantalla `/explorar` con react-vis-graph-wrapper. Se construye como un `nx.DiGraph` de **NetworkX** (`app/graph.py`) y se poda: se quitan las etiquetas, señales y artistas que no están en ningún camino semilla → canción (las semillas nunca se quitan).

- **Nodos** (`id`, `type`, `label`, `detail?`, `score?`, `degree`): `seed` (tus canciones), `tag` (etiquetas compartidas), `signal` (canciones o artistas similares en Last.fm, colaboraciones o versiones), `artist` (artistas recomendados, con su parecido) y `song` (canciones recomendadas).
- **Aristas** (`from`, `to`): semilla → etiqueta o señal → artista → canción.

Cada camino desde una semilla hasta una canción es la razón de esa recomendación. Personalized PageRank (Etapa 2) usará este mismo formato, así que el front no tendrá que cambiar.

## Limitaciones actuales

- Usa la **API pública** de MusicBrainz porque esta máquina no tiene el MusicBrainz local importado. La API permite 1 petición por segundo: la primera recomendación tarda entre 20 y 30 s (Next espera hasta 60 s), y las repetidas son instantáneas gracias a la caché en memoria. Con la base local (ver `docs/DEMO.md`), el mismo algoritmo se resuelve con consultas SQL a `artist_tag` y `recording_tag` en menos de 1 s (RNF-02).
- La caché vive en memoria y se pierde al reiniciar.
- La API pública no permite obtener la popularidad de las canciones, así que dentro de un artista se eligen las primeras canciones de álbum que devuelve la búsqueda.

## Siguientes algoritmos (hoja de ruta)

- **Personalized PageRank (Etapa 2):** grafo artista–canción–álbum–etiqueta con NetworkX. Recorre el grafo desde las semillas y explica cada resultado con un camino. Encaja con el explorador de grafos.
- **MMR (Maximal Marginal Relevance):** reordenamiento que equilibra parecido y variedad. Reemplazaría la regla actual de “máximo 2 canciones por artista”.
- **Audio features (ReccoBeats):** energía, tempo y valence como señal de “suena parecido”. Se conecta por ISRC, así que conviene esperar al MusicBrainz local (tabla `isrc`). Sus recomendaciones no sirven: son casi aleatorias.
- **Pesos aprendidos:** hoy los pesos 0.4/0.25/0.2/0.15 son fijos; con el feedback de los usuarios (Etapa 5) se pueden ajustar.
