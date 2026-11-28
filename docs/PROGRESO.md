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

## Incidente 27/11/2026: canción atascada en "Procesando 39 %" ✅ resuelto

**Qué pasó.** "Joe Satriani The Crush of Lov" (canción 12) se quedó en "Procesando" al 39 % durante minutos, no se podía borrar y bloqueaba a otra copia que estaba en cola (canción 13).

**Diagnóstico:**
- **Laravel y Windows:** el log de Laravel no tiene ningún error entre las 01:55 y las 02:02, y el registro de eventos de Windows tampoco (no hubo cierre inesperado de PHP ni de Python).
- **El proceso de separación desapareció:**
  - empezó a las 01:58:01 y su último avance (39 %) se guardó a las **01:58:09**;
  - a las 02:01 no quedaba **ningún** proceso de audio-separator ni el worker que lo lanzó;
  - la carpeta `work` estaba vacía, así que no siguió trabajando por su cuenta;
  - las dos ventanas actuales de `iniciar.bat` se abrieron a las 01:59:27.
- **Conclusión:** la ventana del worker de separación se cerró (o se interrumpió) con la canción a medias, y se llevó consigo a audio-separator. Que no haya rastro en ningún log solo encaja con eso.
- **GPU y acordes:** con `nvidia-smi` la GPU estaba en reposo (7 %) y sin ningún proceso Python. El worker de acordes **no** competía por la GPU: no tenía trabajo (todas las canciones se habían analizado antes de las 01:45).
- **La GPU sí se usa desde la cola:** con el worker real de `iniciar.bat`, la canción 13 se separó en unos 20 s con la GPU al 87–88 % y `python.exe` en la lista de procesos de `nvidia-smi`.

**Por qué no se recuperó sola** (tres fallos de la app):
1. La canción quedó en `processing` para siempre: nada detectaba que el worker había muerto.
2. El job siguió **reservado** en la tabla `jobs`. Con `retry_after` de 65 min, no se habría reintentado hasta entonces.
3. El bloqueo de la GPU (`WithoutOverlapping`) quedó tomado **65 min**, así que la copia en cola se reintentaba cada 15 s sin poder empezar. Además, borrar estaba prohibido mientras "procesaba".

Y un cuarto fallo, encontrado al probar: **el bucle de `iniciar.bat` nunca reiniciaba al worker.**
- `php` en Herd es `php.bat`, y un `.bat` que llama a otro sin `call` no vuelve.
- Por eso, en cuanto un worker terminaba (por un error, por memoria o por `queue:restart`), **se cerraba la ventana entera**.

**Caso actual:** no había proceso que terminar.
- La canción 12 se marcó como Error con un mensaje claro.
- Se quitaron su job y el bloqueo, y se borraron sus archivos a medias.
- La cola siguió sola con la canción 13, que se separó bien.

**Solución, para que no vuelva a pasar:**
- **Latido y vigilante** (`QueueWatchdog`):
  - mientras separa (o analiza acordes), el job escribe `heartbeat_at` cada 2 s;
  - si deja de hacerlo durante 30 s, el vigilante termina el proceso si sigue vivo (solo si su línea de comandos contiene la carpeta de esa canción), marca el error, borra los archivos a medias, **libera el bloqueo** y **quita el job de la cola**;
  - lo revisan los workers en cada vuelta (como mucho cada 10 s) y las consultas de estado de la página.
- **Proceso colgado:** el job ya no espera a ciegas. Si audio-separator pasa 180 s sin escribir nada (`SEPARATOR_STALL_TIMEOUT`), lo detiene y marca "se colgó en N %". Los acordes usan 120 s (`CHORDS_STALL_TIMEOUT`).
- **Botón Cancelar** (con confirmación) para canciones en cola o procesando:
  - detiene el proceso **real** (árbol completo con `taskkill /T`) en menos de 1 s y borra la carpeta `work`, reintentando mientras Windows suelta los archivos;
  - conserva el original;
  - si el worker no responde en 8 s, la propia petición hace la limpieza;
  - nuevo estado **Cancelada**.
- **Reintentar** para canciones con error **o canceladas**. **Borrar** (con confirmación) para cualquier canción que no se esté separando; si se está separando, pide cancelarla primero.
- **GPU sin pisarse:** si hay una separación en marcha, los acordes se analizan con el **procesador** (5 s en vez de 3 s para 5 minutos) en lugar de esperar o compartir la GPU. El dispositivo usado queda en `chords_model`, por ejemplo "btc-large (CPU)".
- **Duplicados:** al subir un archivo con el mismo nombre y tamaño que otra canción tuya, la subida se para y pregunta: "Ya tienes «…». ¿La subes de todos modos?" con *Omitir* o *Subir de todos modos*. Las demás siguen subiéndose.
- **`iniciar.bat`:** usa `call php …`. Ahora, si un worker termina, la ventana lo reinicia en 5 s en vez de cerrarse.

