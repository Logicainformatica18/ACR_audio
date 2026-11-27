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
    Chord.php                         acorde de una canción (inicio, fin, nombre, confianza, editado)
  Jobs/
    SeparateSong.php                  cola "separation": separa, calcula ondas y encola los acordes
    AnalyzeChords.php                 cola "acordes": ejecuta el motor y guarda cada acorde al llegar
  Services/
    Separator.php                     envoltorio de audio-separator
    ChordEngine.php                   envoltorio de tools/acordes/acordes.py
    Waveform.php                      forma de onda precalculada con ffmpeg
  Console/Commands/
    AnalizarAcordes.php               php artisan acordes:analizar
    CalcularOndas.php                 php artisan ondas:calcular
  Http/Controllers/ChordController.php  avance del análisis, corregir, volver a analizar
config/
  audio.php                           límites de subida, motores de separación y acordes, modelos, pistas
  filesystems.php                     disco "audio"
lang/es/                              mensajes de Laravel en español
resources/js/
  lib/navigation.ts                   menú lateral
  lib/mixer/chords.ts                 acordes: tipos, búsqueda del actual, consulta del avance
  components/mixer/chord-*.tsx        fila de acordes, vista ampliada, hoja y ventana de corrección
  pages/…                             páginas React (Inertia)
tools/acordes/                        motor de acordes en Python (con su propio .venv, fuera de git)
  acordes.py                          recibe pistas, escribe eventos JSON por la salida estándar
  btc/modelo.py                       BTC adaptado (solo inferencia), licencia MIT en btc/LICENSE
  descargar_modelos.py                descarga y verifica los pesos (SHA-256) a modelos/
  instalar.bat, requirements.txt      instalación del entorno
docs/                                 esta documentación
```

## Tablas

| Tabla | Qué guarda | Relación |
|---|---|---|
| `users` | Usuarios (`name`, `email`, `password`, `remember_token`) | — |
| `user_preferences` | Preferencias: `master_volume` (volumen general del mezclador), `separation_model` (null = el del `.env`), `songs_sort` (orden de la lista: `recent`, `title`, `status`) y `keyboard_shortcuts` | 1 a 1 con `users` (`user_id` único, borrado en cascada) |
| `songs` (canciones) | `title`, `original_name` (solo informativo), `original_ext`, `original_size`, `duration`, `status`, `model`, `log`, `error`, `queued_at`/`started_at`/`finished_at`. **Análisis de acordes:** `chords_status` (null = nunca analizada, `pending`, `processing`, `ready`, `failed`), `chords_progress` (0–100), `chords_model`, `chords_key` (tonalidad, "B menor"), `chords_error`, `chords_started_at`/`chords_finished_at` | N a 1 con `users` (cascada) |
| `tracks` (pistas) | `stem` (vocals, drums…), `file_name` (generado por el servidor), `size`, `position` y `peaks` (forma de onda: 4000 bytes 0–255 en base64) | N a 1 con `songs` (cascada). Único por (`song_id`, `stem`) |
| `chords` (acordes) | `start_seconds`, `end_seconds`, `chord` (notación de guitarrista: `Bm`, `F#m7`, `N` = sin acorde), `confidence` (0–1, null si es manual) y `edited` (corregido a mano) | N a 1 con `songs` (cascada). Índice (`song_id`, `start_seconds`) |
| `track_settings` (ajustes de pista) | `volume` (0–1), `muted` y `solo` | 1 a 1 con `tracks` (cascada). Si no existe, el modelo devuelve 1 / false / false |
| `scheduled_silences` (silencios programados) | `start_seconds` y `end_seconds` | N a 1 con `tracks` (cascada) |
| `jobs`, `failed_jobs`, `job_batches` | Cola de trabajos (driver `database`) | — |
| `sessions`, `cache`, `password_reset_tokens` | Infraestructura de Laravel | — |

Al borrar un usuario se borran en cascada sus canciones, pistas, ajustes y silencios **en la base de datos**. Sus archivos los borra el evento `User::deleting`, que elimina `audio/{user_id}`. Al borrar una canción, `SongController@destroy` elimina `audio/{user_id}/{song_id}`.

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
            forma de onda de cada pista (Waveform, ffmpeg) → tracks.peaks,
            duración con ffprobe, status = ready, guarda log,
            y encola el análisis de acordes (cola "acordes")
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

## Cola de acordes

```
SeparateSong (al terminar) ─► Song::queueChordAnalysis()
                                chords_status = pending ─► AnalyzeChords (cola "acordes")
                                                              │
iniciar.bat, ventana 2 ─► php artisan queue:work --queue=acordes  (en paralelo a la de separación)
                                                              │
AnalyzeChords::handle()
  1. comprueba el motor (python, script y pesos); si falta algo → failed con el motivo
  2. pistas de entrada: guitar + bass + piano + other (sin drums ni vocals)
  3. borra los acordes automáticos (los editados a mano se quedan); status = processing
  4. Symfony Process (sin shell, timeout CHORDS_TIMEOUT):
       tools\acordes\.venv\Scripts\python.exe tools\acordes\acordes.py guitar.flac bass.flac piano.flac other.flac
         --modelo btc-large --modelos-dir tools\acordes\modelos
     callback en vivo, una línea JSON por evento:
       {"tipo":"acorde",...}     → INSERT en chords, recortado alrededor de los editados
       {"tipo":"progreso",...}   → songs.chords_progress (máx. 2 veces por segundo)
       {"tipo":"tonalidad",...}  → songs.chords_key (solo si cambia)
       {"tipo":"error",...}      → mensaje para chords_error
       {"tipo":"fin"}            → status = ready, progress = 100
```

