# Backend de GraphU (FastAPI)

API en Python que concentra el acceso a MusicBrainz y el recomendador. Next.js la llama desde el servidor (`lib/musicbrainz.ts`), así el navegador nunca habla con ella directamente.

## Puesta en marcha

Requiere **Python 3.11+**. Mantén esta terminal abierta mientras uses la aplicación web en otra terminal (`npm run dev` o `npm start`).

### 1. Crear el entorno virtual e instalar dependencias (primera vez)

- [requirements.txt](requirements.txt): dependencias de ejecución del backend (`fastapi`, `uvicorn[standard]`, `httpx`, `scikit-learn`, `psycopg[binary]`).
- [requirements-dev.txt](requirements-dev.txt): incluye `requirements.txt` más las herramientas de desarrollo (`pytest` y `ruff`).

**Windows (PowerShell o CMD):**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

**Linux / macOS:**

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Si solo necesitas ejecutar el servidor sin herramientas de desarrollo, sustituye `requirements-dev.txt` por `requirements.txt`.

### 2. Iniciar el servidor FastAPI

Desde `backend/`:

```powershell
# Windows
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```bash
# Linux / macOS
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

O sin cambiar de directorio, desde la raíz del repositorio:

```powershell
# Windows
backend\.venv\Scripts\python -m uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 8000
```

```bash
# Linux / macOS
backend/.venv/bin/python -m uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 8000
```

### 3. Verificar que está activo

