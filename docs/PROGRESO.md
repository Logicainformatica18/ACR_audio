# Progreso

## Paso A — Limpieza ✅

- Se eliminó la app de citas: modelos, controladores, páginas, componentes, rutas, migraciones, seeders, factories, tests, eventos, exportaciones, correos, configuraciones, archivos públicos y workflows de GitHub. El detalle está en `INVENTARIO_LIMPIEZA.md`.
- Paquetes quitados. Composer: Spatie, Reverb, Pusher, Excel y Sanctum. npm: Echo, Pusher, Socket.IO, jQuery, DataTables y Recharts.
- Paquetes actualizados dentro de sus versiones: Laravel 12.74. Sin avisos de seguridad en Composer ni en npm.
- `.env` y `.env.example` limpios: `APP_NAME="ACR Audio"`, `APP_URL=http://acr_audio.test` y `FILESYSTEM_DISK=local`.
- Base de datos MySQL `audio` creada y migrada.
- `php.ini` de Herd con límites de subida de 256M/260M. Herd reiniciado.
- Verificado:
  - `npm run types` y `npm run build` sin errores.
  - 26 tests pasan.
  - `http://acr_audio.test/login` responde 200.
  - `/dashboard` sin sesión redirige al login.
  - Las rutas viejas (`/supports`, `/clients`) dan 404.

## Fase 1 — Usuario, base de datos y configuración ✅

- Comando `php artisan usuario:crear` (opciones `--nombre`, `--email`, `--password` y `--generar`). Usuario `admin@acr.test` creado.
- Registro público desactivado: rutas, controlador y página eliminados.
- Migraciones y modelos de canciones, pistas, ajustes de pista, silencios programados y preferencias de usuario, con claves foráneas en cascada.
- Disco `audio` con `AUDIO_STORAGE_PATH`. Variables `SEPARATOR_*` y `AUDIO_MAX_UPLOAD_MB` en `.env` y `.env.example`.
- `.gitignore`: carpeta de audios, extensiones de audio y `.env.*`.
- Mensajes en español (`lang/es`).
- Corregido `SESSION_DOMAIN`, que impedía el login (ver `DECISIONES.md`, L14).
- Verificado:
  - 32 tests pasan.
  - Login real en `http://acr_audio.test` con contraseña correcta e incorrecta.
  - "Recordarme" crea la cookie `remember_web` y la sesión sigue tras borrar la cookie de sesión, que es lo que pasa al cerrar el navegador.

## Fase 2 — Subida y lista de canciones ✅

- Página **Canciones** (`/songs`), con entrada en el menú lateral.
- Zona para arrastrar uno o varios archivos (o hacer clic). Se suben de uno en uno con barra de progreso, porcentaje y mensaje de error claro por archivo.
- Validación en navegador y servidor: extensión, tipo real y tamaño (máximo 250 MB).
- Lista de canciones del usuario con estado (En cola, Procesando, Lista, Error), formato, tamaño, duración y fecha.
- `SongPolicy`: cada usuario solo ve sus canciones.
- nginx de Herd ampliado a 260M (antes cortaba en 128M).
- Verificado:
  - 38 tests pasan.
  - Subida real por Herd de un MP3 de 0,7 MB y un WAV de 198 MB (ambos 201).
  - Un texto renombrado a `.mp3` se rechaza (422).
  - Los archivos quedan en `storage/app/private/audio/{usuario}/{canción}/original.ext`.
  - Las canciones de prueba se borraron después.

## Fase 3 — Separación en cola con estado en vivo ✅

- Al subir una canción se encola el job `SeparateSong`, que ejecuta audio-separator (`htdemucs_6s`, salida FLAC) con la GPU.
- `iniciar.bat` arranca el worker. Si se cierra por un error, se reinicia solo.
- Estado en vivo en la lista:
  - **En cola**: posición en la cola y aviso si `iniciar.bat` parece cerrado.
  - **Procesando**: barra con % y tiempo transcurrido.
  - **Lista**.
  - **Error**: resumen del fallo, botón "Ver log" y botón "Reintentar".
