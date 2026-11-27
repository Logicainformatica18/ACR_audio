# Inventario de limpieza — de la app de citas a ACR Audio

> **Estado:** ✅ ejecutado el 26/11/2026. Diferencias con lo planeado:
> - `config/services.php` no se tocó (era el estándar de Laravel).
> - `CustomResetPasswordNotification.php` se eliminó; su texto pasó a `AppServiceProvider` (ver `DECISIONES.md`, L5).
> - Los puntos abiertos de la sección 4 se resolvieron: los workflows se eliminaron, `recharts` se quitó y se usa el logo genérico del starter kit.
> Fecha del inventario: 26/11/2026 · Rama: `main` · Último commit: `f25ea86`

Este documento lista todo lo que se **eliminará**, se **editará** o se **conservará** al quitar la app de citas (Aybar) y dejar solo la base del starter kit React + Inertia para ACR Audio.

Cómo se hará la limpieza:
- Los archivos se borrarán con `git rm`. El borrado queda registrado en git y cualquier archivo se puede recuperar desde el historial.
- La app de citas original sigue completa en GitHub, en el repositorio `Logicainformatica18/citas_websocket`.

---

## 1. Se ELIMINA

### 1.1 Modelos — `app/Models/` (17)
| | | |
|---|---|---|
| `AppointmentType.php` | `Area.php` | `Article.php` |
| `ChatMessage.php` | `Client.php` | `Comment.php` |
| `ExternalState.php` | `InternalState.php` | `Motive.php` |
| `Product.php` | `Project.php` | `Sale.php` |
| `Support.php` | `SupportDetail.php` | `Transfer.php` |
| `Type.php` | `WaitingDay.php` | |

Se conserva `User.php`, con cambios (ver sección 2).

### 1.2 Controladores — `app/Http/Controllers/` (22)
`AppointmentTypeController`, `AreaController`, `ArticleController`, `ChatMessageController`, `ClientController`, `CommentController`, `DashboardController`, `ExternalStateController`, `InternalStateController`, `MotiveController`, `ProductController`, `ProjectController`, `ReportController`, `RoleController`, `SaleController`, `SupportController`, `SupportDetailController`, `TransferController`, `TypeController`, `UserController`, `WaitingDayController`, `WebSocketTestController`

Se conservan `Controller.php` y las carpetas `Auth/` y `Settings/`.

### 1.3 Otros archivos de `app/`
| Ruta | Qué era |
|---|---|
| `app/Events/` (completa): `ChatMessageSent.php`, `MessageSent.php`, `RecordChanged.php` | Eventos de websockets (chat y avisos) |
| `app/Exports/` (completa): `ArticlesExport.php`, `SupportExport.php` | Exportación a Excel |
| `app/Mail/TransferNotification.php` | Correo de transferencias |
| `app/Notifications/NewSupportAtcNotification.php` | Aviso de nueva solicitud |
| `app/Http/Requests/Support/` (completa, 4 archivos): `StoreSupportRequest.php`, `UpdateAreaMotivoRequest.php`, `UpdateSupportRequest.php`, `Concerns/ValidatesSupportDetails.php` | Validaciones de solicitudes |
| `app/Services/TicketNumberGenerator.php` | Numeración de tickets |
| `app/Helpers.php` | Funciones globales para fotos y fechas. También se quita su entrada `"files"` del `autoload` en `composer.json` |

### 1.4 Páginas React — `resources/js/pages/`
Carpetas completas (19):
`appointment-types`, `areas`, `articles`, `clients`, `dashboards`, `external-states`, `internal-states`, `motives`, `products`, `projects`, `reports`, `roles`, `sales`, `supports`, `transfers`, `types`, `users`, `waiting-days`

Archivo suelto: `welcome.tsx`. La ruta `/` llevará directamente al panel, o al login si no hay sesión.

### 1.5 Componentes y librerías React — `resources/js/`
| Ruta | Qué era |
|---|---|
| `components/ChatWidget.tsx` | Chat en tiempo real |
| `components/NotificationBell.tsx` | Campana de avisos (websockets) |
| `components/TransferModal.tsx` | Modal de transferencias |
| `components/HourglassLoader.tsx` | Animación de carga de la app vieja |
| `components/LimitedInput.tsx` | Campo con contador (formularios de citas) |
| `components/LimitedTextarea.tsx` | Ídem |
| `lib/echo.ts` | Conexión a Reverb/Echo |
| `lib/echo_bk.tsx` | Copia vieja del anterior |
| `test.tsx` | Archivo de prueba suelto |

