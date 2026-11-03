# GraphU — Plan técnico y propuestas actualizadas

Fecha: 2 de noviembre de 2026.

Este documento recoge la arquitectura acordada, el alcance por etapas y el desglose propuesto de implementación. Complementa [REQUIEREMENTS.md](REQUIEREMENTS.md). Registrar el plan no significa que sus funcionalidades estén implementadas ni que sus objetivos de rendimiento estén verificados. Los tickets permanecen pendientes de ejecución.

## 1. Objetivo y alcance

Construir una aplicación de exploración musical y recomendaciones explicables sobre MusicBrainz. Implementar primero recomendaciones por etiquetas, luego por relaciones del grafo y después por patrones de escucha de ListenBrainz. Finalmente, combinar las señales con pesos evaluados y configurables.

El alcance inmediato comprende las etapas 1 y 2 y el modelo objetivo completo de 13 tablas. ListenBrainz, el híbrido y la evaluación comparativa completa forman parte de la hoja de ruta posterior. La captura de interacciones comienza desde el primer recomendador.

Quedan excluidos el procesamiento de audio, la similitud acústica, Essentia, AcousticBrainz y los embeddings de audio con pgvector. Los tickets actuales no incluyen despliegue ni monitoreo de producción.

## 2. Decisiones acordadas

| Decisión | Acuerdo | Motivo y consecuencia |
|---|---|---|
| D1-C | Next.js + Prisma administra la base de aplicación y su CRUD; FastAPI administra el acceso al catálogo y los algoritmos. | Conserva la sincronización con Clerk y evita duplicar el CRUD en Python. Next.js mantiene responsabilidades de servidor, además de la interfaz. |
| D2 | Mantener dos instancias PostgreSQL separadas. | Las migraciones de la aplicación quedan separadas del catálogo importado. Referencias por UUID MusicBrainz, sin joins ni claves foráneas entre instancias. |
| D3 | Buscar sobre todo el catálogo; preparar TF-IDF sobre grabaciones con tags útiles. | La falta de tags limita solo esa estrategia, no la búsqueda ni los recomendadores posteriores. Se debe medir cobertura antes de construir el modelo. |
| D4 | Diseñar las 13 tablas y ejecutar inicialmente etapas 1 y 2. | Permite incorporar nuevas estrategias sin implementar por adelantado ListenBrainz o el híbrido. |

Las alternativas D1-A (Prisma para migraciones y FastAPI para CRUD) y D1-B (eliminar Prisma y trasladar todo a Python) no son la dirección elegida. Los porcentajes ilustrativos discutidos para el híbrido no son requisitos aprobados.

## 3. Punto de partida

Durante la planificación se verificaron estos componentes existentes:

- `prisma/schema.prisma`: modelo `User`; todavía no representa el modelo objetivo completo.
- `lib/users/sync.ts`: sincronización Clerk con protección ante eventos duplicados, antiguos y posteriores a eliminación.
- `lib/musicbrainz.ts`: búsqueda directa desde Next.js mediante una conexión de solo lectura; deberá trasladarse a FastAPI.
- `compose.yaml`: PostgreSQL de aplicación en el puerto local 5431.

Esta es una referencia del estado revisado al planificar. Antes de implementar, verificar el estado actual de los archivos y sus pruebas. No se ha medido todavía la cobertura real de tags, relaciones ni escuchas.

## 4. Arquitectura y responsabilidades

### 4.1. Interfaz y servidor de aplicación

Next.js, React y TypeScript ofrecen búsqueda, fichas musicales, biblioteca, recomendaciones y exploración de grafos. Zustand gestiona estado interactivo; TanStack Query gestiona consultas, caché y mutaciones. Se conserva el sistema visual existente con Tailwind CSS y componentes shadcn/ui.

El servidor Next.js es responsable de:

- Sesión, integración de Clerk, webhook y sincronización de perfiles.
- Autorización por propietario y CRUD de usuarios, preferencias, favoritos y playlists.
- Resolución de semillas y favoritos antes de invocar el servicio musical.
- Persistencia de solicitudes, resultados, eventos, feedback y evaluaciones.
- Modelos y migraciones de la base de aplicación mediante Prisma.

Clerk gestiona credenciales. GraphU no almacena contraseñas. Las operaciones no deben confiar en el identificador de usuario enviado por el navegador.

