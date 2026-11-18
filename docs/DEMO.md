# Demo de canciones

Abre `/demo`. Busca por título, artista o ambos; añade canciones a la lista y quítalas cuando quieras. La lista se conserva en el almacenamiento local del navegador y no se sincroniza con las cuentas de Clerk.

Con canciones en la lista, pulsa «Iniciar desde Mi lista». Se capturan las primeras 10 como originales y se crea una primera tanda. Cada resultado conserva sus razones y su puntuación por canción de origen: etiquetas compartidas, similitud de Last.fm o colaboraciones. El algoritmo se describe en [backend/README.md](../backend/README.md).

Marca entre 1 y 10 recomendaciones de cualquier tanda con «Elegir para ampliar». El botón muestra cuántas elegiste: «Ampliar con 1 canción», «Ampliar con 2 canciones», etc. Púlsalo para buscar a partir de esas canciones. La selección es independiente de Guardar y de los votos. Cada ampliación añade una tanda al historial; también puedes elegir canciones de distintas tandas. «Otras desde las canciones iniciales» busca alternativas desde los originales y excluye artistas ya mostrados, sin usar la selección. El inicio y las alternativas no requieren seleccionar recomendaciones.

Cada consulta pide hasta 10 canciones nuevas, o las plazas restantes hasta el límite de 200 canciones únicas contando los originales. La cantidad recibida puede ser menor por disponibilidad, exclusiones o presupuesto. La aplicación excluye las grabaciones ya vistas y las versiones con título y artista conocidos; no identifica todas las posibles versiones o colaboraciones. Puede recomendar canciones nuevas de los mismos artistas que las canciones elegidas junto a otros artistas, cuando las señales disponibles los propongan; esta mezcla no está garantizada. Las alternativas siguen excluyendo los artistas ya mostrados, incluso si coinciden con artistas de las canciones iniciales. Al alcanzar el límite se conserva el historial y se ofrece empezar una exploración nueva. La cobertura y los avisos indican cuando el tiempo o las consultas limitaron la búsqueda; no implican que se haya agotado el catálogo.

Durante una consulta se conserva el historial. «Cancelar consulta» permite detenerla; una respuesta tardía no reemplaza el estado vigente. Un error o una respuesta vacía conserva las tandas anteriores y la selección. «Reemplazar desde Mi lista» solo sustituye la exploración al recibir una primera tanda válida con resultados. «Reiniciar exploración» pide confirmar con «Sí, reiniciar» antes de limpiar el historial temporal; mantiene «Mi lista».

Cada recomendación permite «Guardar», «Me gusta» o «No me interesa», tanto en la demo como en la lista debajo del grafo. Puedes cambiar tu valoración o pulsar la opción seleccionada para quitarla. «Canciones guardadas» permite consultar y quitar canciones sin alterar las semillas ni hacer desaparecer las recomendaciones actuales.

Con sesión, las recomendaciones generadas, los favoritos y las evaluaciones se guardan en PostgreSQL (`DATABASE_URL`, con las migraciones de la aplicación aplicadas). Sin sesión, las canciones guardadas y las valoraciones se conservan en este navegador. No se transfieren automáticamente entre la demo y una cuenta; si el almacenamiento local falla, se avisa y se mantienen temporalmente en la página.

El grafo muestra por defecto todas las tandas juntas; cada nueva tanda con resultados vuelve a esta vista acumulada, que conecta cada canción con los descubrimientos para los que fue origen. «Ver todas las tandas en un solo grafo» abre `/explorar` en esa vista. «Ver detalle de esta tanda» abre el detalle de una tanda con sus etiquetas, señales, artistas y canciones. En «Tanda mostrada en el grafo», elige «Todas las tandas · Exploración completa» para volver al resumen. Estos enlaces conservan el historial y la selección sin generar otra consulta. Puedes cambiar entre «Libre» y «Por niveles» y usar la lista accesible junto al grafo. Volver a la lista o navegar durante una consulta conserva la exploración y el pendiente.

La exploración y su agrupación de tandas viven solo en la página: recargar o cerrar la pestaña las elimina. Modificar «Mi lista» no cambia los originales capturados. Las canciones guardadas, los votos y los registros individuales mantienen la persistencia descrita arriba; no restauran automáticamente la exploración.

## Requisitos

La demo necesita el backend FastAPI en ejecución (`backend/`, puerto `8000`) y las claves de Clerk en `.env.local`, porque el middleware de Clerk envuelve todas las rutas.

Ejecuta ambos servicios en **dos terminales distintas** desde la raíz del repositorio (consulta [backend/README.md](../backend/README.md#puesta-en-marcha) si aún no creaste el entorno virtual `.venv`):

```powershell
# Terminal 1: backend FastAPI (Windows)
backend\.venv\Scripts\python -m uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2: Next.js
npm run dev
```

En Linux/macOS usa `backend/.venv/bin/python` en la primera terminal.

## Fuente de datos

Next.js no consulta MusicBrainz directamente: `lib/musicbrainz.ts` reenvía las búsquedas y recomendaciones al backend (`BACKEND_URL`, por defecto `http://127.0.0.1:8000`).

El backend verifica primero si `MUSICBRAINZ_DATABASE_URL` está configurada y activa en PostgreSQL (por ejemplo, el catálogo local en `127.0.0.1:5434`). Si está activa, consulta las tablas locales (`recording`, `artist_credit`, `artist_tag`, `recording_tag`, etc.) en menos de un segundo; si no está disponible, utiliza automáticamente la API pública de MusicBrainz (limitada a 1 petición por segundo).