### 1.6 Vistas Blade — `resources/views/`
| Ruta | Qué era |
|---|---|
| `ws-test.blade.php` | Página de prueba de websockets |
| `auth/login.blade.php` | Login antiguo en Blade, sin uso (el login real es React) |
| `emails/support_created.blade.php` | Correo de solicitud creada |
| `emails/transfer.blade.php` | Correo de transferencia |

Se conserva `app.blade.php`, la plantilla base de Inertia.

### 1.7 Rutas — `routes/`
| Archivo | Acción |
|---|---|
| `api.php` | Se elimina (API de la app de citas) |
| `channels.php` | Se elimina (canales de websockets) |
| `web.php` | Se **reescribe**: de 232 líneas a unas 10 (`/` → panel y `/dashboard`) |

### 1.8 Migraciones — `database/migrations/` (17)
```
2025_04_22_160409_create_products_table.php
2025_04_22_160410_create_transfers_table.php
2025_04_22_160411_create_articles_table.php
2025_04_23_175129_create_permission_tables.php
2025_05_20_205513_create_personal_access_tokens_table.php
2025_06_16_000001_create_catalog_tables.php
2025_06_16_000002_create_clientes_table.php
2025_06_17_100000_create_supports_table.php
2025_06_17_101000_create_support_details_table.php
2025_07_06_201650_create_sales_table.php
2025_07_13_180601_create_comments_table.php
2025_07_16_173413_add_internal_state_id_to_comments_table.php
2025_07_17_155610_add_channel_to_support_details_table.php
2026_11_22_000001_align_schema_with_models.php
2026_11_22_000002_create_chat_messages_table.php
2026_11_23_000001_create_ticket_sequences_table.php
2026_11_23_000002_add_unique_ticket_to_support_details.php
```
Se conservan las 3 migraciones base `0001_01_01_*`: `users`, `cache` y `jobs`.

### 1.9 Seeders — `database/seeders/`
`ArticleSeeder`, `CatalogSeeder`, `ChatMessageSeeder`, `ClientSeeder`, `DemoUserSeeder`, `PermissionsSeeder`, `ProductSeeder`, `ProjectSeeder`, `SupportSeeder`, `TransferSeeder` y la carpeta `Concerns/` (`OnlyInDemoEnvironments.php`).

`DatabaseSeeder.php` se conserva **vacío**. El usuario se creará con `php artisan usuario:crear` en la Fase 1.

### 1.10 Factories — `database/factories/`
`ArticleFactory`, `ChatMessageFactory`, `ClientFactory`, `CommentFactory`, `SaleFactory`, `SupportDetailFactory`, `SupportFactory`

Se conserva `UserFactory.php`, con cambios.

### 1.11 Tests — `tests/Feature/`
`BugfixesTest`, `RoutePermissionsTest`, `SalesLotsTest`, `SeederEnvironmentTest`, `SupportValidationTest`, `TicketGenerationTest`

`Auth/RegistrationTest.php` no se toca en la limpieza. En la **Fase 1** se sustituye por un test que comprueba que el registro está cerrado.

### 1.12 Configuración — `config/`
| Archivo | Acción |
|---|---|
| `permission.php` | Se elimina (Spatie) |
| `reverb.php` | Se elimina (Reverb) |
| `sanctum.php` | Se elimina (Sanctum) |
| `services.php` | Se editan las entradas de servicios que ya no se usan |

### 1.13 Archivos públicos — `public/` (unos 3.900 archivos, unos 50 MB)
| Ruta | Archivos | Qué era |
|---|---|---|
| `public/assets/` | 3.834 | Plantilla Bootstrap (css, fonts, images, js, libs). Ninguna página React la usa |
| `public/js/` | 25 | Scripts de otra app: cursos, exámenes, buses, inscripciones… |
| `public/logo/` | 24 | Imágenes de la marca Aybar |
| `public/fuente_montserrat/` | 5 | Fuente Montserrat |