### 4.2. Servicio musical

Python + FastAPI expone contratos HTTP/JSON para búsqueda, detalle, subgrafos y recomendaciones. Usa scikit-learn y NumPy para TF-IDF/coseno y NetworkX para Personalized PageRank.

FastAPI consulta MusicBrainz en solo lectura, prepara modelos y calcula rankings y explicaciones. Posteriormente integra ListenBrainz y calcula métricas a partir de los datos necesarios suministrados por Next.js. No administra el CRUD ni las migraciones de la aplicación.

La creación de índices sobre el catálogo requiere un procedimiento administrativo separado; el usuario de ejecución del servicio conserva permisos de lectura.

### 4.3. Flujo de recomendación

1. El usuario selecciona semillas o solicita recomendaciones desde sus favoritos.
2. Next.js autentica, autoriza y obtiene preferencias e identificadores mediante Prisma.
3. Next.js registra la solicitud y sus semillas, con identificador y política de idempotencia.
4. Next.js invoca FastAPI por un canal autenticado con identificadores y parámetros validados.
5. FastAPI devuelve candidatos ordenados, puntuaciones, versión, disponibilidad de señales y explicaciones.
6. Next.js persiste los resultados y los presenta al usuario.
7. Guardados, impresiones reales y feedback se asocian a resultados persistidos y autorizados.

Las credenciales PostgreSQL permanecen en sus servidores. La biblioteca ya guardada debe seguir siendo consultable cuando el catálogo no esté disponible.

## 5. Datos y migraciones

### 5.1. Topología

- Instancia de aplicación: base `graphu`, puerto local 5431; esquema objetivo `app`, administrado por Prisma.
- Instancia de catálogo: base `musicbrainz`, puerto local 5433; catálogo importado consultado por FastAPI.

Usar UUID públicos `gid` de MusicBrainz como referencias musicales. No crear claves foráneas remotas ni depender de joins entre servidores. Guardar una caché mínima de título y artista en favoritos y pistas de playlist para consultar la biblioteca sin una consulta al catálogo por fila.

### 5.2. Modelo objetivo completo

| Módulo | Tabla | Responsabilidad |
|---|---|---|
| Usuarios | `users` | Identidad interna vinculada a Clerk y datos necesarios del perfil. |
| Usuarios | `user_preferences` | Preferencias musicales y de recomendación. |
| Biblioteca | `user_favorite_recording` | Grabaciones favoritas por usuario. |
| Biblioteca | `user_favorite_artist` | Artistas favoritos por usuario. |
| Biblioteca | `playlist` | Propietario, nombre y descripción. |
| Biblioteca | `playlist_track` | Pistas, caché mínima y orden dentro de la playlist. |
| Recomendaciones | `recommendation_model` | Estrategia, versión y parámetros del modelo. |
| Recomendaciones | `recommendation_request` | Solicitud, propietario, estado y datos de reproducibilidad. |
| Recomendaciones | `recommendation_seed` | Semillas efectivamente utilizadas. |
| Recomendaciones | `recommendation_result` | Candidato, posición, puntuación y explicación. |
| Evaluación | `recommendation_event` | Impresiones y acciones asociadas a resultados. |
| Evaluación | `user_feedback` | Gusto o desinterés expresado por el usuario. |
| Evaluación | `recommendation_evaluation` | Métricas por modelo y protocolo de evaluación. |

La implementación concretará columnas, índices y restricciones. Las migraciones preservarán los usuarios existentes y actualizarán conjuntamente cualquier SQL de sincronización si cambia el nombre o esquema de `User`.

Definir restricciones para favoritos duplicados, integridad interna, propietarios y posiciones. El reordenamiento de playlists será transaccional. La política de pistas repetidas, conflictos concurrentes y eliminación de datos personales se concretará en los tickets correspondientes.

## 6. Etapa 1 — Núcleo y recomendación por tags

### 6.1. Producto y catálogo

Completar cuenta y preferencias, búsqueda de canciones/artistas/álbumes, fichas, favoritos y playlists. Mantener autorización por usuario, estados de carga/vacío/error y navegación accesible. Conservar el prototipo existente hasta verificar su sustitución.

Portar consultas parametrizadas a FastAPI y añadir límites, paginación estable y errores controlados. Definir la representación de álbumes (`release` frente a `release-group`) al concretar el contrato. Medir búsquedas representativas con índices como `pg_trgm`.