### Motor (`tools/acordes/acordes.py`)

1. Mezcla las pistas en mono y las convierte a 22 050 Hz.
2. Ventanas de 10 s (108 cuadros CQT de 144 bins, como en el entrenamiento de BTC) que avanzan de 2,5 s en 2,5 s. Las probabilidades de las ventanas que se solapan se promedian con más peso en el centro.
3. Cada **bloque** son 4 ventanas (unos 10 s nuevos) que se procesan juntas en la GPU. Lo que ya no recibirá más ventanas se suaviza, se une y se **entrega**, salvo los últimos 2 s.
4. Normaliza los nombres a notación de guitarrista y re-estima la tonalidad en cada bloque.

Una canción de 5 minutos tarda unos 7 s en total: unos 3–4 s en cargar Python, torch y librosa, y unos 3 s de análisis en la GPU.

## Mezclador y cómo se sirven los audios

```
GET /songs/{id}  (MixerController@show, policy view, solo canciones "ready")
  └─ props: song, tracks[{id, stem, label, color, url, peaks, volume, muted, solo, silences[]}],
            preferences{master_volume, keyboard_shortcuts},
            analysis{status, progress, key, model, error}, chords[{id, start, end, chord, confidence, edited}]
            (acordes leídos de la BD: aparecen al instante, sin volver a analizar)

  · si analysis.status es pending/processing: GET /songs/{id}/chords cada 2 s hasta que termine
  · peaks (si existe) se dibuja al abrir, antes de descargar el audio
  · acorde actual: búsqueda binaria en cada fotograma; se resalta sin re-renderizar React

Navegador (pages/songs/mixer.tsx + lib/mixer/engine.ts)
  1. por cada pista (2 a la vez): fetch(url) con % → decodeAudioData → AudioBuffer
  2. AudioContext → GainNode por pista → GainNode general → altavoces
  3. reproducir: un AudioBufferSourceNode por pista, todos con el mismo start(when, offset)
  4. mute/solo/volumen/silencios: setTargetAtTime() sobre la ganancia de cada pista
     (los silencios se agendan por adelantado en el tiempo del AudioContext)

GET /songs/{id}/tracks/{track}/audio  (MixerController@audio)
  · auth + policy view + scopeBindings (la pista pertenece a la canción)
  · BinaryFileResponse: 200 completo o 206 con Range; Content-Type audio/flac
  · Cache-Control: private (el navegador puede reutilizarlo; los proxies no)
```

### Guardado automático

```
cambio (M, S, volumen, silencio, volumen general)
  └─ 0,7 s sin más cambios ─► PUT /songs/{id}/mixer  (JSON con el estado COMPLETO)
                                 SaveMixerRequest valida (pistas de la canción, rangos…)
                                 transacción:
                                   track_settings: updateOrCreate por pista
                                   scheduled_silences: borrar los de la canción + insertar
                                   user_preferences.master_volume
salir de la página con cambios pendientes ─► fetch keepalive con el mismo PUT
```

## Rutas web

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/songs` | Lista y zona de subida |
| POST | `/songs` | Sube un archivo (JSON) y lo encola |
| GET | `/songs/status` | Estado en vivo de las canciones del usuario |
| GET | `/songs/{id}/log` | Log de audio-separator (solo el dueño) |
| POST | `/songs/{id}/retry` | Vuelve a encolar una canción con error (solo el dueño) |
| GET | `/songs/{id}` | Mezclador (solo el dueño y solo si está lista) |
| GET | `/songs/{id}/tracks/{pista}/audio` | Archivo de la pista, con Range |
| PUT | `/songs/{id}/mixer` | Guardado automático del mezclador |
| PATCH | `/songs/{id}` | Renombrar (solo el dueño) |
| DELETE | `/songs/{id}` | Borrar canción, pistas, ajustes, silencios y archivos (solo el dueño; no mientras se procesa) |
| GET | `/songs/{id}/tracks/{pista}/audio?download=1` | Descarga la pista como "Título - Pista.flac" |
| GET | `/songs/{id}/chords` | Estado del análisis y acordes guardados (solo el dueño) |
| POST | `/songs/{id}/chords/analyze` | Volver a analizar (409 si ya está en marcha) |
| PATCH | `/songs/{id}/chords/{acorde}` | Corregir un acorde a mano: queda `edited` (solo el dueño) |
| GET | `/dashboard` | Panel con resumen |
| GET/PUT | `/settings/preferences` | Preferencias del usuario |
| PATCH | `/settings/preferences/sort` | Orden de la lista (desde la página Canciones) |

## Tests

- `php artisan test`: 79 tests. Usan SQLite en memoria, un disco `audio` falso (`Storage::fake` en `tests/TestCase.php`), cola `sync` con `SEPARATOR_BIN` vacío, `CHORDS_PYTHON` apuntando a una ruta inexistente y `withoutVite()`.
- El job de acordes se prueba con un **motor falso en PHP** (`tests/Fixtures/fake_chords_*.php`) que imprime los mismos eventos JSON.
- **Nunca** tocan la base `audio`, los archivos reales, el audio-separator ni el motor de acordes real.

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
| `CHORDS_PYTHON` | Python del motor de acordes. Vacío = `tools/acordes/.venv/Scripts/python.exe` |
| `CHORDS_SCRIPT` | Script del motor. Vacío = `tools/acordes/acordes.py` |
| `CHORDS_MODELS_DIR` | Carpeta de los pesos. Vacío = `tools/acordes/modelos` |
| `CHORDS_MODEL` | `btc-large` (vocabulario grande, por defecto) o `btc-majmin` (solo mayor/menor) |
| `CHORDS_TIMEOUT` | Segundos máximos de análisis por canción (900) |
