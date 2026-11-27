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
