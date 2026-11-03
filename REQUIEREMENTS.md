# GraphU — Documento de Requisitos

## 1. Nombre de la aplicación

**GraphU**

Aplicación web de exploración musical, visualización de relaciones mediante grafos y generación de recomendaciones personalizadas.

## 2. Descripción general del problema o necesidad

Actualmente existen grandes catálogos musicales que permiten consultar canciones, artistas y álbumes. Sin embargo, descubrir nueva música relacionada con los gustos personales y comprender las conexiones entre diferentes entidades musicales puede resultar complicado.

Además, muchos sistemas de recomendación presentan canciones sin proporcionar una explicación clara de las relaciones que motivaron dichas sugerencias.

**GraphU** busca atender esta necesidad mediante una aplicación web que permita explorar información musical, visualizar conexiones entre canciones, artistas, álbumes y géneros, y obtener recomendaciones personalizadas.

Para ello, se utilizará **MusicBrainz** como fuente principal de información musical, aprovechando su catálogo de artistas, grabaciones, álbumes, géneros y relaciones.

## 3. Requisitos funcionales

Los requisitos funcionales describen las operaciones y servicios que deberá proporcionar la aplicación.

### 3.1. Gestión de usuarios

| ID | Requisito funcional |
|---|---|
| RF-01 | El sistema permitirá registrar nuevos usuarios. |
| RF-02 | El sistema permitirá iniciar y cerrar sesión. |
| RF-03 | El usuario podrá consultar y modificar la información de su perfil. |
| RF-04 | El usuario podrá configurar sus preferencias musicales y de recomendación. |
| RF-05 | El usuario podrá eliminar su cuenta. |

### 3.2. Exploración musical

| ID | Requisito funcional |
|---|---|
| RF-06 | El sistema permitirá buscar canciones, artistas y álbumes mediante su nombre. |
| RF-07 | El sistema mostrará información detallada de las entidades musicales consultadas. |
| RF-08 | El sistema permitirá explorar las relaciones existentes entre canciones, artistas, álbumes y géneros. |
| RF-09 | El sistema representará dichas relaciones mediante grafos interactivos. |

### 3.3. Gestión de favoritos

| ID | Requisito funcional |
|---|---|
| RF-10 | El usuario podrá guardar canciones como favoritas. |
| RF-11 | El usuario podrá guardar artistas como favoritos. |
| RF-12 | El usuario podrá consultar sus canciones y artistas favoritos. |
| RF-13 | El usuario podrá eliminar canciones y artistas de sus favoritos. |

### 3.4. Gestión de playlists

| ID | Requisito funcional |
|---|---|
| RF-14 | El usuario podrá crear playlists personalizadas. |
| RF-15 | El usuario podrá consultar sus playlists y las canciones que contienen. |
| RF-16 | El usuario podrá modificar el nombre y descripción de sus playlists. |
| RF-17 | El usuario podrá agregar, eliminar y reorganizar canciones dentro de una playlist. |
| RF-18 | El usuario podrá eliminar playlists. |

### 3.5. Sistema de recomendaciones musicales

| ID | Requisito funcional |
|---|---|
| RF-19 | El usuario podrá seleccionar una o varias canciones semilla para solicitar recomendaciones musicales. |
| RF-20 | El sistema generará recomendaciones mediante similitud de etiquetas musicales utilizando TF-IDF y similitud coseno. |
| RF-21 | El sistema podrá generar recomendaciones personalizadas utilizando las canciones y artistas favoritos del usuario. |
| RF-22 | El sistema mostrará una lista ordenada de canciones recomendadas. |
| RF-23 | El sistema permitirá guardar canciones recomendadas en favoritos o playlists. |
| RF-24 | El sistema incorporará progresivamente recomendaciones por tags, relaciones del grafo y escuchas de ListenBrainz, y combinará sus puntuaciones mediante pesos configurables. |

### 3.6. Evaluación de recomendaciones

| ID | Requisito funcional |
|---|---|
| RF-25 | El usuario podrá indicar si una recomendación le gusta o no le interesa. |
| RF-26 | El sistema registrará las recomendaciones generadas y las interacciones asociadas. |
| RF-27 | El sistema permitirá evaluar y comparar el rendimiento de diferentes algoritmos mediante métricas de recomendación. |

