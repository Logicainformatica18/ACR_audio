# ACR Audio

Plataforma web **local** para separar canciones en pistas (voz, batería, bajo, guitarra, piano y otros) con inteligencia artificial usando tu GPU, y escucharlas en un mezclador donde puedes silenciar, dejar solo o bajar el volumen de cada pista y programar silencios por tiempo. Todo se guarda en la base de datos y cada usuario ve solo sus canciones.

- **Backend:** Laravel 12 (PHP 8.3), MySQL y una cola de trabajos en base de datos.
- **Frontend:** React + Inertia + TypeScript + Tailwind (starter kit oficial de Laravel).
- **Motor de separación:** [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) con el modelo `htdemucs_6s`, que se ejecuta fuera del proyecto.

---

## 1. Requisitos

| Programa | Para qué | Versión probada |
|---|---|---|
| [Laravel Herd](https://herd.laravel.com/windows) | Sirve la web (PHP + nginx) en `http://acr_audio.test` | 2.2 (PHP 8.3) |
| MySQL | Base de datos | 8.0 |
| [Node.js](https://nodejs.org/) | Compilar el frontend | 26 |
| [Composer](https://getcomposer.org/) | Dependencias PHP (viene con Herd) | 2.11 |
| audio-separator en su propio entorno de Python | Separar pistas con la GPU | 0.48.0 (torch 2.11 + CUDA 12.8) |
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

El último comando muestra **una sola vez** una contraseña generada al azar. Guárdala y cámbiala luego en *Configuración → Contraseña*. Si prefieres escribirla tú, quita `--generar` y el comando te la pedirá (mínimo 12 caracteres, con letras y números).

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
2. Haz doble clic en **`iniciar.bat`** (en la carpeta del proyecto). Se abre una ventana negra: **déjala abierta** mientras uses ACR Audio. Es la que separa las canciones con la GPU, de una en una. Si la cierras, las canciones nuevas se quedan "En cola" sin perderse, y se procesan cuando la vuelvas a abrir.
3. Entra en **http://acr_audio.test** e inicia sesión. Marca **Recordarme** para no tener que volver a entrar aunque cierres el navegador.

## 4. Cómo usarla

1. Ve a **Canciones** en el menú.
2. **Arrastra** una o varias canciones (MP3, WAV, FLAC, M4A u OGG, hasta 250 MB cada una) a la zona punteada, o haz clic en ella para elegirlas. Cada archivo muestra su barra de subida.
3. Cada canción pasa por **En cola → Procesando (con %) → Lista**. Una canción de 4 minutos tarda unos 25 segundos con la RTX 5060 Ti.
4. Si aparece **Error**, pulsa **Ver log** para ver el motivo o **Reintentar** para volver a intentarlo.
5. Si una canción se queda mucho rato "En cola", comprueba que la ventana de `iniciar.bat` está abierta.
6. Cuando esté **Lista**, pulsa **Abrir mezclador**. Las pistas se cargan solas y luego puedes:
   - **▶** reproducir o pausar (o la barra espaciadora), y **⏮** volver al inicio.
   - **M** para silenciar una pista y **S** para escuchar solo esa (puedes combinar varias S). También el control de volumen de cada pista y el volumen general.
   - **Clic** sobre una onda para saltar a ese momento.
   - **Arrastrar** sobre una onda para programar un silencio en esa pista. También puedes escribir los tiempos en "Silencios programados"; el botón *Ahora* pone el momento actual. La × de cada silencio lo quita.
   - Teclas **1** a **9** para silenciar cada pista e **Inicio** para volver al principio.
7. **No hay botón de guardar**: todo se guarda solo. Arriba a la derecha verás "Guardando…" y luego "Guardado". La próxima vez que abras la canción estará igual que la dejaste.

> Si cambias el código del proyecto, cierra y vuelve a abrir `iniciar.bat` para que el worker use la versión nueva.

## 5. Comandos útiles

| Comando | Qué hace |
|---|---|
| `php artisan usuario:crear` | Crea un usuario y pide los datos |
| `php artisan test` | Ejecuta los tests automáticos (usan una base temporal en memoria, no tocan tus datos) |
| `npm run build` | Vuelve a compilar el frontend tras cambiar archivos de `resources/js` |
| `php artisan migrate` | Aplica migraciones nuevas sin borrar datos |

## 6. Más documentación

- `ARQUITECTURA.md`: estructura, tablas, cola, almacenamiento y cómo se sirven los audios.
- `DECISIONES.md`: qué se decidió y por qué.
- `PROGRESO.md`: qué está hecho, qué falta y problemas conocidos.
- `INVENTARIO_LIMPIEZA.md`: qué se quitó de la app anterior.