- Estado del servicio: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) (devuelve `{"status":"ok","musicbrainz":"local_db"}` cuando la base local de MusicBrainz está activa, o `"public_api"` cuando usa la API pública).
- Documentación interactiva (Swagger UI): [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### Variables de entorno y fuente de MusicBrainz

El backend revisa primero si `MUSICBRAINZ_DATABASE_URL` está configurada y activa en PostgreSQL (`SELECT 1 FROM musicbrainz.recording LIMIT 1` con timeout de conexión de 2 s). Si está activa, consulta el catálogo local; si no está configurada, está apagada o falla en una consulta, cambia automáticamente a la API pública de MusicBrainz.

| Variable | Dónde se configura | Uso |
| --- | --- | --- |
| `BACKEND_URL` | `.env.local` o entorno de Next.js | URL desde donde Next.js consulta al backend (por defecto `http://127.0.0.1:8000`) |
| `MUSICBRAINZ_DATABASE_URL` | Entorno del proceso o `.env.local` de la raíz | Opcional; cadena PostgreSQL del catálogo local de MusicBrainz (ej. `postgresql://musicbrainz:musicbrainz@127.0.0.1:5434/musicbrainz_db`) |
| `LASTFM_API_KEY` | Entorno del proceso o `.env.local` de la raíz | Opcional; activa las señales de Last.fm (`track.getSimilar` y `artist.getSimilar`). Sin ella se recomienda solo con etiquetas y colaboraciones |
| `MUSICBRAINZ_USER_AGENT` | Entorno del proceso o `.env.local` de la raíz | Opcional; identifica la aplicación ante MusicBrainz (por defecto `"GraphU/0.1 (proyecto academico)"`) |

### Búsqueda tolerante a errores

Primero se ejecuta la búsqueda normal. Si devuelve cero canciones, se intenta
una sola búsqueda aproximada en la misma fuente. Si escribes canción y artista,
ambos deben coincidir: no se elimina el filtro de artista para obtener resultados.
Por ejemplo, `Rekoner` / `Radiohed` puede encontrar `Reckoner` / `Radiohead`.
Si la búsqueda normal encuentra otra canción real, se conservan esos resultados.

La comparación admite una edición por palabra de 4–7 caracteres y hasta dos en
palabras de 8 o más (incluido intercambiar letras contiguas). Las palabras de
1–3 caracteres permanecen estrictas. Se conservan acentos y nombres originales;
no es un buscador de alias o transliteraciones. Los candidatos recuperados son
limitados, así que no se garantiza encontrar cualquier error. Se devuelven hasta
20 canciones, sin identificadores repetidos en la rama aproximada.

**API pública:** no necesita preparación. Tras una respuesta normal vacía hace
una consulta Lucene difusa por palabras (hasta 100 candidatos), valida ambos
campos y ordena por cercanía. Conserva el límite de peticiones y los errores de
MusicBrainz; una búsqueda aproximada puede tardar más por la petición adicional.

**Catálogo PostgreSQL local:** ejecuta una vez
[sql/enable_fuzzy_search.sql](sql/enable_fuzzy_search.sql) en la base del catálogo
MusicBrainz, con un usuario que pueda instalar extensiones y crear índices. Es
independiente de la base de la aplicación y de las migraciones Prisma. Con `psql`
instalado y `MUSICBRAINZ_DATABASE_URL` exportada en tu terminal, desde la raíz:

```powershell
psql -X "$env:MUSICBRAINZ_DATABASE_URL" -f backend/sql/enable_fuzzy_search.sql
```

En el contenedor local de MusicBrainz usado en este entorno (ajusta el nombre,
usuario y base si tu instalación usa otros), desde PowerShell:

```powershell
docker cp backend/sql/enable_fuzzy_search.sql musicbrainz-local-db-1:/tmp/graphu-enable-fuzzy-search.sql
docker exec musicbrainz-local-db-1 psql -X -U musicbrainz -d musicbrainz_db -f /tmp/graphu-enable-fuzzy-search.sql
```

El script instala `pg_trgm` en `public` y crea dos índices GIN concurrentes sobre
`lower(name::text)`, en `recording` y `artist_credit`. No lo ejecutes con `psql -1`
ni dentro de una transacción. En un catálogo completo la creación puede tardar
varios minutos y consumir espacio adicional; las búsquedas normales continúan
disponibles durante la preparación. El backend detecta índices válidos sin
reiniciar (caché de capacidad de 15 s).

Sin extensión o sin el índice necesario, solo se omite la búsqueda aproximada
local y se registra un aviso; la base sigue activa. La rama local usa un umbral
de recuperación de `word_similarity` de 0.3 con artista, y 0.4 cuando solo se
escribe canción (calibrado para evitar consultas demasiado amplias en el catálogo
completo). Primero se validan hasta 400 créditos de artista, cuando corresponde;
después se recuperan hasta 400 grabaciones y se validan por palabras. En búsquedas
solo por título, se limita a 400 grabaciones antes de consultar los créditos.
El umbral se aplica únicamente a la
transacción de esa consulta. No equivale a una probabilidad ni se compara con
el score de Lucene. Los fallos SQL mantienen el respaldo público existente.

Si se interrumpe una creación concurrente, PostgreSQL puede dejar un índice
inválido. Comprueba `pg_index.indisvalid` para
`musicbrainz.graphu_recording_name_trgm` y
`musicbrainz.graphu_artist_credit_name_trgm`; elimina únicamente el índice
inválido con `DROP INDEX CONCURRENTLY` y vuelve a ejecutar el script.

### Pruebas y lint del backend

```powershell
# Desde backend/ (Windows)
.venv\Scripts\python -m pytest tests
.venv\Scripts\python -m ruff check app tests

# Desde la raíz del repositorio (Windows)
backend\.venv\Scripts\python -m pytest backend\tests
backend\.venv\Scripts\python -m ruff check backend\app backend\tests
```

En Linux/macOS sustituye `.venv/Scripts/python` por `.venv/bin/python`.

### Solución de problemas

> En Windows, `--reload` puede dejar un proceso colgado ocupando el puerto 8000. Si pasa, detén el proceso de Python que ocupa el puerto y reinicia sin `--reload`.

- **Next.js responde `503` (`"No se pudo conectar con el backend de GraphU"`):** confirma que Uvicorn sigue corriendo en `127.0.0.1:8000` (probando `/health`) y que `BACKEND_URL` en `.env.local` coincide con el host y puerto donde iniciaste FastAPI.
- **El arranque inicial tarda unos segundos:** es normal al importar `scikit-learn` y FastAPI en frío; espera a ver `Uvicorn running on http://127.0.0.1:8000` en la consola.

## Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/health` | Comprobación de estado y fuente activa (`local_db` o `public_api`) |
| GET | `/api/music/search?q=&artist=` | Busca canciones. Devuelve `{ songs: Song[] }`, el mismo contrato que la demo |
| POST | `/api/recommendations` | Cuerpo `{ seeds: [mbid, ...] (1-10), limit?: 1-30, excludeArtists?: [mbid, ...], excludeRecordings?: [mbid, ...], excludeVersions?: [{ artistId, title }, ...] }`; cada lista de exclusiones admite hasta 200 entradas. Devuelve `{ seedTags, recommendations: [{ song, score, sharedTags, signals, artistId, seedIds, reasons }], seedResults, graph: { nodes, edges } }` |

Los errores devuelven `{ detail: "mensaje en español" }`.

## Cómo recomienda (RF-19, RF-20)

MusicBrainz **no tiene un endpoint de recomendaciones** (`/ws/2/recommendation` devuelve 404); solo guarda metadatos. El recomendador es **híbrido** y combina cuatro señales:

| Señal | Fuente | Qué mide | Peso |
| --- | --- | --- | --- |
| Etiquetas | MusicBrainz (`artist_tag` local o `/artist?query=tag:...`) | Contenido: TF-IDF y coseno sobre las etiquetas de la comunidad | 0.4 |
| Canciones similares | Last.fm `track.getSimilar` | Filtrado colaborativo a nivel de **canción** (scrobbles) | 0.25 |
| Artistas similares | Last.fm `artist.getSimilar` | Filtrado colaborativo a nivel de artista | 0.2 |
| Colaboraciones | MusicBrainz (créditos de grabaciones y relaciones `member of band` / `collaboration`) | Artistas que han hecho featurings o comparten banda con los tuyos | 0.15 |

`puntuación = 0.4·etiquetas + 0.25·canciones + 0.2·artistas + 0.15·colaboración`. Cada señal va de 0 a 1 respecto a su mejor candidato (el coseno de etiquetas también se divide entre el mejor). El peso se reparte **solo entre las señales que devolvieron datos**: si Last.fm está caído, falta la clave o una canción no tiene similares, la puntuación no baja por eso. Un artista que es el mejor en todas las señales activas llega a 1; uno que solo aparece en una suma solo esa parte.

Todas las señales son **opcionales**: una canción sin etiquetas puede recomendar por Last.fm o colaboraciones. Si falla la búsqueda por etiquetas, se intentan las demás señales. Una semilla cuyo perfil no se puede consultar se informa como no disponible sin bloquear las otras.

1. **Perfil por canción.** Se suman las etiquetas de cada canción semilla y de su artista principal. Sus 3 etiquetas con más votos guían su propia búsqueda. Cada canción tiene su ranking; las etiquetas de una semilla no restringen los candidatos de otra.
2. **Etiquetas (TF-IDF + coseno).** Hasta 100 artistas por consulta que tienen alguna de esas etiquetas. Cada artista y la semilla se convierten en vectores de etiquetas. TF (con escala logarítmica) mide cuánto pesa una etiqueta; IDF reduce el peso de las etiquetas comunes. Se calcula el coseno entre esa semilla y cada candidato, sin promediarla con las demás.
3. **Canciones similares (Last.fm).** `track.getSimilar` con el título y el artista de cada semilla (`match` de 0 a 1). Solo se aprovechan las canciones que Last.fm devuelve con MBID de grabación y de artista. Se excluyen las grabaciones semilla y los artistas indicados en `excludeArtists`. No se descartan canciones de otros artistas solo por compartir título. Esta fuente puede devolver vacío incluso para canciones populares.
4. **Artistas similares (Last.fm).** `artist.getSimilar` con el artista de cada semilla, hasta 100 (solo los que traen MBID).
5. **Colaboraciones.** Se cuentan los artistas que aparecen en los créditos de las primeras 100 grabaciones del artista semilla, más sus miembros o colaboradores, y se divide entre el que más aparece.
6. **Mezcla por semilla.** Se suman las señales disponibles de esa canción y se excluyen los artistas recibidos en `excludeArtists`. Los artistas de las semillas son elegibles si las señales existentes los proponen, sin garantizar su presencia ni una mezcla concreta en cada tanda. Las señales sin candidatos válidos después de excluirlos no reducen la puntuación.
7. **Canciones y reparto.** De cada artista se priorizan sus pistas similares de Last.fm y se completa con álbumes oficiales cuando hay una razón válida para recomendarlos. Se cargan candidatos por lotes; si un artista no devuelve pistas utilizables, se continúa con los siguientes. La selección toma un turno por semilla, elimina grabaciones y títulos/artista repetidos y procura un máximo de 2 canciones por artista. Cubrir una semilla aún sin resultados tiene prioridad sobre ese máximo. Si hay espacio y candidatos válidos, los estilos minoritarios también reciben resultados.

Cada resultado incluye `seedIds` y `reasons: [{ seedId, score, sharedTags, signals }]`: conserva la explicación independiente de cada canción que lo originó. Los campos agregados `score`, `sharedTags` y `signals` muestran la máxima puntuación y la unión de las razones. `"songs"` solo aparece para la grabación que viene de `track.getSimilar`; `"versions"` explica otra grabación del mismo título/artista al deduplicar versiones. Una pista de álbum requiere etiquetas u otra señal propia. Un resultado compartido se muestra una sola vez y cuenta para todas sus semillas de origen.

`seedResults` contiene un estado y mensaje por semilla, con sus `recommendationIds`: `recommended`, `no_candidates` (sin artistas nuevos utilizables), `no_tracks` (artistas sin pistas utilizables), `unavailable` (consulta fallida), `limit` (sin espacio en la tanda o por diversidad de artistas) o `search_limit` (quedaron candidatos sin revisar por el presupuesto de consultas). No se inventan relaciones cuando faltan datos. `seedTags` es la unión descriptiva de las principales etiquetas de cada semilla; no es un filtro global.

> Se probó ListenBrainz (`similar-artists`, `similar-recordings`): da buenos resultados y usa MBID, pero el servidor *labs* respondía `502` con frecuencia, así que se dejó fuera.

**Exploración por tandas:** el cliente inicia con las primeras 10 canciones de «Mi lista» y permite ampliar desde 1–10 recomendaciones seleccionadas de cualquier tanda. Envía las grabaciones vistas en `excludeRecordings` y los pares conocidos en `excludeVersions`; el backend normaliza el título con `strip().casefold()` y los filtra antes de elegir pistas y repartir resultados. Un mismo título de otro artista sigue siendo elegible. La identificación de versiones depende de que se conozca el artista y no cubre todas las equivalencias musicales.

La aplicación pide hasta 10 resultados por tanda y reduce esa cifra si queda menos espacio bajo el tope de 200 canciones, incluidos los originales. El `limit` solicitado es un máximo, no una cantidad garantizada. Las alternativas parten de los originales y además envían artistas vistos en `excludeArtists`; ampliar no excluye automáticamente todos los artistas anteriores. Una respuesta vacía o fallida conserva el historial y la selección; no demuestra que el catálogo esté agotado.

Cada `seedResults` incluye `artistId` cuando se conoce y `searchLimited` si quedaron consultas sin hacer por cuota o tiempo, incluso si su estado es `recommended`. El cliente muestra esa cobertura y los avisos correspondientes. El historial de tandas solo vive en memoria durante la navegación; recargar lo elimina. Favoritos, votos y registros individuales conservan su persistencia existente y no restauran la exploración.

### Grafo explicativo

La respuesta incluye `graph`, utilizado para el detalle de una tanda en `/explorar`:

- **Nodos** (`id`, `type`, `label`, `detail?`, `score?`): `seed`, `tag`, `signal`, `artist`, `song` y `status` (motivo por el que una semilla no tiene resultados en esta tanda).
- **Aristas** (`from`, `to`): semilla → etiqueta o señal → artista → canción.

Las etiquetas y señales pertenecen a su semilla; los nodos de artista pertenecen a cada rama y resultado. Así, compartir un artista o el nombre de una señal no crea caminos falsos hacia recomendaciones de otras semillas. Las semillas sin resultados apuntan a un nodo de estado y muestran su explicación también en una lista accesible en la demo y el explorador.

El resumen acumulado se deriva de las razones de todas las tandas: representa cada grabación una vez y conecta cada origen real con su recomendación. No une globalmente etiquetas o artistas. Lista y grafo comparten selección e historial; navegar o cambiar la distribución no genera otra petición.

## Limitaciones actuales

- Se procesan hasta 10 semillas por petición. El inicio usa las primeras 10 de la lista y las ampliaciones usan las recomendaciones seleccionadas. El límite de resultados es 10 por defecto (1-30 en FastAPI); si es menor que el número de semillas, no se garantiza espacio para todas.
- La API pública de MusicBrainz limita a 1 petición por segundo. Se reparten hasta 12 consultas nuevas de catálogo entre las semillas (`max(1, 12 // semillas)` por semilla); con la base local se pueden revisar hasta 100 artistas por semilla. Además, a los 45 s se dejan de iniciar nuevas consultas en todas las etapas y se devuelven los resultados ya disponibles. Se prepara cada rama en su turno, para conservar resultados tempranos antes de consultar otras semillas. Una consulta/reintento en curso puede finalizar después de ese plazo: no es un timeout estricto de 45 s. El cliente espera hasta 180 s en recomendaciones (60 s en búsquedas). Las semillas con candidatos sin revisar por tiempo o cuota informan `search_limit`, sin afirmar que no hay candidatos. Las pistas de álbum se comparten en caché dentro de la petición.
- La caché vive en memoria y se pierde al reiniciar.
- Ni la API pública ni el catálogo local incluyen métricas de popularidad por canción, así que dentro de un artista se eligen las primeras canciones de álbum oficial disponibles.

## Siguientes algoritmos (hoja de ruta)

- **Personalized PageRank (Etapa 2):** grafo artista–canción–álbum–etiqueta con NetworkX. Recorre el grafo desde las semillas y explica cada resultado con un camino. Encaja con el explorador de grafos.
- **MMR (Maximal Marginal Relevance):** reordenamiento que equilibra parecido y variedad. Reemplazaría la regla actual de “máximo 2 canciones por artista”.
- **Audio features (ReccoBeats):** energía, tempo y valence como señal de “suena parecido”. Se conecta por ISRC, así que conviene aprovechar el MusicBrainz local (tabla `isrc`). Sus recomendaciones no sirven: son casi aleatorias.
- **Pesos aprendidos:** hoy los pesos 0.4/0.25/0.2/0.15 son fijos; con el feedback de los usuarios (Etapa 5) se pueden ajustar.
