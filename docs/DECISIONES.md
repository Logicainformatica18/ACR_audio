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
