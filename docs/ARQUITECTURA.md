# Arquitectura

## Estructura del proyecto (lo propio de ACR Audio)

```
app/
  Console/Commands/CrearUsuario.php   php artisan usuario:crear
  Models/
    User.php                          + songs(), preference(), preferences()
    Song.php                          canción + rutas de sus archivos
    Track.php                         pista separada
    TrackSetting.php                  volumen / mute / solo de una pista
    ScheduledSilence.php              silencio programado de una pista
    UserPreference.php                preferencias del usuario
config/
  audio.php                           límites de subida, motor de separación, modelos, pistas
  filesystems.php                     disco "audio"
lang/es/                              mensajes de Laravel en español
resources/js/
  lib/navigation.ts                   menú lateral
  pages/…                             páginas React (Inertia)
docs/                                 esta documentación
```

## Tablas

| Tabla | Qué guarda | Relación |
|---|---|---|
| `users` | Usuarios (`name`, `email`, `password`, `remember_token`) | — |
| `user_preferences` | Preferencias: `master_volume` (volumen general del mezclador), `separation_model` (null = el del `.env`), `songs_sort` (orden de la lista: `recent`, `title`, `status`) y `keyboard_shortcuts` | 1 a 1 con `users` (`user_id` único, borrado en cascada) |
| `songs` (canciones) | `title`, `original_name` (solo informativo), `original_ext`, `original_size`, `duration`, `status`, `model`, `log`, `error`, `queued_at`/`started_at`/`finished_at` | N a 1 con `users` (cascada) |
| `tracks` (pistas) | `stem` (vocals, drums…), `file_name` (generado por el servidor), `size` y `position` | N a 1 con `songs` (cascada). Único por (`song_id`, `stem`) |
| `track_settings` (ajustes de pista) | `volume` (0–1), `muted` y `solo` | 1 a 1 con `tracks` (cascada). Si no existe, el modelo devuelve 1 / false / false |
| `scheduled_silences` (silencios programados) | `start_seconds` y `end_seconds` | N a 1 con `tracks` (cascada) |
| `jobs`, `failed_jobs`, `job_batches` | Cola de trabajos (driver `database`) | — |
| `sessions`, `cache`, `password_reset_tokens` | Infraestructura de Laravel | — |

Al borrar un usuario se borran en cascada sus canciones, pistas, ajustes y silencios **en la base de datos**. Los archivos del disco los borra la aplicación (ver Fase 5).

### Estados de una canción (`songs.status`)

| Valor | En pantalla | Significado |
|---|---|---|
| `pending` | En cola | Subida y esperando al worker |
| `processing` | Procesando | audio-separator está trabajando |
| `ready` | Lista | Pistas disponibles en el mezclador |
| `failed` | Error | Ver `error` (resumen) y `log` (salida completa) |

## Almacenamiento de archivos

- Disco de Laravel **`audio`**, definido en `config/filesystems.php`. Es privado: no tiene URL pública.
- Carpeta base: `AUDIO_STORAGE_PATH` del `.env`. Si está vacío, se usa `storage/app/private/audio`. Admite rutas absolutas (`D:\audios`) o relativas al proyecto.
- Estructura:
  ```
  {base}/{user_id}/{song_id}/original.{mp3|wav|flac|m4a|ogg}
  {base}/{user_id}/{song_id}/stems/{vocals|drums|bass|guitar|piano|other}.flac
  ```
- **Las rutas se construyen solo con ids numéricos y nombres fijos del servidor.** El nombre que escribe el usuario (`title`) y el nombre original del archivo (`original_name`) se guardan en la base de datos y nunca forman parte de una ruta.
- La carpeta está en `.gitignore`, igual que cualquier `*.mp3`, `*.wav`, `*.flac`, `*.m4a` y `*.ogg`.

## Subida de audios

```
Navegador (upload-dropzone.tsx)                 Servidor
  arrastrar archivos ─► validar ext/tamaño
  por cada archivo, en orden:
    POST /songs (multipart, 1 archivo) ───────► StoreSongRequest: extensión + MIME real + tamaño
       barra de progreso (onUploadProgress)     SongPolicy@create
                                                transacción:
                                                  crear fila songs (status = pending)
                                                  guardar {user}/{song}/original.{ext}
    ◄──────────────────────────────── 201 { song }
  recargar la lista (router.reload only: songs)
```