Se conservan `index.php`, `.htaccess`, `robots.txt`, `favicon.ico` y `logo.svg`.

### 1.14 Paquetes de Composer
| Paquete | Para qué era |
|---|---|
| `spatie/laravel-permission` | Roles y permisos |
| `laravel/reverb` | Servidor de websockets |
| `pusher/pusher-php-server` | Emisión de eventos a websockets |
| `maatwebsite/excel` | Exportar a Excel |
| `laravel/sanctum` | Tokens para la API de citas. El login web no lo necesita |

Google Cloud Storage **no está instalado como paquete**: solo aparece en el `.env`.

### 1.15 Paquetes de npm
| Paquete | Para qué era |
|---|---|
| `laravel-echo` | Cliente de websockets |
| `@laravel/echo-react` | Echo para React |
| `pusher-js` | Protocolo Pusher/Reverb |
| `socket.io-client` | Websockets alternativos |
| `jquery` | Scripts de la plantilla vieja |
| `datatables.net-dt` | Tablas de la app de citas |
| `recharts` | Gráficos del dashboard de citas |

### 1.16 Variables del `.env` (lo mismo en `.env.example`)
**Se eliminan:**
| Grupo | Variables |
|---|---|
| Websockets | `BROADCAST_DRIVER`, `REVERB_APP_ID`, `REVERB_APP_KEY`, `REVERB_APP_SECRET`, `REVERB_HOST`, `REVERB_PORT`, `REVERB_SCHEME`, `VITE_REVERB_APP_KEY`, `VITE_REVERB_HOST`, `VITE_REVERB_PORT`, `VITE_REVERB_SCHEME` |
| Google Cloud | `GCS_PROJECT_ID`, `GCS_BUCKET`, `GCS_KEY_FILE_PATH` |
| SAML | `SAML_IDP_ACS`, `SAML_IDP_ENTITYID`, `SAML_SP_ENTITYID` |
| OCR | `OCR_API_URL`, `OCR_LANG`, `OCR_IMAGE_ENDPOINT`, `OCR_PDF_ENDPOINT`, `OCR_TIMEOUT` |
| Otros servicios | `OPENAI_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `RECAPTCHA_SECRET_KEY`, `VITE_RECAPTCHA_SITE_KEY` |

**Cambian de valor:**
| Variable | Antes | Después |
|---|---|---|
| `APP_NAME` | `"Isil Scrapping"` | `"ACR Audio"` |
| `APP_URL` | `http://citas_websocket.test` | `http://acr_audio.test` |
| `FILESYSTEM_DISK` | `gcs` | `local` |
| `BROADCAST_CONNECTION` | `reverb` | `log` |

Las variables de base de datos, sesión, cola, caché, correo y logs se mantienen.

---

## 2. Se EDITA (se conserva, pero se limpia)