## 4. Requisitos no funcionales

Los requisitos no funcionales establecen las características de calidad, rendimiento, seguridad y mantenimiento que deberá cumplir el sistema.

| ID | Categoría | Requisito no funcional |
|---|---|---|
| RNF-01 | Rendimiento | Las búsquedas musicales comunes deberán responder en menos de 3 segundos, bajo condiciones normales de operación y carga. |
| RNF-02 | Rendimiento | El sistema deberá generar recomendaciones iniciales en menos de 5 segundos para consultas habituales sobre datos previamente procesados. |
| RNF-03 | Usabilidad | La interfaz deberá ser intuitiva, mantener una navegación consistente y adaptarse a computadoras y dispositivos móviles. |
| RNF-04 | Seguridad | Clerk gestionará la autenticación y las credenciales; GraphU no almacenará contraseñas y sincronizará los datos necesarios del perfil. |
| RNF-05 | Seguridad | Las operaciones sobre información privada deberán requerir autenticación y autorización. |
| RNF-06 | Integridad | La base de la aplicación utilizará claves primarias, foráneas internas y restricciones. Las referencias a MusicBrainz se validarán por identificador, sin claves foráneas entre instancias. |
| RNF-07 | Mantenibilidad | La aplicación deberá mantener separadas las responsabilidades del FrontEnd, BackEnd y base de datos. |
| RNF-08 | Escalabilidad | La arquitectura deberá permitir incorporar nuevos algoritmos de recomendación sin modificar significativamente los módulos existentes. |
| RNF-09 | Compatibilidad | La aplicación deberá funcionar en las versiones recientes de navegadores como Chrome, Firefox y Edge. |
| RNF-10 | Confiabilidad | El sistema deberá manejar errores de conexión y consultas fallidas sin provocar la pérdida de información almacenada. |

Los tiempos establecidos en RNF-01 y RNF-02 representan objetivos iniciales que deberán comprobarse mediante pruebas de rendimiento.

## 5. Integración del FrontEnd y BackEnd

GraphU utilizará una arquitectura web cliente-servidor que separará la interfaz, la lógica de negocio y el almacenamiento de información.

### 5.1. FrontEnd

El FrontEnd se desarrollará utilizando **Next.js con React y TypeScript**.

| Tecnología | Función |
|---|---|
| Next.js | Estructura, rutas y páginas de la aplicación |
| React | Construcción de componentes interactivos |
| TypeScript | Tipado estático |
| Zustand | Administración del estado de la interfaz |
| TanStack Query | Consultas, caché y sincronización con el servidor |
| Tailwind CSS | Diseño visual y estilos responsivos |
| shadcn/ui | Componentes reutilizables de interfaz |
| react-vis-graph-wrapper | Visualización interactiva de grafos musicales |

### 5.2. Servicios de servidor (D1-C)

**Next.js + Prisma** administrará la base de la aplicación:

- Integración de Clerk, sesión, webhook y sincronización de perfiles.
- Autorización y CRUD de usuarios, preferencias, favoritos y playlists.
- Registro de solicitudes, semillas, resultados, eventos, feedback y evaluaciones.
- Modelos y migraciones de la aplicación, con Prisma como único responsable de esas migraciones.

**Python + FastAPI** implementará la API del catálogo y el motor musical:

- Búsqueda y consulta de MusicBrainz con acceso de solo lectura.
- Extracción de relaciones y subgrafos.
- Preprocesamiento y ejecución de algoritmos de recomendación.
- Integración posterior de ListenBrainz y combinación ponderada de señales.
- Cálculo de métricas a partir de los datos necesarios suministrados por Next.js.

Se utilizarán scikit-learn, NetworkX y NumPy. FastAPI no administrará el CRUD ni las migraciones de la base de la aplicación.

### 5.3. Comunicación entre componentes

La comunicación entre el FrontEnd y el BackEnd se realizará mediante solicitudes HTTP a una API REST, utilizando principalmente JSON como formato de intercambio de información.

Para recomendaciones personalizadas, Next.js autenticará al usuario, resolverá sus semillas y favoritos con Prisma y enviará a FastAPI los identificadores y parámetros necesarios. FastAPI devolverá candidatos ordenados, puntuaciones y explicaciones; Next.js persistirá los resultados y sus interacciones.

