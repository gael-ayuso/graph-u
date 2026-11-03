# Propuesta de Interfaz ASCII: Recorrido Guiado (Landing GraphU)

> [!IMPORTANT]
> **ESTADO DE LA PROPUESTA: PROPUESTA NO APROBADA - EN REVISIÓN**  
> Documento técnico de diseño para evaluación de concepto. No sustituye ni modifica la implementación frontend actual.

- **Rama de trabajo:** `design/landing-ascii-recorrido`
- **Concepto clave:** Recorrido Guiado (Editorial Onboarding & 3-Step Guided Journey)
- **Estilo visual:** Terminal moderna cálida inspirada en Ratatui, paleta Gruvbox Dark, tipografía monoespaciada (Geist Mono), marcos cuadrados (sin esquinas redondeadas).

---

## 1. Concepto y Enfoque de Diseño

### 1.1. Justificación de la propuesta «Recorrido Guiado»
A diferencia de una herramienta analítica o un visor técnico, la **Landing Page** de GraphU debe cumplir una función primordialmente **editorial y orientadora**:
1. **Explicar el modelo mental de GraphU de forma secuencial:** Descompone la experiencia en tres momentos intuitivos: *Parte de una canción* $\rightarrow$ *Explora conexiones* $\rightarrow$ *Reúne lo que te gusta*.
2. **Diferenciación estricta de pantallas y entornos:**
   - **Landing (`/`):** Presentación editorial de marca, explicación conceptual del recorrido guiado y derivación clara a registro o demo.
   - **Demo (`/demo`):** Herramienta independiente de búsqueda de canciones por título o artista contra la base de datos local de MusicBrainz (PostgreSQL local), con guardado en `localStorage`. No incluye explorador de grafos ni sincronización con Clerk.
   - **Explorador de grafos:** Objetivo de producto y capacidad interactiva prevista en el roadmap; no está implementado ni activo en la landing.
3. **Honestidad de producto y delimitación rigurosa:**
   - El grafo presentado en la landing es explícitamente una **«Vista ilustrativa»** (static preview), construida sobre ejemplos reales y verificados: **Radiohead (*Reckoner*, In Rainbows)** y **Daft Punk (*Digital Love*, Discovery)**.
   - **Sin afirmaciones no verificadas:** No hay motor de recomendaciones en ejecución, no se simula reproducción de audio (no playback), ni se afirman cálculos de afinidades o géneros automatizados.
   - **Capacidades previstas:** Las funciones de *Favoritos*, *Playlists* y *Feedback* se documentan explícitamente como capacidades previstas en plataforma, sin fingir operatividad actual en la landing.

---

## 2. Arquitectura de Acciones (CTAs) y Jerarquía Visual

| Elemento / Acción | Destino / Enrutamiento | Jerarquía Visual | Estilo Gruvbox Dark (Ratatui) | Rol Funcional |
| :--- | :--- | :--- | :--- | :--- |
| **Crear cuenta** | `/sign-up` | **Primaria** | Fondo Clay (`#fabd2f`), texto Forest (`#282828`). Borde plano `0px`. | Registro principal de usuario mediante Clerk en español. |
| **Probar demo** | `/demo` | **Secundaria** | Fondo transparente, marco Copper (`#fe8019`), texto Cream (`#ebdbb2`). | Acceso a búsqueda de canciones en catálogo MusicBrainz local y lista local. |
| **Iniciar sesión** | `/sign-in` | **Utilidad / Nav** | Texto Cream (`#ebdbb2`), realce en hover/foco. | Acceso para usuarios existentes en Clerk. |
| **Cómo funciona / Recorrido** | `#como-funciona` / `#recorrido` | **Navegación interna**| Texto plano mono Cream (`#ebdbb2`). | Salto accesible a los bloques explicativos de la landing. |
| **MusicBrainz** | `https://musicbrainz.org/` | **Atribución externa** | Enlace externo con `rel="noreferrer"`. | Fuente abierta de datos catalográficos. |
| **Fuentes de carátulas** | `public/music/SOURCES.md` | **Documentación interna** | Enlace a registro de procedencia. | Cover Art Archive (imágenes originales sin modificar). |
| **Motivos ASCII Magic** | `docs/ascii-magic-recorrido.json` | **Documentación interna** | Decoraciones generadas por MCP ASCII Magic. | Vinilo geométrico y onda sonora decorativa. |

---

## 3. Boceto ASCII Desktop Completo (90 Columnas)

El siguiente boceto representa la landing page de escritorio completa en 90 columnas de ancho (límite estricto $\le 92$ columnas):

