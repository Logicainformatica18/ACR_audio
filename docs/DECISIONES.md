# Decisiones técnicas

Registro de las decisiones tomadas en el proyecto y el motivo de cada una. Las más recientes van al final de cada sección.

## Limpieza (Paso A)

| # | Decisión | Por qué |
|---|---|---|
| L1 | Mantener el starter kit oficial **React + Inertia + TypeScript** en lugar de instalar Breeze con Blade | La autenticación ya existía y funcionaba con "Recordarme". Un segundo kit duplicaría el login. Confirmado por el usuario |
| L2 | Borrar con `git rm` | El borrado queda en el historial de git y se puede recuperar |
| L3 | Los restos de la app vieja que **no estaban en git** (`public/uploads`, `public/resource`, `public/imageusers`, `public/attachments`, `public/assets/…/NuGet.exe`, `certs/`) **no se borran**: se dejan en disco, ignorados por git, a la espera de moverlos a `D:\backups` | Son archivos que solo existen en este PC. Borrarlos sería irreversible. Ver "Problemas conocidos" en `PROGRESO.md` |
| L4 | Se quita también `laravel/sanctum` | Solo daba servicio a la API de la app de citas. El login web usa sesiones normales |
| L5 | Se elimina la notificación propia de "recuperar contraseña" y se personaliza la estándar con `ResetPassword::toMailUsing()` en `AppServiceProvider` | Se mantiene el texto en español y la notificación sigue siendo la oficial de Laravel, que es la que comprueban los tests |
| L6 | La tabla `users` vuelve a la estándar (`name`, `email`, `password`) | La tabla vieja tenía `firstname`/`lastname`/`names`, pero la página de perfil usaba `name`: estaba rota |
| L7 | `/` redirige a `/dashboard`, que pide login. Se elimina la página `welcome` | Es una app privada: no necesita portada pública |
| L8 | El menú vive en un solo archivo (`resources/js/lib/navigation.ts`) | La barra lateral y el menú móvil comparten la lista, y añadir una sección se hace en un solo sitio |
| L9 | Se ejecuta `composer update` (sin salir de Laravel 12) y `npm audit fix` | El lock heredado tenía 62 avisos de seguridad en Composer y 23 en npm. Ahora hay 0 en ambos. Laravel pasa de 12.17 a 12.74 |
| L10 | La base `audio` se crea con `CREATE DATABASE IF NOT EXISTS` y se ejecuta `migrate` (no `migrate:fresh`) | La base no existía. `migrate` sobre una base vacía da el mismo resultado sin borrar nada |
| L11 | `php.ini` de Herd: `upload_max_filesize=256M`, `post_max_size=260M`. Copia del original en `php.ini.bak-acr` | Con 2M/8M no se podía subir casi ninguna canción. El POST lleva un poco más que el archivo (cabeceras y campos), por eso 260M |
| L12 | Se quitan los workflows de GitHub (`.github/`) | Decisión del usuario |
| L13 | Logo: el genérico del starter kit de Laravel, con el texto "ACR Audio" | Decisión del usuario: sin logos de la app de citas |
| L14 | `SESSION_DOMAIN=null` en el `.env` (antes `citas_websocket.test`) | Con el dominio viejo, el navegador rechazaba las cookies en `acr_audio.test` y **el login no funcionaba**. Se descubrió al probar el login real |

## Fase 1 — Usuario, base de datos y configuración