Las credenciales de PostgreSQL permanecerán en los servidores: Next.js accederá a la base de la aplicación y FastAPI al catálogo. Las operaciones privadas requerirán autorización y la comunicación entre servicios deberá estar autenticada, sin confiar en identificadores de usuario suministrados por el navegador.

## 6. Manejo de la base de datos

Se utilizará **PostgreSQL** como sistema gestor de bases de datos relacional.

Se mantendrán **dos instancias separadas** (D2):

- Base `graphu` de la aplicación (puerto local `5431`), administrada por Next.js + Prisma; el modelo objetivo se organiza en el esquema `app`.
- Base `musicbrainz` del catálogo importado (puerto local `5433`), consultada por FastAPI en solo lectura.

Las referencias musicales usarán los UUID públicos de MusicBrainz (`gid`), sin joins ni claves foráneas entre servidores. Favoritos y pistas de playlists conservarán una caché mínima de título y artista para mostrar la biblioteca cuando el catálogo no esté disponible; esta caché no sustituye al identificador musical.

El modelo objetivo de `app` comprende **13 tablas**, distribuidas en cuatro módulos. Esto describe el diseño previsto, no tablas ya implementadas. Las migraciones deberán preservar los usuarios existentes y la sincronización con Clerk.

### 6.1. Módulo de usuarios

| Tabla | Descripción |
|---|---|
| `users` | Almacena las cuentas de usuario. |
| `user_preferences` | Almacena las preferencias individuales. |

### 6.2. Módulo de biblioteca personal

| Tabla | Descripción |
|---|---|
| `user_favorite_recording` | Canciones favoritas de cada usuario. |
| `user_favorite_artist` | Artistas favoritos de cada usuario. |
| `playlist` | Playlists creadas por los usuarios. |
| `playlist_track` | Canciones que pertenecen a cada playlist. |

### 6.3. Módulo de recomendaciones

| Tabla | Descripción |
|---|---|
| `recommendation_model` | Algoritmos y versiones disponibles. |
| `recommendation_request` | Solicitudes de recomendaciones. |
| `recommendation_seed` | Canciones semilla utilizadas. |
| `recommendation_result` | Resultados de las recomendaciones. |

### 6.4. Módulo de evaluación

| Tabla | Descripción |
|---|---|
| `recommendation_event` | Eventos relacionados con recomendaciones. |
| `user_feedback` | Opiniones e interacciones de los usuarios. |
| `recommendation_evaluation` | Métricas de evaluación de los algoritmos. |

### 6.5. Operaciones CRUD

La aplicación permitirá realizar operaciones de creación, lectura, actualización y eliminación sobre las entidades administrables.

**Create:**
- Registrar usuarios.
- Crear playlists.
- Agregar canciones y artistas favoritos.
- Agregar canciones a playlists.

**Read:**
- Consultar usuarios y preferencias.
- Buscar información musical.
- Consultar favoritos y playlists.
- Consultar recomendaciones.

**Update:**
- Modificar información del perfil.
- Actualizar preferencias.
- Modificar playlists.
- Reorganizar canciones dentro de playlists.

**Delete:**
- Eliminar cuentas de usuario.
- Eliminar playlists.
- Quitar canciones de playlists.
- Eliminar canciones y artistas favoritos.

Las tablas propias de GraphU se relacionarán con MusicBrainz mediante identificadores musicales, evitando la duplicación innecesaria de información.

## 7. Tecnologías propuestas

| Capa | Tecnologías |
|---|---|
| FrontEnd | Next.js, React, TypeScript |
| Estado de interfaz | Zustand |
| Datos del servidor | TanStack Query |
| Diseño visual | Tailwind CSS, shadcn/ui |
| Visualización de grafos | react-vis-graph-wrapper |
| Servicios de aplicación | Next.js, Prisma, Clerk |
| Servicio musical | Python, FastAPI |
| Algoritmos | scikit-learn, NetworkX, NumPy |
| Base de datos | PostgreSQL, MusicBrainz |
| Escuchas y señal colaborativa | ListenBrainz (etapa posterior) |