| Archivo | Cambio |
|---|---|
| `app/Models/User.php` | Se quitan `HasRoles` (Spatie) y `HasApiTokens` (Sanctum), y los campos `dni`, `firstname`, `lastname`, `names`, `datebirth`, `cellphone`, `photo`, `sex`, `google_id`, `fb`, `github`, `portfolio`, `youtube` e `instagram`. Quedan `name`, `email` y `password` |
| `database/migrations/0001_01_01_000000_create_users_table.php` | Vuelve a la tabla estándar con columna `name`. **Hoy está rota:** la tabla tiene `firstname`/`lastname`/`names`, pero la página de perfil (`settings/profile.tsx`) y su validación usan `name` |
| `database/factories/UserFactory.php` | Usa `name` |
| `resources/js/components/user-info.tsx` | Usa `user.name` en lugar de `firstname`/`lastname`/`names`/`photo` |
| `resources/js/types/index.d.ts` | Tipo `User` acorde a la tabla nueva |
| `app/Http/Middleware/HandleInertiaRequests.php` | Deja de cargar y enviar `roles` y `permissions` a React |
| `bootstrap/app.php` | Se quitan los `use` y alias de Spatie (`role`, `permission`, `role_or_permission`) y la línea `api: routes/api.php` |
| `resources/js/components/app-sidebar.tsx` | Menú nuevo sin permisos. Por ahora solo **Panel** (Canciones llega en la Fase 2) |
| `resources/js/components/app-header.tsx` / `app-sidebar-header.tsx` | Se quita la campana de avisos si aparece |
| `resources/js/components/app-logo-icon.tsx` | Ícono SVG propio de "onda de audio" en lugar de `/logo/1.png` |
| `resources/js/components/app-logo.tsx` | Texto "ACR Audio" |
| `resources/js/pages/auth/login.tsx` | Sin fondo `/logo/f_login.png` ni logo de Aybar; diseño limpio. **Se mantiene "Recordarme"** |
| `resources/js/pages/auth/forgot-password.tsx` | Sin logo de Aybar |
| `app/Notifications/CustomResetPasswordNotification.php` | Se conserva (correo en español para recuperar contraseña). Se cambia "Aybar Corp" por "ACR Audio" y se arreglan las tildes rotas (`contraseÃ±a` → `contraseña`) |
| `resources/js/layouts/app-layout.tsx` | Sin cambios funcionales. Se mantiene `sonner` (avisos tipo toast) |
| `resources/js/pages/dashboard.tsx` | Panel simple de bienvenida |
| `routes/web.php` | Reescrito (ver 1.7) |
| `database/seeders/DatabaseSeeder.php` | Vacío |
| `config/services.php` | Sin entradas de servicios que no se usan |
| `composer.json` / `composer.lock` | Sin los paquetes de 1.14 ni el `autoload.files` de `Helpers.php` |
| `package.json` / `package-lock.json` | Sin los paquetes de 1.15 |
| `.env` / `.env.example` | Según 1.16 |

---

## 3. Se CONSERVA sin cambios

**Autenticación y ajustes**
- `app/Http/Controllers/Auth/*` (8 controladores: login, logout, recuperar contraseña, confirmar contraseña, verificación de correo y registro)
- `app/Http/Controllers/Settings/*` (perfil y cambio de contraseña)
- `app/Http/Requests/Auth/LoginRequest.php`, con "Recordarme"
- `app/Http/Requests/Settings/ProfileUpdateRequest.php`
- `routes/auth.php` y `routes/settings.php`
- `routes/console.php`
- `resources/js/pages/auth/*` (salvo los cambios visuales de la sección 2) y `resources/js/pages/settings/*`

**Base del starter kit**
- `app/Http/Middleware/HandleAppearance.php` y `TrustProxies.php`
- `app/Providers/AppServiceProvider.php`
- `resources/js/components/ui/*` (componentes shadcn)
- `resources/js/layouts/*`, `resources/js/hooks/*`, `resources/js/lib/utils.ts`
- Los demás componentes base: `app-content`, `app-shell`, `breadcrumbs`, `nav-*`, `user-menu-content`, `delete-user`, `heading*`, `icon`, `input-error`, `text-link`, `appearance-*`
- `resources/js/app.tsx`, `ssr.tsx`, `resources/css/app.css`, `resources/views/app.blade.php`

**Configuración y herramientas**
- `config/`: `app`, `auth`, `cache`, `database`, `filesystems`, `inertia`, `logging`, `mail`, `queue` y `session`
- `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.gitattributes`, `components.json` y `phpunit.xml`
- `.github/workflows/lint.yml` y `tests.yml` (lint y tests automáticos en GitHub)

**Base de datos**
- Migraciones `0001_01_01_000001_create_cache_table.php` y `0001_01_01_000002_create_jobs_table.php` (la cola de separación usará `jobs`)

**Tests**
- `tests/TestCase.php`, `tests/Unit/ExampleTest.php`
- `tests/Feature/DashboardTest.php`
- `tests/Feature/Auth/*` (salvo `RegistrationTest`, que cambia en la Fase 1)
- `tests/Feature/Settings/*`

**Archivos públicos**
- `public/index.php`, `public/.htaccess`, `public/robots.txt`, `public/favicon.ico` y `public/logo.svg`

---

## 4. Puntos abiertos para decidir

- [ ] ¿Conservar `.github/workflows/`? Ahora mismo se conservan.
- [ ] ¿Conservar `recharts` por si en el futuro se quieren gráficos? Ahora mismo se elimina.
- [ ] ¿Algún archivo de `public/logo/` que quieras mantener? Ahora mismo se eliminan todos.
- [ ] Confirmación final para ejecutar la limpieza (Paso A, punto 2).