| # | Decisión | Por qué |
|---|---|---|
| F1.1 | Tablas en inglés (`songs`, `tracks`, `track_settings`, `scheduled_silences`, `user_preferences`), interfaz en español | Es la convención de Laravel (modelos y relaciones automáticas). La equivalencia está en `ARQUITECTURA.md` |
| F1.2 | `track_settings` en una tabla aparte, 1 a 1 con `tracks`, con valores por defecto si no existe la fila | Lo pidió el usuario. Además, una pista recién separada no necesita fila hasta que se toca el mezclador |
| F1.3 | Tiempos de silencios como `decimal(10,3)` (milisegundos) | Precisión suficiente y sin errores de redondeo de `float` al comparar |
| F1.4 | Preferencias de usuario: volumen general, modelo de separación, orden de la lista y atajos de teclado | Son los ajustes que el usuario cambia y espera que se recuerden. El tema claro u oscuro ya lo guarda el starter kit en una cookie |
| F1.5 | `separation_model` solo acepta modelos de la lista de `config/audio.php`. Si es desconocido, se usa el del `.env` | Evita pasar a audio-separator un valor arbitrario |
| F1.6 | Disco `audio` propio, privado (`serve => false`) y con `throw => true` | Que nunca se publique por URL y que los errores de disco no pasen desapercibidos |
| F1.7 | `AUDIO_STORAGE_PATH` vacío = `storage/app/private/audio`; admite ruta absoluta o relativa | Funciona sin configurar nada y permite mover los audios a otro disco |
| F1.8 | Rutas de Windows en el `.env` entre **comillas simples** | Entre comillas dobles, phpdotenv interpreta `\U`, `\D`… como secuencias de escape y falla |
| F1.9 | `usuario:crear`: contraseña mínima de 12 caracteres con letras y números. `--generar` crea 20 caracteres sin símbolos | Segura y fácil de copiar. Se muestra una sola vez y no se guarda en ningún archivo |
| F1.10 | Registro desactivado quitando rutas, controlador y página. Hay tests que comprueban que `/register` da 404 | Una ruta sin uso es superficie de ataque; mejor que no exista |
| F1.11 | Mensajes de Laravel en español creando `lang/es/` a mano (`APP_LOCALE=es`) | Sin paquetes de terceros: el usuario pidió solo fuentes oficiales |
| F1.12 | `.gitignore`: carpeta de audios, cualquier extensión de audio en minúsculas o mayúsculas y `.env.*` salvo `.env.example` | Doble protección para que ningún audio ni secreto llegue a GitHub |

## Fase 2 — Subida y lista

| # | Decisión | Por qué |
|---|---|---|
| F2.1 | La interfaz sube **un archivo por petición**, en secuencia, con axios y `onUploadProgress` | Permite una barra de progreso real por archivo y que un error en uno no afecte a los demás. Además nunca se acercan al límite de `post_max_size` varios archivos juntos |
| F2.2 | Validación doble: en el navegador (extensión y tamaño, para avisar al instante) y en el servidor (`StoreSongRequest`: extensión + tipo MIME **real** detectado por PHP + tamaño) | La del navegador es solo comodidad; la del servidor es la que protege. Un `.txt` renombrado a `.mp3` se rechaza |
| F2.3 | Lista de tipos MIME amplia (por ejemplo `video/mp4` para m4a y `application/ogg` para ogg) | PHP (fileinfo) detecta así algunos archivos válidos. Sin ellos se rechazarían audios correctos |
| F2.4 | Archivo guardado como `{user_id}/{song_id}/original.{ext}`, dentro de una transacción con la fila de la canción | Ruta sin texto del usuario. Si falla el guardado del archivo, no queda una canción sin archivo |
| F2.5 | Título = nombre del archivo sin extensión, con `_` convertido en espacio y sin caracteres de control. Máximo 200 | Un nombre legible sin pedir nada extra. Se puede renombrar en la Fase 5 |
| F2.6 | `SongPolicy` (autodetectada por Laravel). Las listas siempre se filtran con `Song::ownedBy($user)` | Doble barrera: las consultas solo traen lo propio y cada acción sobre una canción concreta pasa por la policy |
| F2.7 | `SongResource` no expone rutas de archivo ni el log | La interfaz no necesita saber dónde están los archivos |
| F2.8 | nginx de Herd: `client_max_body_size` de **128M → 260M** en `C:\Users\USER\.config\herd\config\nginx\herd.conf` (copia en `herd.conf.bak-acr`) | Aunque PHP aceptaba 256M, nginx cortaba en 128M con un error 413. Se descubrió al subir un WAV de 198 MB |
| F2.9 | Orden de la lista según la preferencia `songs_sort` (recientes, título o estado) con `CASE` en SQL | `CASE` funciona igual en MySQL y en SQLite (tests) |

## Fase 3 — Separación en cola