Límites que debe cumplir un archivo, de menor a mayor:

| Límite | Valor | Dónde |
|---|---|---|
| `AUDIO_MAX_UPLOAD_MB` | 250 MB | `.env` (validación de Laravel) |
| `upload_max_filesize` | 256M | `php.ini` de Herd |
| `post_max_size` | 260M | `php.ini` de Herd |
| `client_max_body_size` | 260M | `herd.conf` de nginx (Herd) |

## Cola de separación

```
POST /songs ──► SeparateSong::dispatch($song)  ──► tabla jobs (cola "separation")
                                                       │
iniciar.bat ─► php artisan queue:work --queue=separation (1 worker = 1 canción a la vez)
                                                       │
SeparateSong::handle()
  1. comprueba exe, carpeta de modelos y que el modelo esté descargado (si no, Error)
  2. status = processing, started_at
  3. Symfony Process (sin shell, timeout SEPARATOR_TIMEOUT):
       audio-separator.exe {base}\{u}\{s}\original.ext -m htdemucs_6s.yaml
         --model_file_dir … --output_dir {base}\{u}\{s}\work --output_format FLAC
         --custom_output_names {"Vocals":"vocals",…}
     · cada 1,5 s: % de la barra de progreso → caché "song-progress:{id}"
  4. éxito: mueve work/*.flac → stems/{stem}.flac, crea filas en tracks,
            duración con ffprobe, status = ready, guarda log
     error: status = failed, error = línea más útil del log, log completo
  5. borra work/
```

- `WithoutOverlapping('audio-separator')` impide dos separaciones simultáneas aunque haya dos workers.
- `retry_after` de la cola database = `SEPARATOR_TIMEOUT` + 300 s.
- Si el job lanza una excepción inesperada, `failed()` marca la canción como Error.

### Estado en vivo (polling)

La página Canciones llama a `GET /songs/status` cada 2,5 s **solo** mientras alguna canción está en cola o procesando. La respuesta incluye, por canción:
- `status`
- `progress`: % mientras se procesa
- `queue_position`: puesto en la cola, contando la que se está procesando

Cuando una termina (Lista o Error), la lista se recarga.

## Rutas web

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/songs` | Lista y zona de subida |
| POST | `/songs` | Sube un archivo (JSON) y lo encola |
| GET | `/songs/status` | Estado en vivo de las canciones del usuario |
| GET | `/songs/{id}/log` | Log de audio-separator (solo el dueño) |
| POST | `/songs/{id}/retry` | Vuelve a encolar una canción con error (solo el dueño) |

## Autenticación

- Starter kit de React con sesiones de Laravel (tabla `sessions`).
- "Recordarme" guarda la cookie `remember_web_…` (unos 13 meses), así la sesión sigue aunque se cierre el navegador.
- El **registro público está desactivado**: no hay rutas `/register`. Los usuarios se crean con `php artisan usuario:crear`.
- Recuperar contraseña: correo en español (`AppServiceProvider`). Con `MAIL_MAILER=log`, el enlace se escribe en `storage/logs/laravel.log` en lugar de enviarse.

## Configuración (`config/audio.php` ← `.env`)

| Variable | Uso |
|---|---|
| `AUDIO_STORAGE_PATH` | Carpeta base de los audios |
| `AUDIO_MAX_UPLOAD_MB` | Tamaño máximo por archivo (250). Debe ser menor que `upload_max_filesize` de PHP (256M) |
| `SEPARATOR_BIN` | Ruta a `audio-separator.exe` |
| `SEPARATOR_MODELS_DIR` | Carpeta de modelos (`--model_file_dir`) |
| `SEPARATOR_MODEL` | Modelo por defecto (`htdemucs_6s.yaml`) |
| `SEPARATOR_OUTPUT_FORMAT` | Formato de las pistas (`FLAC`) |
| `SEPARATOR_TIMEOUT` | Segundos máximos por canción (3600) |