- **Prueba real** con una **copia** de `D:\Pistas\Ballad Backing Track in A Minor _ C Major.mp3` (el original no se tocó; hash comprobado):
  - Canción de 4:21 separada en **24 s**, con 6 pistas FLAC (voz, batería, bajo, guitarra, piano y otros).
  - `nvidia-smi` durante la separación: **GPU al 84–87 %**, VRAM de 1,9 → 3,4 GB y `python.exe` (el de audio-separator) en la lista de procesos de la GPU. Al terminar volvió a 1 %.
  - El log confirma: "CUDA is available in Torch, setting Torch device to CUDA".
- La carpeta `separador` no se modificó (fechas de `modelos\` sin cambios).
- 46 tests pasan.

## Fase 4 — Mezclador con guardado automático ✅

- `referencias/mezclador.html`: copia del mezclador original.
- Botón **Abrir mezclador** en las canciones listas. Página `/songs/{id}` con:
  - las pistas cargadas automáticamente (barra de carga)
  - la onda de cada pista
  - reproducir/pausar, volver al inicio y reloj
  - volumen general
  - M (mute), S (solo) y volumen por pista
  - clic en la onda para saltar y arrastrar para programar un silencio
  - formulario de silencios (Desde/Hasta con botón "Ahora"), lista con Ir/Quitar y "Quitar todos" con confirmación
  - atajos de teclado
- Audio servido por `/songs/{id}/tracks/{pista}/audio` (solo el dueño), con soporte de Range.
- Guardado automático en la base de datos de volumen, mute, solo, silencios y volumen general, con indicador de estado.
- Verificado:
  - 54 tests pasan.
  - Por HTTP real: audio completo (200, `audio/flac`) y parcial (`Range: bytes=1000-1999` → 206 con `Content-Range`). Sin sesión → login.
  - En **Microsoft Edge** (modo invisible, controlado con puppeteer-core):
    - las 6 pistas cargan y se decodifican en 2 s
    - reproduce y pausa
    - mute, volumen y silencio creado arrastrando se guardan solos con **una** petición
    - **al recargar la página siguen ahí**
    - la tecla `2` silencia la pista 2
    - modo oscuro correcto
    - sin errores en la consola

## Fase 5 — Búsqueda, renombrar, borrar y mejoras ✅

- **Buscar** canciones (instantáneo, sin importar tildes) y **ordenar** (recientes, título o estado; se recuerda).
- Menú **⋯** de cada canción: **Renombrar** (ventana con el título) y **Borrar** (pide confirmación; borra filas y archivos; bloqueado mientras se separa).
- **Preferencias** (Configuración → Preferencias): modelo de separación, orden, atajos de teclado y volumen general.
- **Descargar** cada pista desde el mezclador con un nombre legible.
- **Panel** con resumen: canciones, listas, en cola, con error, minutos y espacio en disco.
- Al borrar la cuenta se borran también sus archivos.
- **Incidente corregido:** algunos tests borraban la carpeta real `audio/1` (ver `DECISIONES.md`, F5.10). Ahora ningún test puede tocar los audios reales, comprobado con un archivo testigo. La canción de prueba se restauró volviendo a separarla.
- Verificado:
  - **63 tests** pasan.
  - Prueba completa en **Edge** con otra **copia** de `D:\Pistas`:
    1. login
    2. subida
    3. "En cola" con aviso de `iniciar.bat`
    4. worker → "Procesando" 0 → 21 → 85 → 100 % → "Lista" en 21 s sin recargar
    5. búsqueda "corazon" → 1 resultado; "zzz" → mensaje vacío
    6. renombrar
    7. mezclador y descarga `Corazón (renombrada) - Voz.flac`
    8. borrar: Cancelar la conserva; Borrar la elimina con su carpeta
    9. preferencias guardadas
    10. panel con datos correctos
    11. mezclador en modo oscuro, sin errores en consola
  - El trabajo de una canción borrada mientras estaba en cola se descartó sin error (`failed_jobs` = 0).

## Fase 6 — Reconocedor de acordes con IA ✅

- **Motor** en `tools/acordes/`:
  - su propio `.venv` (Python 3.12, torch 2.11.0+cu128), independiente del separador
  - instalación con `instalar.bat`
  - pesos descargados del repositorio oficial y verificados con SHA-256 (fuera de git)
- **Comparación** BTC vs madmom con 4 canciones separadas (2 de ellas, copias nuevas de `D:\Pistas`). Ganó **BTC con vocabulario grande**; ver `DECISIONES.md`, F6.1.
- **Laravel:**
  - tabla `chords` y campos del análisis en `songs`
  - job `AnalyzeChords` en la cola **`acordes`**, que lee la salida del motor en vivo y guarda cada acorde al llegar
  - se encola solo al terminar cada separación
  - rutas para consultar, corregir y volver a analizar
  - comandos `acordes:analizar` y `ondas:calcular`
  - `iniciar.bat` abre **dos ventanas**
- **Mezclador:**
  - fila de acordes alineada con la línea de tiempo y una vista ampliada que se desplaza
  - indicador grande con el acorde actual y el siguiente
  - tonalidad
  - clic para saltar; doble clic o clic derecho para corregir
  - hoja de acordes que se puede mostrar u ocultar
  - "Volver a analizar"
- **Ondas precalculadas** al separar, guardadas en `tracks.peaks`. Se dibujan al abrir el mezclador.
- **Canciones que ya existían:** se ejecutaron `ondas:calcular` (24 pistas en 10 s) y `acordes:analizar` (4 canciones: A menor, E menor, A menor y B menor; unos 6–7 s cada una).
- **Verificado:**
  - **79 tests** pasan (16 nuevos, con un motor falso en PHP).
  - `npm run types`, `npm run build` y `eslint .` sin errores.
  - **Prueba completa en Edge** con una canción nueva: una **copia** de *Hotel California* de `D:\Pistas`, de 6:31 (hash comprobado).
    1. Subida, "En cola" y "Procesando". Separación en 33 s, con las ondas incluidas.
    2. "Lista" sin recargar, y el análisis de acordes queda en su cola.
    3. Mezclador: las **ondas se ven a los 0,27 s** y el audio está listo a los 3,8 s.
    4. Reproduciendo, se arranca la ventana de acordes: "En cola" → "Analizando… 1 %" → "8 %" → acordes en pantalla con "Analizando… 99 %" y la tonalidad provisional "B menor" → listo. El análisis tardó **8 s**.
    5. El resultado es la progresión real de la canción: **Bm F#7 A E7 G D Em F#7**.
    6. El indicador y el resaltado siguen a la reproducción (G → D → Em7). Clic en un acorde = salto.
    7. Corrección con doble clic ("D" → "Dmaj7, corregido a mano") y con clic derecho. "H7" da un error claro.
    8. **Cerrar y volver a abrir:** 148 acordes visibles a los **0,31 s** y **0 consultas** a `/chords` en 5 s: salen de la BD.
    9. **Volver a analizar** (con confirmación): la corrección **se conserva**, también tras recargar la página.
    10. Modo oscuro y ancho de móvil (420 px) correctos. Sin errores en la consola.
  - Las correcciones de prueba se quitaron después y la canción se volvió a analizar. Queda en tu lista como ejemplo; puedes borrarla.
  - `iniciar.bat` probado en seco (una copia en la que el worker escribe en un archivo): abre las dos ventanas con su cola cada una.
  - `D:\Pistas` y la carpeta del separador **sin cambios**: 0 archivos modificados hoy.

## Problemas conocidos / pendientes

- **Acordes que aparecen "progresivamente": en la práctica, casi de golpe.** El motor sí los entrega por bloques y Laravel los guarda uno a uno. Pero el análisis en la GPU dura unos 3 s, después de 3–4 s de arranque de Python, y la página consulta cada 2 s. Por eso se ven 1 o 2 estados intermedios ("Analizando… 8 %" y luego casi todos los acordes) y no un goteo lento.
- **Power chords (sin tercera)**, típicos del rock y el metal: el modelo duda entre mayor y menor (B o Bm). En el tema de metal en Si menor, el 84 % del tiempo quedó en acordes de la tonalidad. Se puede corregir a mano.
- **Tonalidad relativa:** entre una tonalidad mayor y su relativa menor (C mayor / A menor) se decide por el acorde que más suena y por cómo empieza y termina la canción. Puede equivocarse en canciones ambiguas. Mientras se analiza, la tonalidad puede cambiar ("provisional").
- **Corregir un acorde cambia su nombre, no sus tiempos.** Para mover dónde empieza o termina habría que añadir una función de edición de tiempos.
- **Acordes muy cortos** en la vista ampliada pueden mostrar el nombre cortado (por ejemplo "Esu" por Esus4). El nombre completo aparece al pasar el ratón y en la hoja de acordes.
- **madmom no se pudo instalar en Windows** porque necesita el compilador de Visual Studio. Se evaluó importando su código sin los 3 módulos compilados, que no se usan para acordes. No se usa en la app.
- **Espacio en disco:** el motor de acordes tiene su propio torch con CUDA (unos 4,5 GB en `tools/acordes/.venv`), aparte del del separador. Es el precio de mantener los dos entornos separados, como se pidió.
- **La separación tarda unos 4 s más** que antes, por el cálculo de las ondas (unos 0,6 s por pista).

- **Avisos de onnxruntime en el log** (`Failed to load cublas64_13.dll`, "onnxruntime-gpu is built with CUDA 13.x"): vienen del entorno de audio-separator. No afectan, porque `htdemucs_6s` usa PyTorch con CUDA 12.8, que funciona. Solo importarían con modelos ONNX (MDX). No se toca porque está en la carpeta `separador`.
- **Tras actualizar el código** hay que cerrar **las dos ventanas** y volver a abrir `iniciar.bat`: cada worker carga el código al arrancar.
- **Solo hay un modelo disponible** (`htdemucs_6s.yaml`), porque es el único descargado en `SEPARATOR_MODELS_DIR`. Para usar otro (`htdemucs_ft.yaml`, `htdemucs.yaml`), descárgalo tú con audio-separator en esa carpeta; aparecerá solo en Preferencias. La app nunca descarga modelos por su cuenta.
- **Servidor de desarrollo de Vite:** durante las pruebas había un `npm run dev` activo (lo indica `public/hot`). Para uso diario no hace falta: basta con `npm run build`. Si cierras ese servidor y la web se ve en blanco, borra el archivo `public/hot`.
- **Memoria del mezclador:** Web Audio guarda las pistas decodificadas en la RAM del navegador. Son unos 90 MB por pista para una canción de 4–5 minutos, así que unos 550 MB para 6 pistas. Con canciones muy largas (más de 20 minutos) el navegador podría quedarse sin memoria. Pasaba igual con el `mezclador.html` original.

- **No se pudo crear `D:\backups`.** La raíz `D:\` solo permite escribir a Administradores, y no se ejecutan comandos elevados. Siguen en su sitio:
  - `D:\github\_backup_git_ACR_audio` (historial git antiguo)
  - Restos de la app vieja, ignorados por git: `public/uploads`, `public/resource`, `public/imageusers`, `public/attachments`, `public/assets/` (solo `NuGet.exe`) y `certs/`

  Para moverlos, abre **PowerShell como Administrador** y ejecuta:
  ```powershell
  New-Item -ItemType Directory -Force D:\backups\acr_audio_restos_app_citas\public | Out-Null
  Move-Item D:\github\_backup_git_ACR_audio D:\backups\_backup_git_ACR_audio
  cd D:\github\ACR_audio
  foreach ($p in 'uploads','resource','imageusers','attachments','assets') { if (Test-Path "public\$p") { Move-Item "public\$p" "D:\backups\acr_audio_restos_app_citas\public\$p" } }
  if (Test-Path certs) { Move-Item certs D:\backups\acr_audio_restos_app_citas\certs }
  ```