| # | Decisión | Por qué |
|---|---|---|
| F3.1 | Job `SeparateSong` en la cola `separation` (driver `database`) con **un solo worker** (`iniciar.bat`) | Una separación a la vez: la GPU no se reparte entre dos canciones |
| F3.2 | Además, middleware `WithoutOverlapping('audio-separator')` con reintentos ilimitados solo para esperar turno (`tries = 0`) y `maxExceptions = 1` | Si alguien abre dos `iniciar.bat`, el segundo espera en vez de separar a la vez. Un error real no se reintenta: se marca como fallido |
| F3.3 | Ejecución con **Symfony Process** pasando los argumentos como lista (sin shell) | Sin riesgo de inyección de comandos; las rutas las construye la app |
| F3.4 | El límite de tiempo lo impone Symfony Process (`SEPARATOR_TIMEOUT`, 3600 s) | En Windows PHP no tiene `pcntl`, así que el worker no puede cortar trabajos por tiempo |
| F3.5 | `retry_after` de la cola = `SEPARATOR_TIMEOUT + 300` por defecto | Si fuera menor (90 s por defecto), Laravel daría la separación por perdida y la repetiría mientras sigue en marcha |
| F3.6 | `--custom_output_names` para obtener `vocals.flac`, `drums.flac`…, con respaldo que reconoce `…_(Vocals)_….flac` | Nombres fijos del servidor, independientes del nombre del archivo subido |
| F3.7 | Se separa en `{canción}/work/` y solo al terminar bien se mueven las pistas a `stems/` dentro de una transacción | Un fallo a medias no deja pistas incompletas ni filas huérfanas |
| F3.8 | **Solo modelos ya descargados** en `SEPARATOR_MODELS_DIR` | Con un modelo ausente, audio-separator lo descargaría **dentro de la carpeta del separador**, que no se debe modificar |
| F3.9 | Log completo en `songs.log` (sin colores de consola, sin repintados de barras y en UTF-8 válido) y resumen en `songs.error` (la última línea con "error/exception…") | El usuario ve un mensaje corto y puede abrir el log entero desde la interfaz |
| F3.10 | Progreso (%) leído de las barras de tqdm y guardado en caché, **solo ascendente** | demucs hace 2 pasadas, cada una con su barra de 0 a 100. Sin esto el % saltaba hacia atrás |
| F3.11 | Estado en vivo por **polling** a `/songs/status` cada 2,5 s, solo mientras haya canciones en cola o procesando | Elegido por el usuario: sin websockets ni procesos extra. Si no hay nada activo, no se hacen peticiones |
| F3.12 | Aviso "¿Está abierta la ventana de iniciar.bat?" si una canción lleva más de 20 s en cola y no se procesa ninguna | Es el error más probable de un usuario principiante |
| F3.13 | Botón **Reintentar** para canciones con error | Si el fallo fue pasajero (por ejemplo la GPU ocupada), no hace falta volver a subir el archivo |
| F3.14 | Duración con `ffprobe` (viene con ffmpeg) | Dato fiable sin decodificar el audio en PHP |
| F3.15 | `phpunit.xml` vacía `SEPARATOR_BIN`/`SEPARATOR_MODELS_DIR` y los tests de subida usan `Queue::fake()` | En un primer intento, un test ejecutó el audio-separator real (54 s). Los tests no deben tocar el motor real nunca |
| F3.16 | `*.bat` con saltos de línea CRLF (`.gitattributes`) | `cmd.exe` falla con etiquetas y `goto` en archivos con LF |

## Fase 4 — Mezclador

