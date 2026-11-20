# Caché persistente de portadas

Las imágenes servidas por `/api/music/cover` se guardan en PostgreSQL (`app.cover_image_cache`), usando la misma `DATABASE_URL` que la aplicación. La configuración local de Compose ya conserva PostgreSQL en un volumen; en producción, las instancias deben conectarse a la misma base persistente. No se necesitan carpetas locales, credenciales de otro proveedor ni dependencias adicionales.

## Activación y despliegue

```sh
npm run db:generate
npm run db:deploy
```

Reinicia el proceso de Next.js si estaba ejecutándose para que cargue el cliente Prisma actualizado. En producción aplica las migraciones durante la publicación y compila con `npm run build`, como indica el README.

## Comportamiento

- La primera petición descarga y guarda la imagen. Las siguientes leen los mismos bytes desde PostgreSQL durante 30 días, incluso tras reiniciar Next.js.
- La clave es la URL de Cover Art Archive, por lo que canciones y artistas que resuelven a esa misma URL comparten la imagen. Las descargas simultáneas de esa URL también se agrupan dentro de cada proceso; dos instancias pueden descargarla a la vez en el primer acceso, pero el `upsert` conserva una sola fila.
- Al vencer los 30 días, la siguiente petición vuelve a descargar y reemplaza la imagen. La caducidad se mide desde la descarga; consultar o actualizar los metadatos no la prolonga.
- Solo se guardan respuestas de imagen válidas, no vacías y de hasta 5 MiB. No se guardan errores ni el SVG de sustitución en la tabla de imágenes.
- Si falta la base, la migración o falla la persistencia, el proxy sigue intentando servir la imagen desde el proveedor. En ese caso no hay garantía de reutilización persistente.
- Se conserva la caché HTTP del navegador de 24 horas. Una portada que todavía no se ha descargado sigue dependiendo del tiempo de respuesta del proveedor.

`app.cover_cache` conserva por separado los metadatos y las respuestas negativas. Mantener los binarios en otra tabla evita cargarlos en las consultas de favoritos y playlists.

## Comprobación

Solicita dos veces la misma URL de `/api/music/cover` con un cliente HTTP que no tenga caché local, como `curl.exe`. Usa una URL real tomada de la aplicación. La cabecera `X-Cover-Image-Cache` vale `MISS` cuando hubo descarga y `HIT` cuando se leyeron los bytes persistidos. `X-Cover-Cache` sigue describiendo únicamente los metadatos; puede valer `HIT` aunque la imagen sea `MISS`.

```sh
npm test -- tests/music-cover-route.test.ts
```

La prueba `tests/cover-image-cache.integration.test.ts` necesita `TEST_DATABASE_URL` apuntando a una base exclusiva de pruebas con las migraciones aplicadas. Comprueba la fila real, cierra la conexión, limpia las referencias en memoria y verifica que una segunda petición devuelve los mismos bytes sin volver a consultar al proveedor. Solo elimina sus propias filas de prueba.

## Espacio y mantenimiento

El almacenamiento crece con las URLs distintas solicitadas, hasta 5 MiB por imagen; se intenta primero la miniatura de 250 píxeles. La caducidad impide reutilizar imágenes antiguas, pero no elimina automáticamente las filas que dejan de usarse. Para recuperar espacio lógico, el operador puede programar esta limpieza de entradas vencidas según la capacidad y uso del despliegue:

```sql
DELETE FROM app.cover_image_cache
WHERE "fetchedAt" < NOW() - INTERVAL '30 days';
```

Es una caché regenerable: las siguientes peticiones vuelven a descargar las imágenes eliminadas. El índice de `fetchedAt` ayuda a la limpieza. Si el volumen del catálogo crece lo suficiente para que los binarios dominen la base y sus respaldos, conviene mover esta capa a almacenamiento de objetos con CDN.