### 6.2. Cobertura y preprocesamiento (D3)

Medir grabaciones totales, tags/géneros propios útiles, valores vacíos y disponibilidad de etiquetas en artistas o álbumes. Registrar fecha, consultas y versión del catálogo utilizado.

Construir fuera de las peticiones una matriz dispersa TF-IDF, vocabulario, mapa de filas a UUID y metadatos de versión. Publicar estos archivos como un conjunto consistente y atómico; una reconstrucción fallida no debe reemplazar una versión válida por datos incompletos.

La herencia de etiquetas de artista o álbum es una alternativa pendiente de validar, no un requisito aprobado. Si la cobertura hace inviable el recomendador inicial, presentar evidencia antes de cambiar el enfoque.

Las grabaciones sin tags siguen disponibles en búsqueda y biblioteca. Ante semillas sin información suficiente, devolver un estado explícito sin inventar similitud.

### 6.3. Ranking y experiencia de recomendación

Calcular similitud coseno sobre los vectores y devolver candidatos con etiquetas compartidas como explicación. Definir agregación de varias semillas, tratamiento de favoritos de artistas, exclusión de semillas y eliminación de duplicados. Registrar versiones y parámetros para reproducir el ranking.

Permitir guardar resultados en favoritos o playlists e indicar gusto/desinterés. Registrar impresiones cuando el resultado se presenta, no solo cuando se genera. La captura comienza en esta etapa, aunque la evaluación comparativa completa sea posterior.

## 7. Etapa 2 — Grafo y recomendaciones por relaciones

Definir tipos de entidad y relación disponibles, dirección y pesos de aristas en una configuración versionada. Extraer vecindarios limitados por profundidad, nodos y aristas para controlar coste y tamaño.

Ejecutar Personalized PageRank desde las semillas con NetworkX. Documentar personalización, convergencia, selección de candidatos y comportamiento de nodos aislados. Integrar esta estrategia en el mismo contrato y ciclo de persistencia del recomendador por tags.

Una grabación sin tags puede participar cuando tenga relaciones útiles. Devolver conexiones observadas y declarar truncamiento; un camino ilustrativo no equivale a una descomposición exacta de PageRank.

Integrar `react-vis-graph-wrapper` / `vis-network` en un componente cliente con limpieza de eventos y recursos. Permitir selección y expansión controlada de nodos, consulta de fichas y uso como semillas. Evitar duplicados y respuestas obsoletas al cambiar de selección. Ofrecer una alternativa textual navegable para las conexiones relevantes.

Los pesos de aristas del grafo son distintos de los pesos futuros entre algoritmos.

## 8. Etapa 3 — ListenBrainz y combinación ponderada

Verificar disponibilidad y cobertura de escuchas y su correspondencia con UUID MusicBrainz. Incorporar patrones de escucha como señal colaborativa sin exigir historial o cuenta ListenBrainz a todos los usuarios.

Reunir candidatos aportados por tags, grafo y escuchas. No exigir que una canción aparezca en los tres algoritmos. Normalizar sus puntuaciones a una escala comparable antes de calcular:

`score = w_tags × s_tags + w_grafo × s_grafo + w_escuchas × s_escuchas`

Los pesos serán no negativos y sumarán 1 cuando se combine el conjunto completo de señales. No se fijan porcentajes definitivos: deberán elegirse y compararse mediante evaluación.

Distinguir una señal ausente de una afinidad baja. Evaluar la política para señales faltantes, incluida la posible renormalización, antes de activar el híbrido. Esa política aún no está decidida.

Registrar pesos, versiones, disponibilidad y contribución de cada señal para explicar y reproducir resultados. Incorporar diversificación de recomendaciones como parte de esta etapa.

## 9. Etapa 4 — Evaluación

Analizar interacciones, favoritos y rechazos. Definir un protocolo reproducible para comparar algoritmos individuales y combinaciones de pesos en calidad, cobertura y diversidad; concretar métricas como Precision@K cuando se establezcan datos y metodología adecuados.

Medir también latencia bajo volumen, hardware, carga y caché documentados. No confundir la validación integrada de las etapas 1 y 2 con la implementación de esta etapa completa.

## 10. Contratos y fallos