| # | Decisión | Por qué |
|---|---|---|
| F4.1 | Página React (`songs/mixer.tsx`) con la lógica de audio de `referencias/mezclador.html` movida a una clase (`lib/mixer/engine.ts`) | Se conserva lo que ya funcionaba (sincronía con un AudioContext, rampas de ganancia para los silencios y envolvente de la onda) y React solo dibuja la interfaz |
| F4.2 | Cabezales, reloj y "en silencio" se actualizan **fuera de React** (refs + `requestAnimationFrame`) | Re-renderizar 6 pistas 60 veces por segundo sería innecesario y menos fluido |
| F4.3 | Las pistas se descargan con `fetch` (2 a la vez, con % de progreso) y se decodifican con `decodeAudioData` | Web Audio necesita el audio completo en memoria para la reproducción sincronizada y para dibujar la onda |
| F4.4 | La ruta de audio usa `BinaryFileResponse` (`response()->file`) | Atiende `Range` (206 Partial Content) sin cargar el archivo en memoria de PHP. Protegida por login y policy, con `scopeBindings` (la pista debe ser de esa canción) |
| F4.5 | Guardado automático del **estado completo** (volumen general + ajustes de cada pista + lista de silencios) con un único `PUT /songs/{id}/mixer`, 0,7 s después del último cambio | Más simple y robusto que una petición por acción: es idempotente, sin problemas de orden y una sola transacción. Varios cambios seguidos = una sola petición |
| F4.6 | Nunca dos guardados a la vez; si hay cambios durante uno, se envía otro al terminar. Al cerrar la pestaña o salir del mezclador se envía lo pendiente con `fetch keepalive` | No se pierden cambios hechos justo antes de salir |
| F4.7 | Indicador visible: "Cambios sin guardar… / Guardando… / Guardado / No se pudo guardar + Reintentar" | El usuario pidió guardado sin botón; el indicador le da confianza de que funciona |
| F4.8 | Validación del guardado: las pistas deben ser de la canción; volumen 0–1; silencios dentro de la duración (+1 s de margen) y de al menos 0,05 s; máximo 500 | Nadie puede escribir ajustes en pistas ajenas ni guardar datos absurdos |
| F4.9 | El volumen general se guarda en las **preferencias del usuario** (común a todas sus canciones) | Es un ajuste de escucha personal, no de una canción |
| F4.10 | "Quitar todos los silencios" pide confirmación con un diálogo (`ConfirmDialog`, reutilizable) | Es una acción que borra varios datos de golpe |
| F4.11 | Atajos de teclado (Espacio, 1–9, Inicio) desactivables en preferencias | Igual que el HTML original; se ignoran mientras se escribe en un campo |
| F4.12 | Colores del mezclador como variables CSS `--mx-*` con variante oscura | Mismo aspecto que el HTML original, integrado con el tema claro u oscuro de la app |
| F4.13 | Los tests llaman a `withoutVite()` | No dependen de haber compilado el frontend |
| F4.14 | ESLint ignora `separador/`, `referencias/` y `storage/` | `npm run lint` (`eslint . --fix`) revisaba el JavaScript del entorno de Python dentro de `separador/.venv` |

## Fase 5 — Gestión y mejoras

| # | Decisión | Por qué |
|---|---|---|
| F5.1 | Búsqueda **en el navegador**, instantánea, por título, nombre del archivo y estado, sin distinguir tildes ni mayúsculas | Para una biblioteca personal es más rápida y simple que buscar en el servidor. "corazon" encuentra "Corazón" |
| F5.2 | El orden de la lista se elige en la propia página y se guarda en las preferencias (`PATCH /settings/preferences/sort`) | El usuario no tiene que ir a Configuración para cambiarlo y se recuerda la próxima vez |
| F5.3 | Renombrar solo cambia `songs.title` (sin caracteres de control y no vacío) | Los archivos tienen nombres fijos del servidor: renombrar nunca toca el disco |
| F5.4 | Borrar pide confirmación (diálogo) y borra filas (cascada) **y** la carpeta `{usuario}/{canción}` | Pedido por el usuario. No quedan archivos huérfanos |
| F5.5 | No se puede borrar una canción mientras se **está separando** (409). Sí mientras está en cola | Borrar en mitad del proceso dejaría a audio-separator escribiendo en una carpeta inexistente. Una en cola se descarta sola (`deleteWhenMissingModels`) |
| F5.6 | Al borrar la **cuenta** se borra también `audio/{user_id}` (evento `User::deleting`) | La cascada de la BD no borra archivos |
| F5.7 | Página **Preferencias**: modelo de separación (solo modelos descargados), orden de la lista, atajos de teclado y volumen general | Completa el requisito de "preferencias por usuario" con algo que se pueda cambiar desde la interfaz |
| F5.8 | **Descargar pistas** desde el mezclador (`?download=1`) con nombre "Título - Pista.flac". El título se sanea para Windows y solo va en la cabecera `Content-Disposition` | Mejora útil: llevar una pista a otro programa. El texto del usuario nunca forma parte de una ruta |
| F5.9 | **Panel** con totales por estado, minutos separados, espacio ocupado y últimas canciones | Que la página de inicio tras el login sea útil |
| F5.10 | **Todos los tests usan un disco `audio` falso** (`Storage::fake` en `tests/TestCase.php`) y `phpunit.xml` apunta `AUDIO_STORAGE_PATH` a una carpeta de pruebas | **Incidente:** al añadir F5.6, tests que borran un usuario de prueba (id 1) borraron la carpeta **real** `audio/1`. Se perdieron los archivos derivados de la canción de prueba (no los originales de `D:\Pistas`). Se restauraron volviendo a separar la copia. Ahora hay dos barreras, comprobadas con un archivo testigo |

