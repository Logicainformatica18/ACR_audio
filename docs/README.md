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

Después reinicia Herd: en una terminal escribe `herd restart`, o en la ventana de Herd pulsa **Stop all** y luego **Start all**.

## 3. Cómo arrancarla

1. Herd debe estar abierto (icono en la bandeja del sistema).
2. Entra en **http://acr_audio.test** e inicia sesión. Marca **Recordarme** para no tener que volver a entrar aunque cierres el navegador.

> Las fases siguientes añaden la subida de canciones, la separación (con `iniciar.bat`) y el mezclador. Ver `PROGRESO.md`.

## 4. Comandos útiles

| Comando | Qué hace |
|---|---|
| `php artisan usuario:crear` | Crea un usuario y pide los datos |
| `php artisan test` | Ejecuta los tests automáticos (usan una base temporal en memoria, no tocan tus datos) |
| `npm run build` | Vuelve a compilar el frontend tras cambiar archivos de `resources/js` |
| `php artisan migrate` | Aplica migraciones nuevas sin borrar datos |

## 5. Más documentación

- `ARQUITECTURA.md`: estructura, tablas, cola, almacenamiento y cómo se sirven los audios.
- `DECISIONES.md`: qué se decidió y por qué.
- `PROGRESO.md`: qué está hecho, qué falta y problemas conocidos.
- `INVENTARIO_LIMPIEZA.md`: qué se quitó de la app anterior.
