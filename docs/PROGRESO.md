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

## Problemas conocidos / pendientes

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