```text
+----------------------------------------------------------------------------------------+
|  GraphU_                      [Como funciona]   [Recorrido]   [Demo]   [Iniciar sesion]|
|  ------------------------------------------------------------------------------------  |
|  HERO EDITORIAL                                                                        |
|  ======================================================================================|
|  CONECTA TUS GUSTOS.                                                                   |
|  DESCUBRE OTRA CANCION.                                                                |
|                                                                                        |
|  Explora conexiones entre artistas y canciones a partir de datos de MusicBrainz.       |
|  Un recorrido guiado en 3 pasos hacia la futura exploracion interactiva de grafos.     |
|                                                                                        |
|  [ CREAR CUENTA -> ]  (/sign-up)             [ PROBAR DEMO DE BUSQUEDA ]  (/demo)      |
|                                                                                        |
|  ======================================================================================|
|  RECORRIDO GUIADO  ::  3 PASOS HACIA EL DESCUBRIMIENTO MUSICAL                         |
|  ======================================================================================|
| +------------------------+    +------------------------+    +------------------------+ |
| | PASO 01                |    | PASO 02                |    | PASO 03                | |
| | Parte de una cancion   | -> | Explora conexiones     | -> | Reune lo que te gusta  | |
| | Punto de partida base  |    | Vista ilustrativa      |    | Colecciona en listas   | |
| | Ej: Radiohead          |    | Puente a Daft Punk     |    | (Capacidad prevista)   | |
| +------------------------+    +------------------------+    +------------------------+ |
|                                                                                        |
|  DETALLE DEL RECORRIDO GUIADO                                                          |
|  --------------------------------------------------------------------------------------|
|  [01] PARTE DE UNA CANCION DE REFERENCIA                                               |
|  El recorrido comienza identificando una pieza musical concreta en MusicBrainz.        |
|  (En /demo ya puedes buscar canciones por titulo o artista en el catalogo local):      |
|  * Artista : Radiohead                                                                 |
|  * Album   : In Rainbows (2007) . [Portada: Cover Art Archive]                         |
|  * Cancion : Reckoner                                                                  |
|                                                                                        |
|  [02] EXPLORA CONEXIONES  [ VISTA ILUSTRATIVA . GRAFO INTERACTIVO PREVISTO ]           |
|  Un ejemplo conceptual de conexiones entre dos obras.                                  |
|  (Muestra grafica ilustrativa; el explorador interactivo es un objetivo previsto):     |
|                                                                                        |
|  +------------------------------------------------------------------------------------+|
|  | MAPA DE CONEXIONES                                           [ Vista ilustrativa ] ||
|  |                                                                                    ||
|  |   +---------------------------+                  +---------------------------+     ||
|  |   | Radiohead                 | . . . . . . . . .| Daft Punk                 |     ||
|  |   | [In Rainbows, 2007]       |  Vinculo sonoro  | [Discovery, 2001]         |     ||
|  |   | Cancion: Reckoner         |   ilustrativo    | Cancion: Digital Love     |     ||
|  |   +---------------------------+                  +---------------------------+     ||
|  |                 |                                              |                   ||
|  |                 v                                              v                   ||
|  |   [ Art-Rock / Arpegios ]                        [ French House / Sintetizadores ] ||
|  |                                                                                    ||
|  |   Aviso: Conexion ilustrativa estatica. Sin reproduccion de audio ni motor activo. ||
|  +------------------------------------------------------------------------------------+|
|                                                                                        |
|  [03] REUNE LO QUE TE GUSTA  (Capacidades previstas en plataforma)                     |
|  Organizacion de hallazgos para enriquecer tu biblioteca personal:                     |
|  * Favoritos : Guardar artistas y canciones predilectas (capacidad prevista).          |
|  * Playlists : Reunir recomendaciones en listas de escucha (capacidad prevista).       |
|  * Feedback  : Valorar sugerencias recibidas (capacidad prevista).                     |
|                                                                                        |
|  ======================================================================================|
|  COMIENZA HOY MISMO                                                                    |
|                                                                                        |
|         [ CREAR CUENTA ]                          [ PROBAR DEMO DE BUSQUEDA ]          |
|       (Destino: /sign-up)                             (Destino: /demo)                 |
|                                                                                        |
|              ?Ya dispones de cuenta?  -->  [ Iniciar sesion ]  (/sign-in)              |
|  --------------------------------------------------------------------------------------|
|  Datos musicales: MusicBrainz                                                          |
+----------------------------------------------------------------------------------------+
```