**Verificado:**
- **89 tests** (10 nuevos). Entre ellos:
  - un proceso colgado real se detiene en 2,6 s;
  - el vigilante mata el proceso de la canción, pero no otro programa;
  - se quita el job correcto de la cola;
  - los acordes usan la CPU durante una separación.
- **En Edge, con los workers reales de `iniciar.bat`**, usando una copia de *lotus feet* de `D:\Pistas`:
  1. Subir y, al 29 %, **Cancelar**: en 1,4 s queda "Cancelada", **sin ningún proceso vivo** (antes había `cmd`, `audio-separator.exe` y 2 `python.exe`), la carpeta `work` borrada y el original conservado.
  2. **Reintentar**: "Lista" en 35 s, y los acordes analizados.
  3. Subir el mismo archivo: aparece el aviso de duplicado; *Omitir* no crea otra canción.
  4. **Borrar** con confirmación: desaparece con su carpeta.
- **Repetición del incidente:**
  1. Con una canción procesando al 27 % y otra en cola, se mató a la fuerza el worker de separación.
  2. A los **37 s** el vigilante marcó la primera como Error ("¿se cerró la ventana «1 SEPARACION»?").
  3. La segunda empezó sola y terminó.
  4. Quedaron 0 jobs y 0 bloqueos, la carpeta `work` borrada, y la ventana volvió a arrancar su worker.
- Las canciones de prueba se borraron después. La canción 12 queda como Error para que puedas reintentarla o borrarla, y la 13 está lista.

## Incidente 28/11/2026: el login se queda cargando al pulsar "Entrar" ✅ resuelto

**Diagnóstico:**
- **Servidor sano:** `laravel.log` sin errores, MySQL responde y no hay migraciones pendientes. `POST /login` contesta en 0,65 s con `302 → /dashboard` y crea la sesión.
- **El bloqueo estaba en el navegador:**
  - existía `public/hot` (creado por un `npm run dev` lanzado hoy a las 11:07), así que cada página cargaba su JavaScript desde el servidor de Vite (`http://[::1]:5173`);
  - ese servidor estaba **vivo pero colgado**: las peticiones tardaban de 10 a 30 s o no llegaban;
  - al pulsar "Entrar", el login funcionaba, pero la página no podía cargar el código del Panel (`dashboard.tsx`) y el botón se quedaba cargando.
- **Por qué Vite se colgó:** vigila todos los archivos del proyecto para recargar la página al cambiarlos, y eso incluía los dos entornos de Python:
  - `separador/`: 35 118 archivos;
  - `tools/acordes/.venv`: 29 094 archivos, añadido el 27/11 con el motor de acordes.

  Con unos 64 000 archivos vigilados, el proceso de Vite llegó a 900 MB de RAM y **68 000 manejadores abiertos**, y dejó de responder. Había, además, **dos** `npm run dev` abiertos (11:07 y 11:18), los dos en ese estado.

**Solución:**
- `vite.config.ts`: `server.watch.ignored` excluye `separador/`, `tools/`, `storage/`, `vendor/`, `referencias/` y `docs/`.
- Se borró el `public/hot` y se recompiló (`npm run build`). La web usa los archivos compilados y no depende de que `npm run dev` esté abierto.
- **Verificado en Edge:** el login carga en 0,8 s y "Entrar" lleva al Panel en 0,35 s, sin errores.

**Pendiente para ti:** cierra las dos ventanas de `npm run dev` que siguen abiertas: consumen memoria y ya no se usan. Si vuelves a necesitarlo para programar, ábrelo de nuevo: con la nueva configuración ya no vigila los entornos de Python.

## Problemas conocidos / pendientes

- **No cierres las ventanas de `iniciar.bat` mientras se separa una canción.** Si se cierran, ahora la canción pasa sola a Error en unos 30–40 s y la cola sigue, pero esa separación se pierde y hay que reintentarla.
- Al subir un duplicado, la consola del navegador muestra "409 (Conflict)": es la respuesta esperada del aviso, no un error.

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
- **Servidor de desarrollo de Vite (`npm run dev`):** para uso diario no hace falta, basta con `npm run build`. Mientras existe el archivo `public/hot`, la web carga su código desde ese servidor. Si el servidor está cerrado o colgado, la web sale en blanco o el login se queda cargando: borra `public/hot` (ver el incidente del 28/11/2026).
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