## 8. Alcance y etapas de desarrollo

El desarrollo será incremental: primero tags, después grafo y luego escuchas de ListenBrainz para construir una combinación ponderada. Se define desde ahora el modelo completo de 13 tablas; el plan de ejecución inmediato cubre **Etapas 1 y 2** (D4). Las etapas posteriores permanecen en la hoja de ruta.

### Etapa 1. Funcionalidades principales y tags (D3)

- Registro y gestión de usuarios.
- Búsqueda de información musical.
- Gestión de favoritos.
- Creación y administración de playlists.
- Implementación de operaciones CRUD.
- Recomendaciones mediante tags, TF-IDF y similitud coseno.
- Búsqueda sobre todo el catálogo importado, tenga o no etiquetas, con índices de texto como `pg_trgm` y medición de rendimiento.
- Medición de cobertura de etiquetas y géneros antes de construir el recomendador.
- Preparación fuera de las peticiones de una matriz dispersa TF-IDF sobre grabaciones con etiquetas útiles; versionado y actualización del modelo cuando cambien los datos utilizados.
- Si una semilla carece de información suficiente, comunicar la limitación sin inventar similitud. La herencia de etiquetas de artista o álbum es una alternativa pendiente de validar con la cobertura real.

Una grabación sin tags seguirá siendo buscable y podrá guardarse. Su ausencia del modelo inicial no la excluye de los futuros recomendadores por grafo o escuchas. Precalcular no garantiza RNF-02 sin mediciones.

### Etapa 2. Grafos

- Visualización de relaciones musicales mediante react-vis-graph-wrapper.
- Implementación de Personalized PageRank con NetworkX.
- Generación de recomendaciones basadas en relaciones musicales.
- Extracción de vecindarios acotados para controlar tiempos y tamaño del grafo.
- Explicaciones basadas en conexiones observadas y conservación de la puntuación y procedencia de cada señal.

### Etapa 3. Escuchas de ListenBrainz y recomendador híbrido

- Comprobar disponibilidad, cobertura y correspondencia de las escuchas con identificadores MusicBrainz.
- Incorporar patrones de escucha como señal colaborativa, sin exigir que todos los usuarios tengan cuenta o historial en ListenBrainz.
- Reunir candidatos de tags, grafo y escuchas; una canción no necesitará aparecer en los tres algoritmos para ser candidata.
- Normalizar las puntuaciones a una escala comparable antes de combinarlas.
- Calcular `score = w_tags × s_tags + w_grafo × s_grafo + w_escuchas × s_escuchas`.
- Utilizar pesos no negativos cuya suma sea 1 para la combinación completa. Los valores finales se determinarán mediante evaluación; no quedan fijados porcentajes en este documento.
- Distinguir una señal ausente de una afinidad baja. Definir y evaluar la política para señales faltantes, incluida la posible renormalización de pesos, antes de activar el híbrido.
- Registrar versión, pesos, disponibilidad y contribución de cada señal para reproducir y explicar resultados.
- Incorporación de estrategias para diversificar recomendaciones.

### Etapa 4. Evaluación

- Análisis de interacciones registradas desde las primeras recomendaciones.
- Análisis de favoritos y rechazos.
- Implementación de métricas de calidad, cobertura y diversidad con un protocolo documentado.
- Comparación de algoritmos individuales y combinaciones de pesos.
- Medición de rendimiento bajo condiciones y volúmenes de datos definidos.

### Exclusiones

Queda fuera de alcance el procesamiento de audio y la similitud acústica. No se contempla integrar Essentia, AcousticBrainz ni almacenar embeddings de audio con pgvector.

## 9. Conclusión

GraphU será una aplicación web orientada a la exploración, visualización y recomendación musical.

El proyecto integrará tecnologías modernas de desarrollo FrontEnd y BackEnd con una base de datos relacional, operaciones CRUD y algoritmos de recomendación.

La utilización de MusicBrainz permitirá trabajar con información musical real, mientras que las tablas propias de la aplicación facilitarán la gestión de usuarios, favoritos, playlists y recomendaciones personalizadas.

Su arquitectura modular permitirá incorporar progresivamente nuevos algoritmos, funcionalidades y mecanismos de evaluación.