---

## 4. Boceto ASCII Móvil Completo (40 Columnas)

El siguiente boceto representa la adaptación vertical para pantallas móviles en 40 columnas de ancho (límite estricto $\le 40$ columnas):

```text
+--------------------------------------+
| GraphU_                       [Menu] |
| ------------------------------------ |
| HERO EDITORIAL                       |
| ==================================== |
| CONECTA TUS GUSTOS.                  |
| DESCUBRE OTRA CANCION.               |
|                                      |
| Explora relaciones entre artistas y  |
| canciones con datos MusicBrainz.     |
|                                      |
| [ CREAR CUENTA ]     -> /sign-up     |
|                                      |
| [ PROBAR DEMO ]      -> /demo        |
| (Busqueda en catalogo local)         |
|                                      |
| ==================================== |
| RECORRIDO GUIADO EN 3 PASOS          |
| ==================================== |
| [01] PARTE DE UNA CANCION            |
| Anclaje en pieza de partida:         |
| * Radiohead - Reckoner               |
|   (Album: In Rainbows, 2007)         |
|                  |                   |
|                  v                   |
| [02] EXPLORA CONEXIONES              |
| Salto ilustrativo entre artistas:    |
|                                      |
| +----------------------------------+ |
| | [ Vista ilustrativa ]            | |
| |                                  | |
| | Radiohead (Reckoner)             | |
| |       . . . . . . . . .          | |
| |       : Vinculo sonoro           | |
| |       v ilustrativo              | |
| | Daft Punk (Digital Love)         | |
| |                                  | |
| | Sin playback ni motor activo     | |
| +----------------------------------+ |
|                  |                   |
|                  v                   |
| [03] REUNE LO QUE TE GUSTA           |
| Capacidades futuras previstas:       |
| * Favoritos : Guardar artistas       |
| * Playlists : Listas de temas        |
| * Feedback  : Valorar hallazgos      |
|                                      |
| ==================================== |
| EMPIEZA TU RECORRIDO                 |
| [ CREAR CUENTA ]  -> /sign-up        |
| [ PROBAR DEMO ]   -> /demo           |
| ?Tienes cuenta?   -> /sign-in        |
| ------------------------------------ |
| GraphU_ . Terminal calida Ratatui    |
| Datos: musicbrainz.org               |
+--------------------------------------+
```

---

## 5. Especificaciones de Implementación Visual (Gruvbox Dark & Ratatui)

- **Contenedor:** Ancho máximo de 1512px con márgenes horizontales de 52px en desktop, escalando a 20px en móviles.
- **Paleta Gruvbox Dark:**
  - `Forest (#282828)`: Canvas principal y superficies de fondo.
  - `Cream (#ebdbb2)`: Tipografía principal, etiquetas y marcos secundarios.
  - `Clay (#fabd2f)`: Acciones primarias (`/sign-up`), cursor de terminal `_` y elementos activos.
  - `Copper (#fe8019)`: Botones secundarios de borde (`/demo`) y divisores acentuados.
  - `Olive (#665c54)`: Bordes, divisores sutiles y tarjetas de terminal.
  - `Green (#b8bb26)`: Nodos y conexiones de grafos ilustrativos.
- **Tipografía y formas:** Monospace (`Geist Mono, monospace`). Bordes estrictamente rectangulares (`rounded: 0px`). Sin sombras decorativas (`box-shadow: none`), logrando una estética Ratatui sobria y táctil.

---

## 6. Motivos Decorativos ASCII Magic MCP

Para enriquecer la textura de terminal sin competir con el contenido ni sustituir las carátulas originales:
1. **Vinilo geométrico (`public/ascii/recorrido-vinyl.png`):** Integrado en el lateral del Hero junto a la ficha de punto de partida, con dimensiones responsivas (220px móvil a 340px desktop), atributos `alt=""`, `aria-hidden="true"`, `pointer-events: none` y `priority` para evitar layout shifts.
2. **Onda sonora / Conexiones (`public/ascii/recorrido-wave.png`):** Integrada como banner horizontal de transición en el cierre antes de la tarjeta CTA, con `alt=""`, `aria-hidden="true"` y preservando la legibilidad del bloque de acción.
3. **Procedencia y Recipes:** Documentados en [`docs/ascii-magic-recorrido.json`](file:///C:/Users/goods/.traycer/worktrees/gael-ayuso__graph-u/design-landing-ascii-recorrido/docs/ascii-magic-recorrido.json) con estilo `characters`, plan gratuito, `scanLines` y `charBloom`.