## Fase 6 — Reconocedor de acordes

### Comparación de motores (27/11/2026)

Se probaron dos reconocedores de acordes con IA sobre la mezcla **Guitarra + Bajo + Piano + Otros** (sin Batería ni Voz) de 4 canciones ya separadas con `htdemucs_6s`. Dos son canciones con acordes conocidos, separadas a partir de **copias** de `D:\Pistas`.

**Medida:** "En la tonalidad" es el % del tiempo con acorde (sin contar *N*) cuya tríada pertenece a los acordes esperados de la canción. Es una medida aproximada: no había anotaciones oficiales para estas grabaciones.

| Canción (acordes esperados) | BTC vocabulario grande | BTC mayor/menor | madmom CNN+CRF | madmom DeepChroma+CRF |
|---|---|---|---|---|
| Zombie (Em C G D) | **100 %** · E menor · Em, Em7, C, G, Gmaj7, D | 98,4 % · E menor | 97,7 % · aparecen Bm, F#, A, E (no están) | 75,0 % |
| Hotel California (Bm F#7 A E7 G D Em) | **100 %** · B menor · **F#7 y E7** detectados | 100 % · B menor | 99,5 % · aparecen Am, F#m | 100 % |
| Balada en A menor / C mayor | **100 %** · A menor | 100 % · A menor | 100 % | 100 % |
| Metal 80s en B menor (power chords) | **83,7 %** · B menor | 75,4 % · D mayor ✗ | 75,1 % | 74,4 % |
| Tiempo de análisis (canción de 4–5 min) | **2,6–3,4 s (GPU)** | 2,3–2,9 s (GPU) | 40–60 s (CPU) | 0,2 s (CPU) |

Acuerdo entre BTC (vocabulario grande) y madmom CNN, reduciendo a tríadas: 79 % (Zombie), 92 % (Hotel California), 93 % (balada) y 72 % (metal). Coinciden en lo principal y difieren en los pasajes ambiguos.

| | BTC (jayg996/BTC-ISMIR19) | madmom (CPJKU/madmom) |
|---|---|---|
| Licencia del código | MIT | BSD |
| Licencia de los modelos | MIT (en el mismo repositorio) | **CC BY-NC-SA 4.0**: solo uso no comercial |
| Vocabulario | **170 clases**: mayor, menor, 7, maj7, m7, dim, dim7, m7b5, aug, sus2, sus4, 6, m6 y m(maj7) | Solo **mayor/menor** (24 + N) |
| GPU | **Sí** (PyTorch) | No (numpy en CPU) |
| Instalación en Windows con Python 3.12 | Funciona con 3 cambios menores (`np.float`, `yaml.load` y carga segura de los pesos) | **No se instala**: no hay paquete precompilado y su código Cython necesita el compilador de Visual Studio, que no está instalado. Se evaluó importándolo sin sus 3 módulos compilados, que no se usan para acordes |
| Antigüedad | 2019 | Última versión publicada: 2018. El código de git está actualizado, pero sin versión publicada |

| # | Decisión | Por qué |
|---|---|---|
| F6.1 | Motor elegido: **BTC con vocabulario grande** (`btc_model_large_voca.pt`) | Fue el mejor en las 4 canciones, detecta séptimas, sus y dim (pedido: "A7, Dmaj7, Bdim, Bsus4"), usa la GPU, tiene licencia MIT para código y pesos, y se instala sin compilador. madmom solo distingue mayor/menor, no se instala en Windows sin Visual Studio, su modelo bueno (CNN) tarda unos 50 s en CPU y sus pesos son de uso no comercial |
| F6.2 | El motor vive en `tools/acordes/` con **su propio `.venv`** (Python 3.12, torch 2.11.0+cu128). El código de BTC se **copió adaptado** (solo inferencia) a `tools/acordes/btc/` con su LICENSE | No depende de nada de la carpeta del separador. El repositorio original es de 2019 (numpy < 1.24, `yaml.load` sin Loader): se quitó lo que solo sirve para entrenar y se adaptó a las versiones actuales sin cambiar los nombres de las capas, así los pesos oficiales cargan tal cual |
| F6.3 | Los pesos (`*.pt`, 12 MB cada uno) **no se suben a git**. Los descarga `descargar_modelos.py` del repositorio oficial y comprueba su huella SHA-256. Se cargan con `torch.load(weights_only=True)` permitiendo solo los escalares de numpy | Regla del proyecto: nada de modelos en git. La huella detecta descargas corruptas o alteradas. `weights_only` impide que un archivo de pesos ejecute código |
| F6.4 | Análisis **por ventanas de 10 s que avanzan de 2,5 s en 2,5 s**. Cada instante lo ven 4 ventanas y se promedian sus probabilidades, con más peso al centro de cada ventana. La CQT se calcula ventana a ventana, igual que en el entrenamiento | El script original cortaba en trozos de 10 s sin solapar y fallaba en los bordes. Así no se cortan acordes y cada ventana se parece a lo que el modelo vio al entrenar |
| F6.5 | **Entrega progresiva:** cada bloque son 4 ventanas (unos 10 s nuevos) procesadas juntas en la GPU. Lo que ya no va a recibir más ventanas se entrega enseguida, salvo los últimos 2 s, que pueden cambiar | Cumple "va entregando los acordes a medida que los detecta" sin entregar nada que luego cambie. Cada acorde se envía una sola vez |
| F6.6 | Suavizado de ±2 cuadros (±0,19 s), unión de acordes iguales seguidos y absorción de los de menos de 0,45 s | Evita parpadeos de acordes de una décima de segundo, que no sirven para tocar |
| F6.7 | Notación de guitarrista: `C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B` + sufijos `m, 7, maj7, m7, dim, dim7, m7b5, aug, sus2, sus4, 6, m6, m(maj7)`. `N` = sin acorde (también la clase "desconocido" de BTC) | Es como lo escribe un guitarrista: F#m7, Bb, Eb. Se usan bemoles en Eb, Ab y Bb porque es lo habitual |
| F6.8 | **Tonalidad:** para cada una de las 24 tonalidades se suma el tiempo de los acordes que le pertenecen; en menor se aceptan v y V. Se añade un poco de Krumhansl-Kessler sobre el croma de la mezcla y un bonus por el tiempo que suena la tónica y por empezar o terminar en ella | Solo con el croma, Krumhansl-Kessler confundía E menor y C mayor en la balada. Con los acordes, la balada da A menor, Zombie E menor y Hotel California B menor. Se re-estima en cada bloque, así aparece pronto |
| F6.9 | Una canción de 4–5 minutos se analiza en **unos 3 s en la GPU, unos 6 s en total** (la carga de torch y librosa tarda unos 3 s) | La CQT de las ventanas de cada bloque se calcula en una sola llamada. Antes tardaba 18 s por reconstruir los filtros en cada ventana |

### Laravel: cola, base de datos y job

| # | Decisión | Por qué |
|---|---|---|
| F6.10 | Cola propia **`acordes`** con su propio worker. Al terminar una separación, `SeparateSong` llama a `Song::queueChordAnalysis()` | Así una canción se analiza mientras la siguiente se separa: las dos colas avanzan en paralelo. El análisis usa poca GPU (unos 300 MB), así que convive con la separación |
| F6.11 | `WithoutOverlapping('chord-engine')` en `AnalyzeChords` | Aunque alguien abra dos ventanas de acordes, nunca hay dos análisis a la vez |
| F6.12 | El job lee la salida del motor **en vivo** (callback de Symfony Process). Junta los trozos de línea que llegan partidos y guarda cada acorde con un `INSERT` apenas llega | Es lo que permite ver los acordes aparecer mientras se analiza. Las líneas que no son JSON o tienen un tipo desconocido se ignoran |
| F6.13 | El progreso se escribe en `songs.chords_progress` como mucho 2 veces por segundo, y la tonalidad solo cuando cambia | La interfaz consulta cada 2 s: escribir más a menudo solo cargaría la BD |
| F6.14 | **Volver a analizar** borra los acordes automáticos y **conserva los editados** (`chords.edited = true`). Los nuevos se recortan para no pisar ningún tramo editado (`Chord::freeRanges`) | Pedido: "las correcciones NO se pierden si vuelvo a analizar". Recortar evita dos acordes en el mismo momento |
| F6.15 | Corregir un acorde cambia solo su **nombre**, no sus tiempos. Se valida con una expresión de notación de guitarrista: raíz con #/b, tipos habituales y bajo opcional (`C/G`), o `N` | Es la corrección más útil y la más simple de usar. La validación impide guardar texto arbitrario |
| F6.16 | Estado del análisis en columnas de `songs`: `chords_status`, `chords_progress`, `chords_model`, `chords_key`, `chords_error`, `chords_started_at` y `chords_finished_at`. `chords_status = null` significa que nunca se analizó | Pedido explícito: estado, porcentaje, modelo, tonalidad y error. Con `null` el comando `acordes:analizar` sabe qué canciones antiguas faltan |
| F6.17 | Al abrir el mezclador, los acordes y la tonalidad van **en las props de Inertia**, leídos de la BD | Salen al instante y no se vuelve a analizar nada. Solo se consulta `GET /songs/{id}/chords` mientras el análisis está en marcha |
| F6.18 | No se puede borrar una canción mientras se **analizan** sus acordes (409). Si aun así desaparece, el job lo detecta y detiene el motor | El análisis dura unos 6 s; esperar es más simple y seguro que borrar con el motor leyendo los archivos |
| F6.19 | Rutas del motor en el `.env` (`CHORDS_PYTHON`, `CHORDS_SCRIPT`, `CHORDS_MODELS_DIR`, `CHORDS_MODEL`, `CHORDS_TIMEOUT`). Si están vacías, se usan las de `tools/acordes` del proyecto | Funciona sin configurar nada, y se puede mover el motor a otra carpeta |
| F6.20 | `iniciar.bat` abre **dos ventanas** con títulos claros ("1 SEPARACION de pistas" y "2 ACORDES"). Cada una se reinicia sola si su worker se cierra | Pedido explícito. Es el mismo archivo con un argumento interno, así no hay dos `.bat` que mantener |
| F6.21 | **Formas de onda precalculadas** en `tracks.peaks`: 4000 picos de 0 a 255 en base64 (unos 5,3 KB por pista). Las calcula `SeparateSong` con ffmpeg a 8 kHz, leyendo por trozos, en unos 0,6 s por pista. `php artisan ondas:calcular` hace lo mismo con las pistas antiguas | El mezclador dibuja las ondas en cuanto abre la página, antes de descargar el audio, y no recorre millones de muestras en el navegador. Si falta (null), el mezclador la calcula como antes |
| F6.22 | Los tests usan un **motor falso en PHP** (`tests/Fixtures/fake_chords_*.php`) que imprime los mismos eventos JSON, e incluye una línea partida en dos escrituras. `phpunit.xml` apunta `CHORDS_PYTHON` a una ruta inexistente | Se prueba el job de verdad (lectura en vivo, inserciones, recortes y errores) sin Python ni GPU, y ningún test puede lanzar el motor real |
