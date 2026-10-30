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
| RF-24 | En etapas posteriores, el sistema incorporará recomendaciones basadas en grafos, filtrado colaborativo y características acústicas. |

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
| RNF-04 | Seguridad | Las contraseñas deberán almacenarse mediante algoritmos de hashing seguros, nunca en texto plano. |
| RNF-05 | Seguridad | Las operaciones sobre información privada deberán requerir autenticación y autorización. |
| RNF-06 | Integridad | La base de datos deberá utilizar claves primarias, foráneas y restricciones para mantener la consistencia de la información. |
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

### 5.2. BackEnd

Se utilizará **Python con FastAPI** para implementar una API REST.

El BackEnd será responsable de:

- Autenticación y gestión de usuarios.
- Implementación de operaciones CRUD.
- Consultas a la base de datos MusicBrainz.
- Administración de favoritos y playlists.
- Ejecución de algoritmos de recomendación.
- Registro de solicitudes, resultados e interacciones.

Para el procesamiento de recomendaciones se utilizarán bibliotecas como scikit-learn, NetworkX y NumPy.

### 5.3. Comunicación entre componentes

La comunicación entre el FrontEnd y el BackEnd se realizará mediante solicitudes HTTP a una API REST, utilizando principalmente JSON como formato de intercambio de información.

El BackEnd será responsable de acceder a PostgreSQL, evitando exponer las credenciales de la base de datos al navegador.

## 6. Manejo de la base de datos

Se utilizará **PostgreSQL** como sistema gestor de bases de datos relacional.

La base de datos estará organizada en dos esquemas principales:

- `musicbrainz`: contendrá el catálogo musical importado desde MusicBrainz.
- `app`: almacenará la información propia de la aplicación.

El esquema `app` contará inicialmente con **13 tablas**, distribuidas en cuatro módulos.

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
| BackEnd | Python, FastAPI |
| Algoritmos | scikit-learn, NetworkX, NumPy |
| Base de datos | PostgreSQL, MusicBrainz |
| Integraciones futuras | ListenBrainz, Essentia, pgvector |

## 8. Alcance y etapas de desarrollo

### Etapa 1. Funcionalidades principales

- Registro y gestión de usuarios.
- Búsqueda de información musical.
- Gestión de favoritos.
- Creación y administración de playlists.
- Implementación de operaciones CRUD.
- Recomendaciones mediante tags, TF-IDF y similitud coseno.

### Etapa 2. Grafos

- Visualización de relaciones musicales mediante react-vis-graph-wrapper.
- Implementación de Personalized PageRank con NetworkX.
- Generación de recomendaciones basadas en relaciones musicales.

### Etapa 3. Recomendador híbrido

- Integración de ListenBrainz.
- Combinación de distintos algoritmos.
- Incorporación de estrategias para diversificar recomendaciones.

### Etapa 4. Similitud acústica

- Integración de características acústicas disponibles.
- Análisis musical mediante Essentia.
- Almacenamiento y consulta de embeddings con pgvector.

### Etapa 5. Evaluación

- Registro de interacciones de los usuarios.
- Análisis de favoritos y rechazos.
- Implementación de métricas de evaluación.
- Comparación de algoritmos y mejoras progresivas.

## 9. Conclusión

GraphU será una aplicación web orientada a la exploración, visualización y recomendación musical.

El proyecto integrará tecnologías modernas de desarrollo FrontEnd y BackEnd con una base de datos relacional, operaciones CRUD y algoritmos de recomendación.

La utilización de MusicBrainz permitirá trabajar con información musical real, mientras que las tablas propias de la aplicación facilitarán la gestión de usuarios, favoritos, playlists y recomendaciones personalizadas.

Su arquitectura modular permitirá incorporar progresivamente nuevos algoritmos, funcionalidades y mecanismos de evaluación.