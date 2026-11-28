# ACR Audio

Plataforma web **local** para separar canciones en pistas (voz, batería, bajo, guitarra, piano y otros) con inteligencia artificial usando tu GPU, y escucharlas en un mezclador donde puedes silenciar, dejar solo o bajar el volumen de cada pista y programar silencios por tiempo. Además **reconoce los acordes** de cada canción (con la tonalidad) y los muestra sincronizados mientras suena. Todo se guarda en la base de datos y cada usuario ve solo sus canciones.

- **Backend:** Laravel 12 (PHP 8.3), MySQL y una cola de trabajos en base de datos.
- **Frontend:** React + Inertia + TypeScript + Tailwind (starter kit oficial de Laravel).
- **Motor de separación:** [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) con el modelo `htdemucs_6s`, que se ejecuta fuera del proyecto.
- **Motor de acordes:** [BTC](https://github.com/jayg996/BTC-ISMIR19) (Bi-directional Transformer for Chord recognition), en `tools/acordes/` con su propio entorno de Python.

---

## 1. Requisitos

| Programa | Para qué | Versión probada |
|---|---|---|
| [Laravel Herd](https://herd.laravel.com/windows) | Sirve la web (PHP + nginx) en `http://acr_audio.test` | 2.2 (PHP 8.3) |
| MySQL | Base de datos | 8.0 |
| [Node.js](https://nodejs.org/) | Compilar el frontend | 26 |
| [Composer](https://getcomposer.org/) | Dependencias PHP (viene con Herd) | 2.11 |
| audio-separator en su propio entorno de Python | Separar pistas con la GPU | 0.48.0 (torch 2.11 + CUDA 12.8) |
| [Python 3.12](https://www.python.org/) | Motor de acordes (`tools/acordes`, entorno propio) | 3.12.10 |
| ffmpeg en el PATH | audio-separator lo usa para leer y escribir audio | 9.1 |
| GPU NVIDIA con driver actualizado | Acelerar la separación | RTX 5060 Ti 16 GB |

## 2. Instalación desde cero

Abre una terminal (PowerShell) en la carpeta del proyecto (`D:\github\ACR_audio`) y ejecuta, en orden:

```powershell
# 1) Dependencias PHP y JavaScript
composer install
npm install

# 2) Archivo de configuración
copy .env.example .env
php artisan key:generate
```

3) Abre `.env` con un editor y revisa:
   - `DB_DATABASE`, `DB_USERNAME` y `DB_PASSWORD` de tu MySQL.
   - `SEPARATOR_BIN` y `SEPARATOR_MODELS_DIR`: rutas a `audio-separator.exe` y a la carpeta de modelos, **entre comillas simples**.
   - `AUDIO_STORAGE_PATH`: déjalo vacío para guardar los audios en `storage/app/private/audio`.

```powershell
# 4) Crear la base de datos (si no existe) y las tablas
php artisan tinker --execute="config(['database.connections.mysql.database' => null]); DB::purge('mysql'); DB::statement('CREATE DATABASE IF NOT EXISTS audio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');"
php artisan migrate

# 5) Compilar el frontend
npm run build

# 6) Crear tu usuario (el registro público está desactivado)
php artisan usuario:crear --nombre="Tu nombre" --email=tu@correo.test --generar
```

```powershell
# 7) Motor de acordes: crea tools\acordes\.venv, instala torch con CUDA 12.8
#    (unos 3 GB) y descarga los modelos de BTC (12 MB cada uno)
tools\acordes\instalar.bat
```

El comando del paso 6 muestra **una sola vez** una contraseña generada al azar. Guárdala y cámbiala luego en *Configuración → Contraseña*. Si prefieres escribirla tú, quita `--generar` y el comando te la pedirá (mínimo 12 caracteres, con letras y números).

### Límites de subida de PHP (Herd)

Por defecto PHP solo acepta archivos de 2 MB. En `C:\Users\<tu usuario>\.config\herd\bin\php83\php.ini` deben estar:

```ini
upload_max_filesize = 256M
post_max_size = 260M
```

Además, nginx (el servidor web de Herd) tiene su propio límite. En `C:\Users\<tu usuario>\.config\herd\config\nginx\herd.conf` debe estar:

```nginx
client_max_body_size 260M;
```

Sin esto, los archivos de más de 128 MB fallan con el error *413 Request Entity Too Large*. Si cambias el tamaño máximo de subida desde la ventana de Herd, Herd puede reescribir este archivo: revisa que el valor siga siendo 260M o más.

Después reinicia Herd: en una terminal escribe `herd restart`, o en la ventana de Herd pulsa **Stop all** y luego **Start all**.

## 3. Cómo arrancarla

1. Herd debe estar abierto (icono en la bandeja del sistema).
2. Haz doble clic en **`iniciar.bat`** (en la carpeta del proyecto). Se abren **dos ventanas negras**; **déjalas abiertas las dos** mientras uses ACR Audio:
   - **"ACR Audio - 1 SEPARACION de pistas"**: separa las canciones con la GPU, de una en una.
   - **"ACR Audio - 2 ACORDES"**: reconoce los acordes de cada canción en cuanto termina de separarse, en paralelo a la separación de la siguiente.

   Si cierras alguna, lo pendiente se queda "En cola" sin perderse y se procesa cuando vuelvas a abrir `iniciar.bat`.
3. Entra en **http://acr_audio.test** e inicia sesión. Marca **Recordarme** para no tener que volver a entrar aunque cierres el navegador.

## 4. Cómo usarla

1. Ve a **Canciones** en el menú.
2. **Arrastra** una o varias canciones (MP3, WAV, FLAC, M4A u OGG, hasta 250 MB cada una) a la zona punteada, o haz clic en ella para elegirlas. Cada archivo muestra su barra de subida. Si ya tienes una canción con el mismo nombre y tamaño, te pregunta antes de subirla otra vez (*Omitir* o *Subir de todos modos*).
3. Aparece una ventana que pregunta qué hacer con esos archivos (la elección vale para todos):
   - **Separar pistas**: sube y separa voz, batería, bajo, guitarra, piano y otros con la GPU. Una canción de 4 minutos tarda unos 25 segundos con la RTX 5060 Ti.
   - **Solo subir**: guarda la canción tal cual, sin separar (útil para backing tracks). Se puede separar más tarde.
   - **Detectar acordes**: interruptor que viene marcado según tu preferencia general y que puedes cambiar solo para esta subida.
   - **Recordar y no volver a preguntar**: las próximas subidas usan esa elección directamente. Para que vuelva a preguntar: Configuración → Preferencias → «Al subir canciones: Preguntar cada vez».
   - Con el teclado: **Enter** elige la opción resaltada y **Esc** cancela la subida.
4. Cada fila muestra dos etiquetas: la separación (**Separada**, **Original**, **En cola para separar**, **Separando 45 %**…) y los acordes (**Acordes · B menor**, **Acordes tras separar**, **Acordes 40 %**…). Si aparece **Error**, pulsa **Ver log** para ver el motivo o **Reintentar** para volver a intentarlo.
   - Mientras una canción está **En cola** o **Procesando** puedes pulsar **Cancelar**: se detiene la separación de verdad y se borra lo que llevaba hecho. Queda como **Cancelada**, y luego puedes **Reintentar** o borrarla.
   - Si una separación se cuelga (más de 3 minutos sin avanzar) o se cierra la ventana de `iniciar.bat` a mitad, la canción pasa sola a **Error** en menos de un minuto y la cola sigue con la siguiente.
5. Si una canción se queda mucho rato "En cola", comprueba que la ventana de `iniciar.bat` está abierta.
6. Pulsa **Abrir mezclador** (cualquier canción se puede abrir). Si no está separada, verás una sola pista, **Original**, y un botón **Separar pistas**. Si está separada, verás sus pistas, y con **Mostrar la pista original para comparar** aparece también la Original. Las pistas se cargan solas y luego puedes:
   - **▶** reproducir o pausar (o la barra espaciadora), y **⏮** volver al inicio.
   - **M** para silenciar una pista y **S** para escuchar solo esa (puedes combinar varias S). También el control de volumen de cada pista y el volumen general.
   - **Clic** sobre una onda para saltar a ese momento.
   - **Arrastrar** sobre una onda para programar un silencio en esa pista. También puedes escribir los tiempos en "Silencios programados"; el botón *Ahora* pone el momento actual. La × de cada silencio lo quita.
   - Teclas **1** a **9** para silenciar cada pista e **Inicio** para volver al principio.
7. **No hay botón de guardar**: todo se guarda solo. Arriba a la derecha verás "Guardando…" y luego "Guardado". La próxima vez que abras la canción estará igual que la dejaste.
8. El botón **⬇** de cada pista la descarga en FLAC (por ejemplo `Mi canción - Voz.flac`).

### Acordes

Los acordes se detectan si así lo eliges al subir o con el interruptor **«Detectar acordes automáticamente en canciones nuevas»** (arriba en Canciones y en Preferencias):
- **Con las pistas separadas** (guitarra, bajo, piano y otros, sin batería ni voz) si la canción se separa. En ese caso esperan a que termine la separación.
- **Con el audio original** si elegiste «Solo subir».

Una canción de 5 minutos tarda **unos 7 segundos**. La primera vez tras encender el PC puede tardar medio minuto más.

Para detectarlos después:
- **Detectar acordes** en el menú **⋯** de la canción o en el mezclador (la fila de acordes vacía muestra el botón).
- **Detectar acordes en las que no tienen**, arriba de la lista, las pone todas en cola.
- **Mejorar acordes con pistas separadas** aparece si se detectaron sobre el original y luego separaste la canción. Tus correcciones a mano se conservan.

Mientras se analizan puedes **Cancelar**. En el mezclador verás:

- **Arriba, junto al reloj**, el acorde que suena ahora (grande) y el siguiente (más pequeño).
- **Encima de las pistas**, la fila de acordes de toda la canción, alineada con la línea de tiempo. Debajo, una **vista ampliada** de unos 20 segundos que se mueve mientras suena, con los nombres en grande.
- La **tonalidad** detectada (por ejemplo, "B menor").
- **Mientras se analiza**, los acordes ya detectados aparecen enseguida y el resto se ve rayado con "Analizando… %".
- **Clic** en un acorde: la canción salta a ese momento.
- **Doble clic o clic derecho** en un acorde: puedes **corregirlo** (por ejemplo `Bm`, `F#m7`, `Dmaj7`, `Bsus4`, `C/G`, o `N` si no suena ningún acorde). Los corregidos llevan un punto azul y **se conservan** aunque vuelvas a analizar.
- **Hoja de acordes**: botón *Mostrar hoja*, con todos los acordes en orden y el actual resaltado mientras suena.
- **Volver a analizar**: repite el análisis (pide confirmación). Tus correcciones no se pierden.

Los acordes quedan guardados: la próxima vez que abras la canción salen de la base de datos al instante, sin volver a analizar.

### Organizar tus canciones

- **Carpetas** (barra de la izquierda; en el móvil, botón «Carpetas»):
  - **+ Carpeta** crea «Nueva carpeta» con el nombre listo para escribir encima. Si tienes una carpeta abierta, la crea dentro. Admite hasta 3 niveles, por ejemplo *Metal › Satriani › Surfing*.
  - **Clic derecho** en una carpeta: renombrar, nueva subcarpeta, color (8 colores), nota (por ejemplo «afinación Eb»), mover a… y borrar.
  - **Arrastrar** una carpeta encima de otra la mete dentro; soltarla entre dos carpetas la reordena.
  - **Borrar una carpeta no borra sus canciones**: pasan a la carpeta superior o a «Sin carpeta». Se puede deshacer.
  - Si subes canciones con una carpeta abierta, se guardan ahí. En la ventana de subida puedes cambiar el destino.
- **Mover canciones:** arrástralas hasta una carpeta del árbol (si hay varias seleccionadas, se mueven todas) o usa **Mover a…** (clic derecho, menú ⋯ o barra de selección), con buscador.
- **Seleccionar varias:** Ctrl + clic, Mayús + clic (rango), la casilla de cada fila o Ctrl + A. Aparece una barra con *Mover a…*, *Separar*, *Detectar acordes* y *Borrar*.
- **Renombrar en el sitio:** doble clic (o F2) sobre el nombre de una canción, carpeta o pista del mezclador. Enter guarda, Esc cancela y hacer clic fuera también guarda. Si dejas vacía una pista del mezclador, recupera su nombre original.
- **Clic derecho** en una canción: abrir, renombrar, mover a…, separar, detectar acordes, descargar el original y borrar.
- **Deshacer:** tras mover, renombrar o borrar aparece abajo un aviso con **Deshacer**. También **Ctrl + Z**. Las canciones borradas se pueden recuperar durante un minuto.
- **Atajos de teclado** (pulsa **?** para verlos): F2 renombrar, Supr borrar, Ctrl + A seleccionar todo, Enter abrir en el mezclador, ↑ ↓ moverse, Ctrl + Z deshacer y Esc quitar la selección.
- **Buscar:** busca en **todas las carpetas** e indica en cuál está cada canción. No importan las tildes ni las mayúsculas.
- **Ordenar:** más recientes, por título o por estado. Se recuerda.
- **Filtrar:** Todas, Separadas, Solo original, Con acordes o Sin acordes, dentro de la carpeta abierta.
- **Separar pistas** de una canción subida con «Solo subir»: botón **⋯** → *Separar pistas*.
- **Borrar:** pide confirmación y elimina el archivo original, las pistas y los ajustes. No se puede borrar una canción mientras se está separando: cancélala primero.

### Preferencias

En **tu nombre (abajo a la izquierda) → Configuración → Preferencias** puedes elegir:
- qué hacer al subir canciones (preguntar cada vez, separar siempre o solo subir siempre)
- si detectar acordes automáticamente en las canciones nuevas
- el modelo de separación (solo aparecen los descargados)
- el orden de la lista
- el volumen general del mezclador
- si quieres atajos de teclado

En **Contraseña** puedes cambiar tu contraseña.

> Si cambias el código del proyecto, cierra las dos ventanas y vuelve a abrir `iniciar.bat` para que los workers usen la versión nueva.

## 5. Comandos útiles

| Comando | Qué hace |
|---|---|
| `php artisan usuario:crear` | Crea un usuario y pide los datos |
| `php artisan test` | Ejecuta los tests automáticos (usan una base temporal en memoria, no tocan tus datos) |
| `npm run build` | Vuelve a compilar el frontend tras cambiar archivos de `resources/js` |
| `php artisan migrate` | Aplica migraciones nuevas sin borrar datos |
| `php artisan acordes:analizar` | Encola el análisis de acordes de las canciones separadas que nunca se analizaron. Con un id (`acordes:analizar 7`) analiza esa canción; con `--todas`, todas |
| `php artisan ondas:calcular` | Precalcula la forma de onda de las pistas que no la tienen (`--todas` para recalcularlas todas) |

## 6. Más documentación

- `ARQUITECTURA.md`: estructura, tablas, cola, almacenamiento y cómo se sirven los audios.
- `DECISIONES.md`: qué se decidió y por qué.
- `PROGRESO.md`: qué está hecho, qué falta y problemas conocidos.
- `INVENTARIO_LIMPIEZA.md`: qué se quitó de la app anterior.