| Situación | Comportamiento previsto |
|---|---|
| Entrada al motor | Identificador de solicitud, UUID de semillas, estrategia, límite y parámetros validados. |
| Salida del motor | Versión, UUID de candidatos, posición, puntuación, explicación y disponibilidad de señales. |
| Semilla sin tags | Información insuficiente explícita; sin similitud inventada ni exclusión permanente de otros algoritmos. |
| Motor no disponible | Solicitud fallida identificable y reintento idempotente; no guardar resultados ficticios. |
| Persistencia fallida | No mostrar éxito de guardado ni aceptar feedback sobre resultados inexistentes. |
| Catálogo no disponible | Búsquedas/recomendaciones informan el problema; biblioteca guardada permanece consultable. |
| Grafo aislado o truncado | Explicar ausencia de relaciones o límites aplicados. |
| Petición de otro usuario | Rechazar acceso aunque se manipulen identificadores. |
| Respuesta tardía de interfaz | No reemplazar la selección actual por datos obsoletos. |

## 11. Validación y pendientes

- Probar migraciones tanto en base nueva como sobre usuarios existentes.
- Preservar sincronización Clerk ante duplicados, eventos fuera de orden y eliminaciones.
- Verificar aislamiento de usuarios, idempotencia y transacciones de playlists.
- Comprobar ranking reproducible con fixtures controladas y separar esas pruebas de la evidencia del catálogo real.
- Medir búsqueda menor de 3 segundos y recomendaciones iniciales menores de 5 segundos. Son objetivos RNF-01/RNF-02, no garantías derivadas del preprocesamiento.
- Probar semillas múltiples, sin datos, grafos densos/aislados y fallos de red/persistencia.
- Verificar los recorridos reales de interfaz con teclado y en tamaños móvil/escritorio.

Pendientes de concreción durante los tickets: reglas de pistas repetidas y eliminación, contrato de álbumes, cobertura y limpieza de tags, agregación de semillas, relaciones y pesos del grafo. Para etapas futuras: fuente concreta de escuchas, normalización, pesos del híbrido y política de señales faltantes. Cambios que alteren la arquitectura o el alcance requieren volver a discutirlos con evidencia.

## 12. Tickets de implementación de etapas 1 y 2

Cada ticket enlazado contiene resultado esperado, alcance, exclusiones, dependencias y aceptación verificable. Son propuestas pendientes de ejecución; no representan funcionalidades terminadas.

| Ticket | Etapa | Dependencias directas |
|---|---|---|
| [T01 — Modelo y migraciones](docs/plan-tecnico/tickets/T01.md) | 1 | Ninguna |
| [T02 — Servicio musical y búsqueda](docs/plan-tecnico/tickets/T02.md) | 1 | Ninguna |
| [T03 — Perfil, preferencias y favoritos](docs/plan-tecnico/tickets/T03.md) | 1 | T01, T02 |
| [T04 — Playlists y reordenamiento](docs/plan-tecnico/tickets/T04.md) | 1 | T01, T02 |
| [T05 — Cobertura y preparación TF-IDF](docs/plan-tecnico/tickets/T05.md) | 1 | T02 |
| [T06 — Recomendaciones y feedback](docs/plan-tecnico/tickets/T06.md) | 1 | T01, T03, T04, T05 |
| [T07 — Subgrafos y PageRank](docs/plan-tecnico/tickets/T07.md) | 2 | T02, T06 |
| [T08 — Explorador visual](docs/plan-tecnico/tickets/T08.md) | 2 | T07 |
| [T09 — Validación integrada](docs/plan-tecnico/tickets/T09.md) | 2 | T03, T04, T06, T08 |

Orden de trabajo: iniciar T01/T02; después T03/T04/T05 según sus dependencias; continuar T06, T07, T08 y T09. Esto describe dependencias, no autoriza por sí solo ejecutar ni delegar tickets.

Cada entrega debe dejar el repositorio funcionando, mantener el flujo anterior hasta verificar su reemplazo e incluir sus propias comprobaciones. T09 integra esas comprobaciones, no las sustituye.

Antes de explorar código, seguir las reglas de graphify de AGENTS.md cuando exista su grafo. Antes de escribir código Next.js, leer las guías locales de la versión instalada. Actualizar graphify después de cambios de código y respetar las instrucciones de feedback aplicables.
