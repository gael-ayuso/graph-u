# Actualizar el catálogo local de MusicBrainz

Esta guía corresponde a la instalación migrada a **Docker Desktop**, comprobada el **12 de noviembre de 2026**. Todos los comandos se ejecutan en **PowerShell de Windows**. Su publicación no ejecuta actualizaciones ni activa tareas automáticas.

Actualizar el catálogo consiste en aplicar paquetes de **replicación incremental** de MetaBrainz. Actualizar las imágenes de Docker, PostgreSQL o el software de MusicBrainz es un mantenimiento diferente.

## Antes de desarrollar con MusicBrainz local

**Para desarrollar funcionalidades que consulten el catálogo local, primero debes instalar la base de MusicBrainz e importar sus datos.** Tener Docker instalado o un contenedor PostgreSQL vacío no proporciona las canciones, artistas ni álbumes del catálogo.

Prepara el entorno en este orden:

1. Instala Docker Desktop y habilita el uso de contenedores Linux.
2. Prepara la base propia de GraphU siguiendo [DATABASE_LOCAL.md](DATABASE_LOCAL.md), configura `DATABASE_URL` y aplica sus migraciones.
3. Instala el espejo de MusicBrainz siguiendo [las instrucciones oficiales de instalación](https://github.com/metabrainz/musicbrainz-docker#installation). Para un catálogo sin sitio ni API web, utiliza el perfil `alt-db-only-mirror` indicado allí e importa los datos en esa instalación. Reserva espacio para el catálogo, las descargas y los respaldos.
4. Comprueba que tu base contiene datos en `musicbrainz.recording` y `musicbrainz.artist`, y configura la conexión del componente de la aplicación que vaya a consultarla.
5. Cuando el catálogo esté importado y disponible, utiliza esta guía para mantenerlo actualizado mediante replicación.

La instalación inicial y la importación se hacen al preparar el entorno; no deben repetirse para encender o actualizar una base existente. Las migraciones de Prisma crean las tablas de GraphU, pero no importan el catálogo de MusicBrainz.

Cada equipo necesita su propia configuración y credenciales. El archivo de Compose y las rutas de esta guía pertenecen al equipo migrado; no se crean al clonar este repositorio. Si tu desarrollo usa la API pública de MusicBrainz, la copia local del catálogo es opcional.

## 1. Identificar la instalación

| Elemento | Valor de esta instalación |
| --- | --- |
| Contexto de Docker | `desktop-linux` |
| Grupo de Compose | `musicbrainz-local` |
| Archivo de Compose | `%LOCALAPPDATA%\GraphU\musicbrainz-desktop\compose.json` |
| Perfil | PostgreSQL y servicio de replicación, sin sitio ni API web de MusicBrainz |
| PostgreSQL | Versión principal 18 |
| Base y esquema del catálogo | `musicbrainz_db` / `musicbrainz` |
| Usuario administrativo | `musicbrainz` |
| Conexión desde Windows | `127.0.0.1:5434` |
| Volúmenes de Desktop | `musicbrainz-local_pgdata` y `musicbrainz-local_dbdump` |

La base de GraphU en `127.0.0.1:5431` se administra por separado: consulta [DATABASE_LOCAL.md](DATABASE_LOCAL.md). Los comandos de esta guía actúan sobre el catálogo de MusicBrainz.

El catálogo original de Ubuntu se conserva como copia independiente y detenida. Los cambios posteriores de Desktop no se sincronizan hacia esa copia. El grupo antiguo y vacío `musicbrainz-docker` de Desktop fue eliminado; sus volúmenes se conservaron.

Define estas variables al abrir la terminal:

```powershell
$mbRoot = Join-Path $env:LOCALAPPDATA 'GraphU\musicbrainz-desktop'
$mbCompose = Join-Path $mbRoot 'compose.json'
if (-not (Test-Path -LiteralPath $mbCompose)) {
    throw "No se encontró la configuración local: $mbCompose"
}
```

Estas rutas son específicas del equipo migrado. Clonar GraphU en otro equipo no instala este catálogo ni proporciona sus credenciales.

## 2. Estado comprobado y requisitos

El 12 de noviembre de 2026 se comprobó:

- Esquema de la base y del cargador: **31**.
- Secuencia de replicación instalada: **190043**.
- Última actualización registrada: **26 de octubre de 2026, 23:00:51 UTC**.
- Siguiente paquete disponible: **190044**, del **27 de octubre de 2026**, con esquema **31**.
- El token permite descargar ese paquete desde el contenedor de Desktop.
- Las tablas `dbmirror2.pending_data`, `pending_keys` y `pending_ts` existen; `pending_data` estaba vacía.
- **No se aplicaron paquetes ni se activó cron durante la comprobación.**

Estos valores son una referencia histórica: consulta el estado actual antes de cada actualización.

La instalación ya tiene conectado el token mediante el secreto de Compose `metabrainz_access_token`. Su archivo está en `$mbRoot\secrets\metabrainz_access_token`, montado como `/run/secrets/metabrainz_access_token` en el servicio `musicbrainz`. No publiques ese archivo ni el Compose local, que también contiene credenciales.

MetaBrainz exige un token con acceso vigente a Live Data Feed. Su [documentación de acceso](https://musicbrainz.org/doc/Live_Data_Feed) distingue uso personal/no comercial y uso comercial. No es una API key de Last.fm.

## 3. Encender y consultar el catálogo

Abre Docker Desktop y ejecuta:

```powershell
docker --context desktop-linux compose -f $mbCompose up -d --no-build
docker --context desktop-linux compose -f $mbCompose ps
docker --context desktop-linux compose -f $mbCompose exec -T db pg_isready -U musicbrainz -d musicbrainz_db
```

Espera a que aparezca `accepting connections`. Consulta el estado de replicación:

```powershell
docker --context desktop-linux compose -f $mbCompose exec -T db psql -U musicbrainz -d musicbrainz_db -x -c 'SELECT current_schema_sequence, current_replication_sequence, last_replication_date FROM musicbrainz.replication_control;'
```

Comprueba que no haya otra replicación o importación en marcha:

```powershell
docker --context desktop-linux compose -f $mbCompose top musicbrainz
```

Si aparecen procesos `LoadReplicationChanges`, `ProcessReplicationChanges`, importación o restauración, espera a que terminen. No mezcles una ejecución manual con la programada. El cargador también utiliza un bloqueo para evitar ejecuciones simultáneas.

## 4. Preparar un respaldo recuperable

Antes de aplicar paquetes, conserva un respaldo reciente del catálogo y la configuración local. Los archivos `mbdump*.tar.bz2` son la descarga original; no incluyen necesariamente los cambios posteriores. La copia de Ubuntu tampoco se mantiene actualizada automáticamente.

El catálogo ocupaba unos 60 GB. Revisa espacio tanto para respaldo como para paquetes, temporales y crecimiento de PostgreSQL. Ajusta la carpeta siguiente si el respaldo debe ir en otra unidad:

```powershell
$mbBackupDir = Join-Path $env:USERPROFILE 'Backups\MusicBrainz'
New-Item -ItemType Directory -Path $mbBackupDir -Force | Out-Null
$mbBackupFile = Join-Path $mbBackupDir ("musicbrainz_db-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
```

Con Python disponible, este ejemplo guarda un `pg_dump` de formato personalizado y comprueba su índice con `pg_restore --list`. Usa escritura binaria para evitar que PowerShell 5.1 altere el archivo al redirigir stdout con `>`:

```powershell
@'
from pathlib import Path
import subprocess
import sys

target = Path(sys.argv[1])
if target.exists():
    raise SystemExit('El respaldo de destino ya existe; elige otro nombre')
partial = target.with_suffix(target.suffix + '.partial')
docker = ['docker', '--context', 'desktop-linux']
with partial.open('xb') as stream:
    result = subprocess.run(docker + [
        'exec', 'musicbrainz-local-db-1', 'pg_dump',
        '-U', 'musicbrainz', '-d', 'musicbrainz_db', '-Fc'
    ], stdout=stream)
if result.returncode:
    raise SystemExit('Falló pg_dump; el archivo .partial no es un respaldo válido')
with partial.open('rb') as stream:
    subprocess.run(docker + [
        'exec', '-i', 'musicbrainz-local-db-1', 'pg_restore', '--list'
    ], stdin=stream, stdout=subprocess.DEVNULL, check=True)
partial.replace(target)
print('Archivo guardado e índice legible:', target)
'@ | python - $mbBackupFile
if ($LASTEXITCODE -ne 0) { throw 'No continúes: falló el respaldo o su comprobación' }
```

Comprobar el índice no sustituye una restauración de prueba. Verifica que puedas restaurar el respaldo en una base independiente antes de depender de él. `pg_dump` respalda una base; no todos los roles ni todo el clúster. Conserva también el Compose y los secretos en almacenamiento protegido.

## 5. Primera prueba: aplicar un solo paquete

Una vez preparado el respaldo, aplica un paquete y conserva el registro:

```powershell
$mbLogs = Join-Path $mbRoot 'logs'
New-Item -ItemType Directory -Path $mbLogs -Force | Out-Null
$mbLog = Join-Path $mbLogs ("replication-test-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

docker --context desktop-linux compose -f $mbCompose exec -T musicbrainz bash -c 'source /noninteractive.bash_env; exec carton exec -- ./admin/replication/LoadReplicationChanges --limit=1' 2>&1 |
    ForEach-Object { $_.ToString() -replace '([?&]token=)[^&\s]+', '$1[REDACTED]' } |
    Tee-Object -FilePath $mbLog
$mbUpdateExit = $LASTEXITCODE
if ($mbUpdateExit -ne 0) { throw "Falló la replicación. Revisa $mbLog" }
```

Se invoca directamente el cargador para conservar su código de salida. El envoltorio oficial `replication.sh` llama a `mirror.sh`, que puede registrar un fallo del cargador y terminar con código cero. Por eso los registros y el estado de la base son parte de la verificación.

Consulta nuevamente `musicbrainz.replication_control` con el comando de la sección 3. En el estado histórico de esta guía, una prueba satisfactoria debe avanzar de **190043 a 190044** y actualizar la fecha al 27 de octubre. En ejecuciones posteriores, compara los valores reales de antes y después.

Si el paquete no existe, el cargador puede terminar sin avanzar. Eso no demuestra por sí solo que la base esté al día: revisa el mensaje, la disponibilidad del paquete y las fechas.

## 6. Ponerse al día

Después de una prueba satisfactoria, repite el cargador sin `--limit=1`:

```powershell
$mbLog = Join-Path $mbLogs ("replication-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
docker --context desktop-linux compose -f $mbCompose exec -T musicbrainz bash -c 'source /noninteractive.bash_env; exec carton exec -- ./admin/replication/LoadReplicationChanges' 2>&1 |
    ForEach-Object { $_.ToString() -replace '([?&]token=)[^&\s]+', '$1[REDACTED]' } |
    Tee-Object -FilePath $mbLog
$mbUpdateExit = $LASTEXITCODE
if ($mbUpdateExit -ne 0) { throw "Falló la replicación. Revisa $mbLog" }
```

Mantén la terminal, Windows y Docker Desktop activos hasta que termine. El tiempo depende del atraso. El cargador aplica paquetes consecutivos desde la secuencia guardada; no vuelve a importar el catálogo completo.

Al finalizar:

1. Comprueba el código de salida y los mensajes finales del registro.
2. Consulta la secuencia y fecha en `musicbrainz.replication_control`.
3. Comprueba datos consultables, por ejemplo:

   ```powershell
   docker --context desktop-linux compose -f $mbCompose exec -T db psql -U musicbrainz -d musicbrainz_db -c 'SELECT gid, name FROM musicbrainz.recording LIMIT 5;'
   ```

4. Prueba la búsqueda desde la aplicación que use este catálogo y anota fecha, secuencia final y resultado.

## 7. Actualización automática opcional

Actívala después de comprobar una replicación manual satisfactoria. La instalación migrada utiliza un Compose independiente en Windows; ejecutar `admin/configure` en Ubuntu modificaría la instalación antigua.

El mecanismo oficial monta una tabla de cron en `/crons.conf`. Para programar la ejecución diaria a las **03:00 UTC** —**21:00 del día anterior en Ciudad de México**, UTC−6— prepara el archivo y agrega su montaje al Compose local:

```powershell
$mbCron = Join-Path $mbRoot 'replication.cron'
$mbUtf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($mbCron, "SHELL=/bin/bash`nBASH_ENV=/noninteractive.bash_env`n0 3 * * * /usr/local/bin/replication.sh`n", $mbUtf8)

Copy-Item -LiteralPath $mbCompose -Destination ($mbCompose + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$mbConfig = Get-Content -LiteralPath $mbCompose -Raw | ConvertFrom-Json
$mbExistingMounts = @($mbConfig.services.musicbrainz.volumes | Where-Object { $_.target -ne '/crons.conf' })
$mbConfig.services.musicbrainz.volumes = $mbExistingMounts + @([pscustomobject]@{
    type = 'bind'
    source = $mbCron.Replace('\', '/')
    target = '/crons.conf'
    read_only = $true
})
[System.IO.File]::WriteAllText($mbCompose, ($mbConfig | ConvertTo-Json -Depth 100), $mbUtf8)
docker --context desktop-linux compose -f $mbCompose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Configuración inválida; recupera la copia .bak antes de continuar' }
docker --context desktop-linux compose -f $mbCompose up -d --no-deps --no-build musicbrainz
```

Comprueba que el contenedor cargó la programación y revisa su hora:

```powershell
docker --context desktop-linux compose -f $mbCompose exec -T musicbrainz crontab -l
docker --context desktop-linux compose -f $mbCompose exec -T musicbrainz date -u
```

Windows, Docker Desktop, `db`, `valkey` y `musicbrainz` deben permanecer encendidos y conectados a Internet a esa hora. Si el equipo estaba apagado, no asumas que cron recuperará la ejecución perdida. Al volver puedes ejecutar la actualización manual, evitando solapamientos.

Las ejecuciones programadas usan el envoltorio oficial y escriben en `/musicbrainz-server/mirror.log`, que puede rotar a `mirror.log.1`. Para consultarlos:

```powershell
docker --context desktop-linux compose -f $mbCompose exec -T musicbrainz bash -c 'tail -n 80 mirror.log; if [ -f mirror.log.1 ]; then tail -n 80 mirror.log.1; fi'
```

Revisa los errores del registro y la secuencia de la base, aunque cron no informe un fallo. Copia los registros que quieras conservar antes de recrear el contenedor.

Para desactivar la programación conservando el token y los datos:

```powershell
$mbConfig = Get-Content -LiteralPath $mbCompose -Raw | ConvertFrom-Json
$mbConfig.services.musicbrainz.volumes = @($mbConfig.services.musicbrainz.volumes | Where-Object { $_.target -ne '/crons.conf' })
[System.IO.File]::WriteAllText($mbCompose, ($mbConfig | ConvertTo-Json -Depth 100), $mbUtf8)
docker --context desktop-linux compose -f $mbCompose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Configuración inválida; no recrees el servicio' }
docker --context desktop-linux compose -f $mbCompose up -d --no-deps --no-build musicbrainz
```

Si abriste otra terminal, vuelve a definir `$mbRoot`, `$mbCompose` y `$mbUtf8` antes de ejecutar estos bloques.

## 8. Problemas y recuperación

| Síntoma | Qué comprobar |
| --- | --- |
| Docker no responde | Abre Docker Desktop y confirma el contexto `desktop-linux`. |
| Error `role "postgres" does not exist` | Usa `-U musicbrainz -d musicbrainz_db`. |
| Token ausente, inválido o acceso denegado | Comprueba el secreto y su acceso en MetaBrainz; no pegues el token en registros, Git o el chat. Recrea únicamente `musicbrainz` después de corregir el montaje. |
| `Schema sequence mismatch` | Detén el intento y revisa las instrucciones de actualización de software para esa versión. No cambies `replication_control` a mano. |
| Otra instancia del cargador está activa | Espera a que termine; no borres su bloqueo para forzar una segunda ejecución. |
| Error SQL, paquete ausente o falta de espacio | Conserva el registro, consulta la secuencia y resuelve la causa antes de reintentar. No reconstruyas la base para ocultar el error. |

No ejecutes `createdb.sh -fetch` ni `recreatedb.sh` como actualización habitual. No borres volúmenes ni uses limpiezas que incluyan el catálogo. No cambies la versión principal de PostgreSQL apuntando al mismo volumen.

Si una carga falla, el cargador dispone de mecanismos para retomar operaciones pendientes. No edites ni vacíes sus tablas internas para saltarte el fallo. Si necesitas restaurar, comprueba primero el respaldo en una base independiente; no sobrescribas la única copia recuperable.

Para apagar, espera a que termine la replicación, revisa su resultado y ejecuta:

```powershell
docker --context desktop-linux compose -f $mbCompose stop
```

## 9. Fuentes y vigencia

Comprobación local: 12 de noviembre de 2026. La aptitud completa para replicar queda confirmada cuando la primera aplicación real termina correctamente y avanza la secuencia; la comprobación previa solo validó configuración, acceso y compatibilidad del siguiente paquete.

- [Replicación oficial: token, ejecución y cron](https://github.com/metabrainz/musicbrainz-docker#enable-replication).
- [Acceso a Live Data Feed](https://musicbrainz.org/doc/Live_Data_Feed).
- [Montaje oficial del token](https://github.com/metabrainz/musicbrainz-docker/blob/master/compose/replication-token.yml).
- [Montaje oficial de cron](https://github.com/metabrainz/musicbrainz-docker/blob/master/compose/replication-cron.yml).
- [Horario oficial de cron](https://github.com/metabrainz/musicbrainz-docker/blob/master/default/replication.cron).
- [Cargador de replicación](https://github.com/metabrainz/musicbrainz-server/blob/master/admin/replication/LoadReplicationChanges).
- [Envoltorio y rotación de registros](https://github.com/metabrainz/musicbrainz-server/blob/master/admin/cron/mirror.sh).
- [Respaldo con pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

Los comandos del cargador se contrastaron con la imagen instalada, basada en `v-2026-09-21.0`. Revisa las instrucciones correspondientes antes de actualizar imágenes o cambiar de esquema.
