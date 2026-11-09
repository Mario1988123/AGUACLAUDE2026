# Plan: Hidromanager en App Store y Google Play

- **Fecha**: 2026-11-09
- **Estado**: propuesta para decisión de Mario. No se ha tocado código.
- **Base**: lectura del repo (tres exploraciones en paralelo: dispositivo, auth/PWA/push, pantallas de campo) y verificación externa de los requisitos de tiendas. Lo que no he podido confirmar va marcado como **A VERIFICAR**. Las fuentes están al final.

---

## 0. Resumen ejecutivo

**Recomendación: opción D, "híbrida progresiva"**: sanear la PWA que ya existe (fase 1) y envolver la web actual con **Capacitor** cargando `crm.hidromanager.es` dentro de la app (fases 2-4), añadiendo solo los plugins nativos que la web no puede dar (push por FCM/APNs, enlaces profundos, ciclo de vida, bloqueo biométrico). El modo sin conexión mínimo para técnicos va en una fase posterior (v1.1) y se adelanta solo si Apple rechaza la app por "solo es una web" (guía 4.2).

Por qué esta y no otra:

1. **La arquitectura lo decide.** El CRM es Next.js App Router con RSC y ~1.000 Server Actions, con la sesión en cookies de `@supabase/ssr`. No se puede exportar estático: una app nativa o bien **muestra la web remota** (Capacitor, opción B) o bien **reescribe las pantallas contra una API nueva** (Expo, opción C). Lo segundo son meses y dos bases de código para un solo desarrollador.
2. **Lo que falta en el móvil hoy no es la interfaz, es el canal.** La web ya usa GPS, cámara, firma, mapas, llamada y WhatsApp, y todo eso funciona dentro de un webview. Lo que está **muerto** son las notificaciones push (el service worker está apagado con un kill-switch) y, en iOS, el push web solo funciona si el usuario instala la web en la pantalla de inicio. Capacitor da push nativo fiable en ambas plataformas sin tocar las 119 páginas.
3. **Mantenimiento asumible con un solo desarrollador + IA.** El 100 % del producto sigue desplegándose en Vercel sin pasar por las tiendas; la cáscara nativa solo se recompila cuando cambian plugins o lo exige la tienda (una o dos veces al año).
4. **El riesgo real es la guía 4.2 de Apple**, y se gestiona: cuenta demo, push nativo, enlaces profundos, bloqueo biométrico y un plan B escrito (fase 5 adelantada) si hay rechazo. En Google Play el riesgo es bajo si la cuenta es de organización.

Estimación v1.0 (fases 0-4): **25-39 días de trabajo efectivo** más **2-5 semanas de espera** (D-U-N-S, revisiones, beta). Fase 5 (offline mínimo): 15-25 días más.

Lo que necesita Mario antes de empezar: cuenta Apple Developer de la empresa (99 USD/año), cuenta Google Play de organización (25 USD una vez, **A VERIFICAR**), número D-U-N-S de la empresa (gratis, tarda), **acceso a un Mac** (no hay build de iOS sin macOS), proyecto Firebase, política de privacidad publicada, y 3-5 técnicos reales para la beta.

---

## 1. Lo que hay hoy (verificado en el repo)

### 1.1 PWA

| Pieza | Estado | Dónde |
|---|---|---|
| Manifest | Sí. `display: standalone`, `start_url: /`, `theme_color #0B4F8A`, idioma `es-ES` | `public/manifest.webmanifest` |
| Iconos | **Solo SVG** (`icon.svg`, `maskable.svg`). No hay PNG 192/512 ni apple-touch-icon PNG; iOS no los usa bien | `public/icons/` |
| Meta Apple | `appleWebApp.capable: true`, `statusBarStyle: default`, icono apple en SVG; `viewportFit: cover`, `userScalable: false` | `src/app/layout.tsx:15-39` |
| Service worker | **Apagado desde 2026-06-13** (`disable: true` en Serwist). `public/sw.js` es un kill-switch que borra cachés y se desregistra; `sw-register.tsx` desregistra cualquier SW en cada carga. Motivo: `cacheOnNavigation` servía listas viejas tras mutaciones | `next.config.ts:4-16`, `public/sw.js`, `src/shared/components/sw-register.tsx` |
| Código del SW | Completo (precache, fallback `/sin-conexion`, `push`, `notificationclick`) pero no se compila. Referencia `/icons/icon-192.svg`, que no existe; título por defecto "AGUA CRM" | `src/app/sw.ts` |
| Página offline | Estática, promete "acciones pendientes" que no existen | `src/app/sin-conexion/page.tsx` |
| Instalación | No hay `beforeinstallprompt`, ni detección de `display-mode: standalone`, ni ningún `matchMedia` | — |
| Offline | **Ninguno.** Decisión registrada el 2026-05-01: *online-only*. `react-query` y `zustand` están en `package.json` pero nadie los importa. Sin IndexedDB, sin `navigator.onLine`, sin colas | `docs/PROJECT_MEMORY.md:64` |
| Residuo | `public/swe-worker-f61931bc2770d10b.js` | — |

### 1.2 Push y notificaciones

- **Infraestructura completa**: tabla `push_subscriptions` (RLS por usuario), `registerPushSubscriptionAction`, envío con `web-push` y VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`), borrado de suscripciones caducadas (404/410). `src/modules/notifications/push-send.ts`, `push-actions.ts`.
- **Disparo**: `notify()` y `notifyByRoles()` (`notifier.ts`) insertan en `notifications` y hacen push **solo si `category === 'alert'`** (fichajes, incidencias, `installation.assigned`, `installation.tomorrow`, `agenda.assigned`, `stock.low`, etc.; `category-of-kind.ts`). Deduplicación de 2 h. Sin cola ni cron: envío en línea.
- **Estado real: muerto.** El botón de suscripción (`push-subscribe-button.tsx`, en `/perfil`) espera `navigator.serviceWorker.ready`, que nunca se resuelve porque no hay SW. Nadie recibe push hoy.
- **Campana**: polling cada 30 s (`notifications-poller.tsx`), no Realtime. Realtime solo en el chat.
- **Chat**: pide permiso de `Notification` al montar y lanza notificación local si la pestaña está oculta; pitido con Web Audio.

### 1.3 Autenticación y sesión

- Cliente de navegador `createBrowserClient` sin opciones → **sesión en cookies** (por defecto de `@supabase/ssr`), no en localStorage. `src/shared/lib/supabase/client.ts`.
- Middleware (`src/middleware.ts` → `shared/lib/supabase/middleware.ts`): refresca con `auth.getUser()`, redirige a `/login?next=` solo en GET, rutas públicas por prefijo (`public-paths.ts`: `/login`, `/recuperar-password`, `/restablecer-password`, `/m/`, `/i/`, `/firmar-contrato`, `/baja`, `/catalogo/`, `/datasheet/`, webhooks, crons…). No añade cabeceras. No hay CSP.
- Login solo con `signInWithPassword`. **No hay** OAuth (Google/Apple), magic link, MFA, "recordarme", ni autorregistro (`enable_signup=false`; contraseña mínima 12). Las cuentas las crea el admin de la empresa con contraseña temporal entregada a mano (`tenant/users/actions.ts:94-242`).
- Recuperar contraseña: `resetPasswordForEmail` con `redirectTo` a `/restablecer-password`; PKCE por defecto → el *verifier* vive en una cookie del navegador que pidió el enlace. **En una app, si el correo se abre en Safari/Chrome y no en el webview, el canje falla** (ver 10).
- Multi-tenant: `company_id`, `roles`, `is_superadmin` como claims del JWT (hook `custom_access_token_hook`); RLS por `app.current_company_id()`. Roles reales: `superadmin`, `company_admin`, `technical_director`, `commercial_director`, `telemarketing_director`, `installer`, `sales_rep`, `telemarketer`.
- **No existe** borrado de cuenta por el propio usuario (solo el admin, `deleteUserPermanentlyAction`). **No existe** página de política de privacidad ni aviso legal en el CRM (la landing tiene anclas rotas `#privacidad`, `#aviso`).
- Cabeceras: HSTS preload, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy: geolocation=(self), camera=(self), microphone=(self)`.

### 1.4 Funciones que dependen del dispositivo

| Capacidad | Dónde se usa | Cómo | En webview (Capacitor) | En PWA |
|---|---|---|---|---|
| **GPS puntual** | Iniciar parte de instalación/retirada (`installation-wizard.tsx:343`, `uninstall-wizard.tsx:85`), fichaje (`punch-page-client.tsx:42`, `time-clock-widget.tsx:63`), chat (compartir ubicación), rutas ("Usar mi GPS"), casa del técnico, alta de lead y direcciones | `getCurrentPosition`, `enableHighAccuracy: true`, `timeout: 7-10 s`, `maximumAge: 0-60 s`. **No hay `watchPosition`** ni seguimiento continuo | Funciona (permiso nativo "mientras se usa"). Opcional: plugin `@capacitor/geolocation` para mejor precisión y última posición conocida | Funciona |
| Validación GPS al instalar | `wizard-actions.ts:40-262`: Haversine servidor contra `addresses.latitude/longitude`; radio `company_settings.installation_geo_tolerance_m` (300 m por defecto, 50-5000). Si se supera, `started_far_from_address = true` y aviso a dirección. **No bloquea** | Servidor | — | — |
| **Cámara / fotos** | Wizard (mín. 1 foto equipo + 1 conexión), retirada, preparación técnica (foto/vídeo ≤30 s, comprimido con canvas y ffmpeg.wasm), foto DNI y fotos de contrato, tickets de gastos (OCR Mindee), chat | `<input type="file" accept="image/*" capture="environment">`; sube por Server Action (10 MB) o `uploadToSignedUrl` directo a Storage. Solo `tech-prep-card` comprime en cliente | Funciona (permiso de cámara nativo) | Funciona |
| Escáner de códigos | Almacenes y producto (`barcode-scanner.tsx`, Html5Qrcode, `getUserMedia`) | Cámara en vivo | Funciona | Funciona |
| **Firma** | Parte (inicio si hay daño/agujero, y final), retirada, contrato (presencial y remota pública), prueba gratuita (2 firmas), mandato SEPA | Canvas propio con pointer events, PNG base64 (en BD o Storage) | Funciona | Funciona |
| **Mapas** | Mi día (clusters, Google Maps JS con fallback Leaflet por CDN), selector de punto, Static Maps y Street View por proxy. Enlaces `google.com/maps/dir` y `/search` | Clave por `/api/maps/client-key` (con sesión) | Funciona; los enlaces externos deben abrirse en la app de Maps (adaptador, ver 6) | Funciona |
| **Llamadas / WhatsApp** | `tel:` y `wa.me` en Mi día, leads, clientes, instalaciones, mantenimientos; `mailto:` | Enlaces | Hay que dejar pasar esos esquemas al sistema (config `allowNavigation` + adaptador) | Funciona |
| **PDF** | 11 rutas `/api/pdf/*` abiertas con `target="_blank"`; previsualización en `<iframe>` (contrato, ficha); `window.print()` | Navegación | **Problema**: en WKWebView el PDF se abre dentro del webview sin barra para volver; en Android WebView no se renderiza. Requiere adaptador (`@capacitor/browser` o compartir/guardar) | iOS Home Screen: abre Safari |
| Micrófono | Notas de voz del chat (`MediaRecorder`, webm, 2 min) | `getUserMedia({audio})` | Funciona (permiso micrófono) | Funciona |
| Realtime | Solo chat (`postgres_changes`) | WebSocket Supabase | Funciona | Funciona |
| Portapapeles, `window.open` | Plantillas WhatsApp, compartir catálogo, etc. | — | `window.open` a otro host → navegador del sistema | — |
| **Push** | Ver 1.2 | Web Push | **Sustituir por FCM/APNs nativo** | Android: sí. iOS: solo instalada en pantalla de inicio |

**No existe**: `watchPosition`, geovalla en fichajes (solo `needs_geo_review` si falta GPS), `navigator.share`, `vibrate`, `wakeLock`, IndexedDB, `navigator.onLine`, `beforeinstallprompt`, código Capacitor/Expo, carpetas `android/` o `ios/`.

### 1.5 Qué se usa de verdad en campo

- **Navegación móvil ya existe**: barra inferior (`bottom-nav.tsx`, `md:hidden`, respeta `safe-area-inset-bottom`, editable por usuario en `/configuracion/menu-movil`), cajón lateral, cabecera con widget de fichaje y campana. Todo responsive con Tailwind; **no hay pantallas específicas de móvil**.
- **Roles de campo**: `installer` (instala y mantiene; no existe "técnico de mantenimiento" aparte) y `sales_rep`. `telemarketer` y directores son de oficina, aunque usan Mi día y fichaje.
- **Pantallas que se ejecutan en el móvil** (10-12):
  - Instalador: **Mi día** (paradas del día, Maps, tel, WhatsApp, ruta), **asistente de instalación** (6 pasos: GPS → estado inicial → cobro → equipos y fotos → firma y encuesta → cierre con plan de mantenimiento; pausas e incidencias; al completar descuenta stock, crea equipos y agenda mantenimientos), **retirada**, **parte de mantenimiento** (solo recambios y notas: sin fotos, firma ni GPS), **fichar**, **gastos** (foto ticket + OCR), **chat**, **avisos**.
  - Comercial: **alta de lead**, **prueba gratuita** con doble firma e instalación en el acto, **firma presencial de contrato** (5 pasos: datos, dirección, IBAN, foto DNI, firma + RGPD) y cobro rápido, **calculadora de ahorro**, **agenda**.
- **Peso**: ~15-20 % del código y <10 % de las 119 páginas. El 80-85 % restante es oficina (productos, facturación y Verifactu, SEPA/GoCardless, almacenes, mailing, RRSS, agente de voz, comisiones, configuración, superadmin).
- **Tamaño del repo**: 1.022 ficheros TS/TSX, ~224.000 líneas; 211 ficheros `"use server"` con ~1.013 funciones; 36 route handlers; 223 migraciones. Tests: 38 ficheros de lógica pura; **ninguno del wizard, fichajes, gastos ni firma**.

### 1.6 Hallazgos que condicionan el plan (arreglar antes o durante la fase 0)

1. **Las coordenadas del técnico al iniciar el parte no se guardan.** `wizard-actions.ts:206-233` escribe `started_geo_lat/lng`, columnas borradas en `supabase/migrations/20260507100000_audit_cleanup_indexes.sql:20-25`; el bucle descarta el error "column does not exist". Solo quedan `geo_distance_to_address_m` y `started_far_from_address`. Además, el PDF del parte (`pdf-generator.ts:1070-1091`) y `/instalaciones/anti-fraude` leen `geo_started_lat/lng`, que escribe la versión antigua `startInstallation` (`actions.ts:1242`), que **ningún cliente llama**. Y el cierre (`wizard-actions.ts:803-807`) pasa `geo_lat/lng: null`, así que la comprobación "off-road" nunca recibe datos. Si la ficha de la tienda va a decir "validación GPS de instalaciones", esto tiene que ser verdad.
2. **Push muerto** (1.2). Hay que decidir si se revive el SW solo-push (fase 1) o se salta directamente al push nativo (fase 3). Recomiendo ambos: el web push sirve a quien siga en navegador.
3. **Reset de contraseña con PKCE** falla si el enlace se abre en otro navegador que el que lo pidió (ya pasa hoy entre Chrome y el webview de Gmail). En la app se agrava. Solución en 10.
4. `sin-conexion` promete lo que no hay; `sw.ts` referencia un icono inexistente. Cosmético, pero sale en revisión.
5. Sin política de privacidad ni borrado/solicitud de baja de cuenta: **ambas tiendas lo exigen** (7).
6. GPS con `timeout` 7-8 s y `maximumAge: 0` en el wizard: en interiores con alta precisión es frecuente agotar el tiempo y "iniciar sin geo". En nativo se puede pedir primero la última posición conocida y afinar después.

---

## 2. La restricción arquitectónica que decide la opción

El CRM renderiza en servidor (RSC) y muta con Server Actions; el cliente no habla con Supabase salvo para login, Realtime del chat y alguna subida a Storage. Consecuencias:

- **No hay `next export`**: un bundle local dentro de Capacitor no puede ejecutar Server Actions. Capacitor tendría que **cargar la web remota** (`server.url = https://crm.hidromanager.es`). Capacitor documenta `server.url` como opción de desarrollo (live reload), aunque hay apps en producción que lo usan; Capawesome lo califica de "zona gris" con Apple, no de violación explícita. El puente nativo sí se inyecta en páginas servidas desde `server.url` (así funciona el live reload con plugins) → **confirmar en la prueba de concepto (fase 2)**.
- **Una app Expo/React Native** no puede reutilizar las Server Actions: habría que exponer una API (route handlers con `Authorization: Bearer` y RLS como única barrera) y reescribir las 10-12 pantallas de campo con su lógica (el wizard son 1.752 líneas de cliente + ~800 de servidor; `completeInstallation` toca stock, equipos y mantenimientos). Dos bases de código para una persona.
- **La PWA** es la web tal cual: sin App Store, y en iOS depende de que el usuario la instale a mano para tener push.

---

## 3. Opciones comparadas

| Criterio | A) PWA mejorada (+TWA en Play) | B) Capacitor sobre la web actual | C) Expo/RN solo campo | D) Híbrida progresiva (A → B → offline) |
|---|---|---|---|---|
| Coste inicial (trabajo) | 4-6 días | 20-30 días | 60-100 días (3-5 meses) | 25-39 días (v1.0) |
| Tiempo hasta tiendas | Play: 1-2 semanas (TWA). App Store: **nunca** | 4-8 semanas (con esperas) | 4-6 meses | 5-9 semanas |
| Mantenimiento (1 dev + IA) | Mínimo | Bajo-medio: cáscara nativa 1-2 veces/año + calendario de tiendas | Alto: dos apps, dos despliegues, paridad de lógica | Bajo-medio |
| Riesgo guía 4.2 Apple | N/A (no hay app iOS) | **Medio**. Web remota + login. Mitigable (push, deep links, biometría, demo). Plan B necesario | Bajo | Medio, con plan B definido |
| Riesgo Google Play | Bajo (TWA oficial, sitio propio) | Bajo (cuenta organización) | Bajo | Bajo |
| Rendimiento | Web | Web (igual que hoy: depende de red y de RSC) | Nativo, el mejor | Web |
| Offline | Solo caché de lectura con SW; escritura exige rehacer el wizard en cliente | Igual que A (el webview es el mismo navegador) | El mejor (SQLite, colas) | Fase 5: lectura cacheada + borrador local del parte + cola de fichajes |
| Push | Android: sí. iOS: solo instalada en pantalla de inicio y con permiso tras gesto | **FCM/APNs nativo, fiable** | FCM/APNs nativo | FCM/APNs + web push para navegador |
| GPS | Puntual, primer plano | Puntual + posible segundo plano (plugins; exige justificación en tiendas) | Todo | Puntual; segundo plano solo si el negocio lo pide (pregunta 3) |
| Cámara/firma/mapas/tel | Ya funciona | Ya funciona (con adaptador de enlaces y PDF) | Reescribir | Ya funciona |
| Actualizaciones | Instantáneas (Vercel) | **Instantáneas para la web**; la cáscara solo por tienda | Cada cambio pasa por tienda (o EAS Update) | Instantáneas para la web |
| Requiere Mac | No | **Sí** (iOS) | **Sí** (iOS; EAS Build en la nube lo evita) | Sí (fase 2 en adelante) |
| Reutilizable después | Todo | La cáscara, cuentas, push y deep links sirven si algún día se empaqueta un cliente local | — | Todo |

**Descartadas**:
- **A sola**: Mario quiere App Store. Y el push iOS sigue dependiendo de que cada técnico instale la web a mano.
- **C**: el coste y el mantenimiento no se justifican cuando el 85 % del producto es oficina y la lógica vive en el servidor. Tiene sentido solo si el negocio exige offline real y GPS continuo (preguntas 2 y 3); aun así, convendría hacerlo **dentro de la cáscara Capacitor** (cliente local Vite/React para 3-4 pantallas) antes que en RN.
- **B sin sanear la PWA**: los iconos PNG, el SW solo-push, la detección de "app instalada" y la política de privacidad hacen falta igual; hacerlos primero cuesta 4-6 días y beneficia a todos los usuarios de navegador desde el día 1.

---

## 4. Recomendación

**D: híbrida progresiva.** En concreto:

1. **Fase 1**: PWA saneada (iconos PNG, SW solo-push sin caché de navegación, instalación guiada, detección standalone, política de privacidad, solicitud de baja).
2. **Fase 2**: prueba de concepto Capacitor 8 con `server.url` → go/no-go en una semana.
3. **Fase 3**: push nativo (FCM para ambas plataformas), enlaces profundos, adaptador de enlaces externos y PDF, ciclo de vida, bloqueo biométrico, versión mínima forzada.
4. **Fase 4**: tiendas (TestFlight + beta con técnicos reales; Play internal → closed → production; App Review con cuenta demo).
5. **Fase 5** (v1.1, o antes si Apple rechaza): offline mínimo.

**Condiciones de la recomendación**:
- Si Mario no puede disponer de un Mac (propio, alquilado o CI en la nube), la fase 2 no arranca y lo razonable es **A+TWA para Android** y PWA instalable en iOS.
- Si el negocio exige trabajar sin cobertura **de verdad** (pregunta 2), la fase 5 pasa a v1.0 y la estimación crece 15-25 días.
- Si Apple rechaza por 4.2 tras el plan B (fase 5 + argumentos), la salida honesta es: Play con Capacitor + iOS como PWA instalada. No hay forma de garantizar la aprobación de un webview.

---

## 5. Fases

Estimaciones en **días de trabajo efectivo** (un desarrollador con IA). Las esperas de terceros van aparte.

### Fase 0 — Prerrequisitos (3-5 días + esperas)

Alcance:
- Cuentas y trámites (los inicia Mario, ver 14): D-U-N-S, Apple Developer (organización), Google Play (organización), Firebase.
- **Política de privacidad** pública en `crm.hidromanager.es/privacidad` (o en la landing) y aviso legal. Hidromanager es el *encargado*; cada empresa cliente es la *responsable* de los datos de sus empleados (geolocalización laboral: informar a trabajadores y representantes, art. 90 LOPDGDD — **A VERIFICAR con asesor**).
- **Solicitud de baja de cuenta** desde la app (`/perfil` → "Solicitar eliminación de mi cuenta" → aviso a `company_admin` y a superadmin, con plazo) y **página web pública** que explique cómo pedirla (Google exige enlace web; Apple exige iniciarla dentro de la app). Como las cuentas las crea el empleador y no hay autorregistro, es defendible que 5.1.1(v) no aplica, pero el flujo cuesta un día y evita una ronda de revisión — **A VERIFICAR con el revisor**.
- **Empresa demo** en producción con datos semilla y dos usuarios (installer, company_admin) para los revisores; paso en el cron `daily` que garantice cada día una instalación agendada "hoy" para la demo (el wizard solo arranca ±24 h de la cita).
- **Arreglar 1.6.1** (coordenadas del técnico): columnas reales, PDF y anti-fraude leyendo lo mismo que escribe el wizard, cierre con GPS.
- Iconos PNG (192, 512, maskable, apple-touch 180), limpiar `sw.ts` (icono, título), borrar `swe-worker-*.js`.

Entregables: cuentas creadas, D-U-N-S solicitado, política publicada, flujo de baja, demo, bug GPS cerrado, iconos.

### Fase 1 — PWA saneada (4-6 días)

Alcance:
- **SW solo-push**: Serwist activo pero sin `cacheOnNavigation`, sin precache de páginas y sin `runtimeCaching` de HTML/RSC (evita el fallo de junio). Solo `push`, `notificationclick` y, como mucho, caché de `_next/static` e imágenes. `sw-register.tsx` registra en vez de desregistrar.
- Reactivar el botón de push en `/perfil` y crear las claves VAPID en Vercel si no existen (**comprobar**; `.env.example` no las lista).
- Componente "Instalar Hidromanager": `beforeinstallprompt` en Android; guía paso a paso en iOS (compartir → añadir a inicio); detección `display-mode: standalone` para ocultarlo.
- `start_url: /mi-dia?src=pwa` para roles de campo (hoy `/`).
- Repaso `mobile-native` a 390 px: zoom en inputs (ya `userScalable: false`), `100dvh`, `touch-action`, tap highlight, teclado sobre el chat y el wizard.
- Página `/sin-conexion` honesta.

Entregables: PWA instalable con push web real en Android y en iOS instalada; validada a 390 px.

Qué **no** cambia: ninguna página de negocio, ninguna Server Action, ningún esquema.

### Fase 2 — Prueba de concepto Capacitor (3-5 días) → go/no-go

Alcance:
- Carpeta `apps/movil/` (o `mobile/`) fuera de `src`, con Capacitor 8 (**mín. iOS 15, Android 7 / API 24, Xcode 26**; fuente: support policy oficial), `appId` `es.hidromanager.crm`, `server.url` = `https://crm.hidromanager.es`, `allowNavigation` limitado al dominio y a `*.supabase.co`, `appendUserAgent: "HidromanagerApp/<versión>"`, splash y status bar, orientación vertical en teléfonos.
- Verificar en iPhone y Android reales: cookies de sesión persisten tras cerrar la app; `window.Capacitor` existe en la página remota (puente inyectado); `<input capture>` abre cámara; `getCurrentPosition` pide permiso nativo; `tel:`/`wa.me`/`mailto:` salen al sistema; PDF (`/api/pdf/*`); `target="_blank"`; botón atrás Android; teclado y `safe-area`; Realtime del chat; subida de 10 MB; tiempo de arranque.
- **Decisión**: si el puente no se inyecta o las cookies no persisten, el plan cambia (bundle local mínimo con redirección o volver a A+TWA).

Entregables: APK e IPA de prueba instalados en 2-3 móviles; lista de incidencias con su solución.

### Fase 3 — Integración nativa (10-15 días)

Qué cambia en el código actual:
- **Detección de app**: el middleware lee el `User-Agent` (`HidromanagerApp/x.y.z`) y pone una cookie `hm_app=1`; un hook `useEsApp()` y `useVersionApp()` en cliente. Con eso: ocultar "Instalar", cambiar textos ("Permitir notificaciones" → nativo), forzar actualización si `versión < mínima` (tabla o env `APP_MIN_VERSION`).
- **Push nativo**:
  - Nueva tabla `push_device_tokens` (`user_id`, `company_id`, `platform ios|android`, `token` único, `app_version`, `last_seen_at`, RLS por usuario).
  - Acciones `registerDeviceTokenAction` / `unregisterDeviceTokenAction` llamadas desde el shell cuando `@capacitor/push-notifications` entrega el token (en login y en cada arranque).
  - `sendPushToUser` hace *fan-out*: web-push a `push_subscriptions` + **FCM HTTP v1** a `push_device_tokens` (iOS vía APNs configurado en Firebase con la clave `.p8`). Credencial de servicio de Firebase en Vercel (`FIREBASE_SERVICE_ACCOUNT_JSON`). Tokens inválidos (`UNREGISTERED`) se borran. Misma regla `category === 'alert'` y misma deduplicación.
  - Payload `{title, body, url, tag}`; al tocar la notificación el shell navega a `url` dentro del webview.
- **Adaptador de enlaces externos** (un componente/hook global, no tocar cada página): en app, `tel:`/`mailto:`/`wa.me`/`google.com/maps` → `App.openUrl` o navegador del sistema; `/api/pdf/*` y `target="_blank"` → `@capacitor/browser` (SFSafariViewController / Custom Tabs) o descarga + `Share`. Alternativa barata: un atributo `data-externo` en los enlaces afectados (hoy ~25 sitios listados en 1.4).
- **Ciclo de vida**: en `appStateChange` → activo, refrescar Mi día y la campana (`router.refresh()`); botón atrás Android → `history.back()` o salir en raíz.
- **Enlaces profundos**: Universal Links (`/.well-known/apple-app-site-association`) y App Links (`/.well-known/assetlinks.json`) **solo** para rutas de empleado (`/mi-dia`, `/instalaciones/*`, `/mantenimientos/*`, `/agenda`, `/notificaciones`, `/restablecer-password`). **Excluir** `/i/`, `/m/`, `/firmar-contrato/`, `/baja`, `/catalogo/`, `/datasheet/` (son del cliente final, no deben abrirse en la app del técnico).
- **Bloqueo biométrico** (opcional pero suma en la revisión): pantalla nativa con Face ID / huella al abrir la app si han pasado más de N minutos; no sustituye al login, solo protege la sesión.
- **Geolocalización**: usar `@capacitor/geolocation` cuando `useEsApp()`: pedir última posición conocida (rápida) y luego alta precisión con 15 s; mantener el flujo actual "sin GPS → aviso y sigue".
- **Errores**: `global-error.tsx` y `(tenant)/error.tsx` envían a `error_reports` con `source='app'` y versión (hoy solo `console.error`).
- **Fotos**: compresión en cliente en el wizard, contratos, gastos y chat (hoy solo `tech-prep-card`): reduce fallos de subida en 4G y el límite de 10 MB. Reutilizar `media-compress.ts`.

Qué **no** cambia: esquema de auth, RLS, Server Actions de negocio, páginas de oficina.

Entregables: app funcional con push nativo, deep links, adaptador de enlaces, biometría; migración `push_device_tokens`; documentación de build.

### Fase 4 — Tiendas (5-8 días de trabajo + 2-5 semanas de espera)

- **Apple**: App Store Connect, ficha (nombre, subtítulo, descripción en español, palabras clave, categoría Negocios), capturas (iPhone 6,9" y 6,5"; recomiendo **solo iPhone** en v1.0 para evitar capturas y pruebas de iPad — decisión de Mario), **App Privacy** (ubicación precisa, fotos, contenido de usuario, identificadores de dispositivo para push, datos de contacto; "no se usan para rastreo"), textos de permisos en español (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSMicrophoneUsageDescription`, `NSFaceIDUsageDescription`), `ITSAppUsesNonExemptEncryption = false`, URL de privacidad y de soporte, **cuenta demo y notas al revisor** explicando que es una herramienta interna B2B para empleados de empresas de tratamiento de agua, con push, GPS en el parte, cámara y firma.
- **TestFlight**: interno (hasta 100, sin revisión) → externo con 3-5 técnicos reales (pasa Beta App Review; las builds caducan a los 90 días). Fuente: App Store Connect Help.
- **Google Play**: ficha, capturas, **Data safety**, URL de privacidad, **URL de eliminación de cuenta**, cuestionario de clasificación, público objetivo (18+), **declaración de ubicación precisa** si Play la pide (desde abril 2026 Google anuncia declaración para `ACCESS_FINE_LOCATION` persistente; detalles **A VERIFICAR** en la consola), **target API 36** (obligatorio desde 2026-08-31; fuente oficial), App Bundle firmado con Play App Signing (guardar la clave de subida en Accesos del Cerebro).
- **Pistas**: internal testing → closed testing (si la cuenta fuera personal, 12 testers × 14 días obligatorios; con organización no) → production.
- **Pruebas de campo** (11) durante la beta, 2 semanas mínimo.

Entregables: v1.0 publicada en ambas tiendas; checklist de publicación en `docs/`.

### Fase 5 — Offline mínimo para técnicos (15-25 días; v1.1 o plan B)

Ver 9. Entregables: Mi día e instalaciones del día legibles sin red; borrador local del parte (fotos y firma) con subida diferida; cola de fichajes con marca `synced_late`.

### Fase 6 — Mantenimiento continuo (2-3 días por trimestre)

Calendario anual de tiendas (12), actualización de Capacitor (mayor cada diciembre, aprox.), Xcode/iOS SDK (Apple exige SDK nuevo cada abril, **A VERIFICAR**), target API (cada agosto), revisión de declaraciones de privacidad.

---

## 6. Qué cambia en el código actual y qué no

**Cambia (resumen de fases 0-3)**:
- `next.config.ts` (Serwist solo-push), `src/app/sw.ts`, `src/shared/components/sw-register.tsx`, `public/icons/*` (PNG), `public/manifest.webmanifest` (`start_url`, iconos).
- `src/middleware.ts` / `shared/lib/supabase/middleware.ts`: cookie `hm_app` por User-Agent; `public-paths.ts`: `/privacidad`, `/eliminar-cuenta`, `/.well-known/*`.
- `src/modules/notifications/push-send.ts` (fan-out FCM), nueva `device-token-actions.ts`, migración `push_device_tokens`.
- `src/app/(tenant)/perfil/page.tsx`: botón push nativo/web, solicitud de baja, bloqueo biométrico.
- Nuevo `src/shared/components/enlaces-externos.tsx` (adaptador) + hook `useEsApp`.
- `src/modules/installations/wizard-actions.ts` (GPS real, 1.6.1), `installation-wizard.tsx` (compresión, geolocalización nativa), `pdf-generator.ts` y `anti-fraude/page.tsx` (leer columnas correctas).
- `src/app/global-error.tsx`, `(tenant)/error.tsx` (reportar).
- Nuevas páginas: `/privacidad`, `/aviso-legal`, `/eliminar-cuenta` (pública), paso demo en `api/cron/daily`.
- Carpeta nueva `apps/movil/` con `capacitor.config.ts`, `ios/`, `android/`, `www/` mínimo (splash local y página de "sin red" para cuando el remoto no carga).

**No cambia**: el modelo de datos de negocio, RLS, las ~1.000 Server Actions, las 119 páginas (salvo los puntos anteriores), Vercel, región, crons.

---

## 7. Requisitos de las tiendas

### Apple (App Store)

| Requisito | Estado / qué hacer | Fuente |
|---|---|---|
| Apple Developer Program | **99 USD/año**. Para publicar a nombre de la empresa: cuenta de organización, que requiere **D-U-N-S** y persona con capacidad legal (**A VERIFICAR** en el alta) | developer.apple.com/support/compare-memberships |
| Guía 4.2 Minimum Functionality | "Your app should include features, content, and UI that elevate it beyond a repackaged website… If your app is not particularly useful, unique, or 'app-like', it doesn't belong on the App Store". 4.2.2: no "web clippings". Mitigación: push nativo, deep links, biometría, GPS/cámara/firma en flujos reales, demo con datos, notas al revisor | Texto leído en developer.apple.com/app-store/review/guidelines |
| 5.1.1(v) borrado de cuenta | "If your app supports account creation, you must also offer account deletion within the app". Hidromanager **no** permite crear cuentas (las da el empleador). Aun así, implementar "Solicitar eliminación" dentro de la app. Apple no acepta solo desactivar | Ídem; developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion |
| 5.1.5 Location | Solo si es relevante; notificar y obtener consentimiento; explicar el propósito. Pedir solo "mientras se usa" en v1.0 | Ídem |
| 4.8 Sign in with Apple | **No aplica**: no hay login social | Ídem |
| 4.2.6 apps plantilla | **No aplica** mientras sea un solo binario "Hidromanager" para todas las empresas. Apps de marca por empresa chocarían con esto | Ídem |
| Política de privacidad + App Privacy labels | Obligatorias. Hoy no existe la página | — |
| Xcode 26 / iOS 26 SDK | Exigido para subir desde el 28-04-2026 (**A VERIFICAR**, fuente terceros). Capacitor 8 exige Xcode 26 | capgo.app blog; capacitorjs.com support policy |
| TestFlight | 100 internos sin revisión; 10.000 externos con Beta App Review; builds caducan a 90 días | developer.apple.com/help/app-store-connect |
| Cuenta demo para revisión | Obligatoria en la práctica para apps con login | — |
| Acuerdo 3.3.1 (código interpretado) | Contenido web en WebKit está históricamente permitido; texto vigente **A VERIFICAR** | — |

### Google (Play)

| Requisito | Estado / qué hacer | Fuente |
|---|---|---|
| Cuenta de desarrollador | **25 USD una vez** (**A VERIFICAR**, fuentes terceras). Organización: **D-U-N-S obligatorio** (oficial) | support.google.com/googleplay/android-developer/answer/13634885 |
| Cuentas personales nuevas | 12 testers en closed testing durante 14 días antes de producción (si la cuenta se creó tras el 13-11-2023). Con organización no aplica | support.google.com/googleplay/android-developer/answer/14151465 |
| Target API | **Android 16 / API 36** para apps nuevas y actualizaciones desde el 31-08-2026 | developer.android.com/google/play/requirements/target-sdk |
| Eliminación de cuenta | Enlace web que permita pedir la eliminación sin reinstalar la app, declarado en Data safety | support.google.com/googleplay/android-developer/answer/13327111 |
| Data safety + política de privacidad | Obligatorias | — |
| Ubicación | Declaración en Play Console para `ACCESS_FINE_LOCATION` persistente (anuncio abril 2026; detalles y fechas **A VERIFICAR**). Sin ubicación en segundo plano en v1.0 | android-developers.googleblog.com/2026/04 |
| Fotos/vídeos | Usar `<input type="file">`/photo picker: evita `READ_MEDIA_IMAGES` y su declaración | — |
| Spam de webview | Google persigue webviews de sitios ajenos sin permiso y apps sin funcionalidad mínima; sitio propio con login, push y GPS no encaja en eso | android-developers.googleblog.com (2020) |
| Firma | Play App Signing + clave de subida (guardar en Accesos) | — |

---

## 8. Push: arquitectura propuesta

```
notify()/notifyByRoles()  ──category==='alert'──►  sendPushToUser(userId, payload)
                                                        ├─ web-push → push_subscriptions (navegador / PWA)
                                                        └─ FCM HTTP v1 → push_device_tokens (iOS vía APNs, Android)
```

- **Firebase** solo como pasarela de mensajería (FCM es gratuito); no se usa Firebase Auth ni Firestore. Proyecto en la cuenta de Google Cloud del proyecto (`hidromanager1980@gmail.com`, la única permitida para Google Cloud de aguaclaude) — **[decide]** salvo que Mario diga otra cosa.
- APNs: clave `.p8` del equipo Apple subida a Firebase. Guardar `.p8`, `Key ID` y `Team ID` en Accesos del Cerebro.
- Servidor: `FIREBASE_SERVICE_ACCOUNT_JSON` en Vercel; envío con `google-auth-library` + `fetch` (evita meter `firebase-admin` entero) o `firebase-admin` si se prefiere.
- Cliente: `@capacitor/push-notifications`; pedir permiso tras un gesto (botón "Activar avisos" en `/perfil` o al primer arranque tras login); registrar token con `user_id` y `company_id`; des-registrar en logout.
- Tocar notificación → `url` del payload → `window.location.assign(url)` en el webview.
- Mantener web push para quien use el navegador. Unificar en `/perfil` un solo estado "Avisos: activados en este dispositivo".
- Volumen: hoy solo `alert` y deduplicado 2 h; suficiente. Badge de iOS: opcional (`@capacitor/badge` o `notifications` no leídas al reanudar).

---

## 9. Offline mínimo para técnicos sin cobertura (fase 5)

Punto de partida: decisión "online-only" de 2026-05-01 y arquitectura RSC. El objetivo es **no perder trabajo**, no replicar el CRM sin red.

1. **Lectura**: al cargar Mi día con red, un componente cliente guarda en IndexedDB una instantánea (paradas del día, dirección, teléfono, equipos, notas) y los detalles de las instalaciones del día. Sin red, Mi día renderiza la instantánea con aviso "Datos de las HH:MM, sin conexión". No tocar el SW para HTML (fue lo que falló).
2. **Borrador local del parte**: el estado del wizard (paso, fotos como Blob, firma, series, checks) se persiste en IndexedDB por `installation_id` y sobrevive a cerrar la app. Las fotos pasan a subirse por URL firmada (como `tech-prep-card`) desde una **cola de subida** con reintentos; la Server Action de cierre se encola y se ejecuta al volver la red. El servidor acepta `started_at`/`finished_at` del cliente con marca `recorded_offline = true`.
3. **Fichaje sin red**: el fichaje se guarda local con hora del dispositivo y GPS, y se sincroniza después con `synced_late = true` y la hora original; el admin lo ve marcado (registro horario: trazabilidad, no silencio).
4. **No incluido**: alta de leads, contratos, cobros, chat sin red.
5. Requiere `navigator.onLine` + reintentos con `fetch` fallido como señal real (onLine miente).

---

## 10. Seguridad

- **Tokens**: con contenido remoto, la sesión sigue en las cookies del webview (`@supabase/ssr`, legibles por JS como hoy). La app nativa no guarda tokens de Supabase. Solo guarda el token de push (no secreto). Si más adelante hay login nativo o "recordar con biometría", el refresh token va a **Keychain/Keystore** (plugin de almacenamiento seguro), nunca a `Preferences`.
- **RLS**: sin cambios, porque todo sigue pasando por el servidor Next. Si en el futuro un cliente local habla directamente con Supabase, RLS pasa a ser la única barrera: antes, cerrar la verificación pendiente de políticas en el remoto (`installations`, `contracts`, `proposals`, `leads`, `customers`; auditoría 2026-11-09).
- **Webview**: `allowNavigation` solo a `crm.hidromanager.es` y Storage de Supabase; todo lo demás al navegador del sistema; `webContentsDebuggingEnabled: false` en release; sin `server.cleartext`.
- **Deep links**: solo rutas de empleado (ver fase 3); los enlaces de cliente final (`/i`, `/m`, `/firmar-contrato`, `/baja`, `/catalogo`, `/datasheet`) quedan fuera de la asociación. **Comprobar** que `login?next=` solo admite rutas internas (evitar open redirect).
- **Reset de contraseña**: añadir `/restablecer-password` a Universal/App Links para que el enlace del correo abra la app (donde está el *verifier* PKCE). Alternativa: que el admin haga el reset (ya existe). Documentar en la ayuda.
- **Secretos nuevos**: clave de subida Android y su contraseña, certificado de distribución Apple, clave APNs `.p8`, cuenta de servicio Firebase, API key de App Store Connect (si hay CI). Todos a `acceso.py` del Cerebro y a Vercel (los de servidor). Nunca al repo.
- **CSP**: no existe. No bloquea la app, pero conviene añadirla (fuera de este plan).
- **Permisos**: `Permissions-Policy` ya limita geolocalización/cámara/micrófono a `self`; en el webview es el mismo origen.

---

## 11. Pruebas en dispositivo real

- **Dispositivos mínimos**: 1 iPhone (iOS 17+; ideal uno con iOS 26), 1 Android gama media reciente (Samsung/Xiaomi, Android 14-16), 1 Android antiguo (Android 10-11). Siempre también a **390 px** en navegador antes de instalar.
- **Protocolo de campo** (con 3-5 técnicos reales en TestFlight / closed testing, 2 semanas):
  1. Login, cierre de app, reapertura tras 1 h y tras 24 h (sesión), cambio de contraseña forzado, logout.
  2. Wizard completo en una instalación real: GPS en exterior e interior (tiempos), 6 fotos de 10 MB, firma, cierre; comprobar stock, equipos y mantenimientos creados.
  3. Fichaje con GPS, sin GPS (denegado) y con permiso "solo esta vez".
  4. Push: con app en primer plano, en segundo plano y cerrada; tocar la notificación lleva a la pantalla correcta; en iOS con pantalla bloqueada.
  5. Enlaces: llamar, WhatsApp, Maps con ruta de varias paradas, abrir PDF de parte y volver.
  6. Red: modo avión a mitad del wizard (qué se pierde hoy; qué se conserva en fase 5), 3G simulado.
  7. Android: botón atrás en cada pantalla, teclado sobre el chat, modo ahorro de batería, edge-to-edge (target 36).
  8. Reset de contraseña desde el correo en el móvil.
  9. Subida de vídeo de 30 s en preparación técnica (ffmpeg.wasm en webview: tiempo y memoria).
- **Automatización**: añadir tests Vitest de `wizard-actions` (Haversine, radio, ventana ±24 h) y de `sendPushToUser` (fan-out, borrado de tokens inválidos). Hoy no hay ninguno del wizard ni de fichajes.
- **Errores**: revisar `error_reports` con `source='app'` a diario durante la beta.

---

## 12. Publicación y actualizaciones

- **Web**: sigue como hoy (commit = deploy a producción). El 95 % de los cambios llegan a la app sin pasar por tiendas.
- **Cáscara nativa**: nueva versión en tiendas cuando cambien plugins, permisos, Capacitor o lo exija la plataforma. Versionado `MAJOR.MINOR.PATCH` + `versionCode` incremental; el servidor conoce la **versión mínima soportada** y muestra "Actualiza la app" si el UA trae una menor.
- **Builds**: Android desde Windows (Android Studio) o CI; iOS desde Mac (propio/alquilado) o CI macOS (GitHub Actions, Codemagic, Capgo Builds; cuotas y precios **A VERIFICAR**). Recomiendo que la primera publicación se haga a mano para entender el proceso y después automatizar con `fastlane` o la CI.
- **Calendario anual (aprox.)**: abril — Apple exige el SDK de iOS del año anterior (**A VERIFICAR** cada año); agosto 31 — Google exige el target API del año; diciembre — Capacitor mayor; cualquier momento — declaraciones nuevas de Play (ubicación, fotos). Reservar 2-3 días por trimestre.
- **No hace falta** Capgo/Appflow (OTA): el contenido ya es remoto.

---

## 13. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Rechazo Apple 4.2 ("solo es una web") | Media | Alto (retraso semanas) | Push nativo, deep links, biometría, GPS/cámara/firma reales, demo rica, notas al revisor, responder con fase 5 (offline) como argumento; plan B: Play + PWA iOS |
| No disponer de Mac | Alta hoy | Bloquea iOS | Decidir en fase 0: Mac mini, alquiler o CI macOS |
| `server.url` sin puente o cookies no persistentes | Baja-media | Cambia la arquitectura | Fase 2 es go/no-go en una semana |
| Capacitor documenta `server.url` como no-producción | — | Soporte comunitario limitado | Aceptar; es un patrón usado en producción; `www/` local con splash y página de "sin red" |
| D-U-N-S tarda (hasta 30 días) | Alta | Retrasa cuentas de organización | Solicitar el primer día de fase 0 |
| Sesión perdida al actualizar la app o por limpieza de WKWebView | Media | Molestia | Login rápido; a medio plazo biometría con refresh token en Keychain |
| GPS agota los 8 s en interior y el parte "arranca sin geo" | Alta (ya ocurre) | Dato antifraude vacío | Última posición conocida + 15 s; arreglar 1.6.1 |
| Reset de contraseña falla entre navegadores (PKCE) | Media | Soporte | Universal Link a `/restablecer-password`; admin reset |
| Rueda de cumplimiento (API 36→37, Xcode, Capacitor 9) | Cierta | 2-3 días/trimestre | Calendario de la sección 12 |
| Push duplicado web + nativo en el mismo usuario | Media | Ruido | Un solo canal activo por dispositivo; en app, no registrar web push |
| Costes de FCM/APNs | — | Ninguno (gratuitos) | — |
| Tentación de apps de marca por empresa | — | 4.2.6 + mantenimiento ×N | Un solo binario Hidromanager |

---

## 14. Lo que necesita hacer Mario

**Trámites (empezar ya, son los que tardan)**:
1. **D-U-N-S** de la empresa titular (gratis en la vía estándar; expedito de pago **A VERIFICAR**). Necesita razón social exacta, CIF, dirección, teléfono y web.
2. **Apple Developer Program** como organización: Apple ID de empresa (no personal), 99 USD/año, verificación por teléfono de Apple. Decidir titular: Hidromanager (la SaaS) — el nombre del vendedor sale en la ficha.
3. **Google Play Console** como organización: cuenta Google de la empresa, 25 USD (**A VERIFICAR**), D-U-N-S, documentación de la empresa, verificación de identidad del representante.
4. **Firebase**: proyecto en la cuenta de Google Cloud del proyecto (`hidromanager1980@gmail.com`), habilitar Cloud Messaging; subir la clave APNs.
5. **Acceso a un Mac**: comprar (Mac mini), alquilar en la nube o CI macOS. Sin esto no hay iOS. Precios **A VERIFICAR**.

**Decisiones**:
6. Nombre de la app en tiendas ("Hidromanager"), icono final (hay SVG), capturas (puedo generarlas desde la web con marcos).
7. iPhone solo o también iPad en v1.0 (recomiendo solo iPhone).
8. Quién firma la política de privacidad y si pasa por asesor (geolocalización laboral).
9. Las 5 preguntas de la sección 16.

**Personas y medios**:
10. 3-5 técnicos/comerciales reales para la beta (Apple ID o Google de cada uno), 2 semanas.
11. Dispositivos de prueba (iPhone + Android gama media).
12. Tarjeta para los pagos de cuentas; todas las credenciales nuevas me las pasa para guardarlas en Accesos del Cerebro.

---

## 15. Costes

| Concepto | Importe | Verificación |
|---|---|---|
| Apple Developer Program | 99 USD/año | Verificado (páginas de Apple) |
| Google Play Console | 25 USD una vez | **A VERIFICAR** (fuentes terceras coinciden) |
| D-U-N-S | Gratis (estándar); expedito ~229 USD | **A VERIFICAR** |
| Firebase Cloud Messaging / APNs | 0 | Conocido |
| Mac (compra/alquiler/CI) | — | **A VERIFICAR** según opción |
| Capacitor, plugins oficiales | 0 (MIT) | Verificado |
| Plugins de pago (solo si se quisiera GPS en segundo plano) | Capawesome 99 USD/mes o 990/año; Capgo background-geolocation gratis (MIT); Transistorsoft comercial sin precio público | Fuentes terceras; **A VERIFICAR** |
| Capgo/Appflow (OTA) | No necesario | — |
| Expo EAS (si fuese C) | Free: 15 builds Android + 15 iOS al mes; Starter 19 USD/mes | expo.dev/pricing |
| Vercel / Supabase | Sin cambio | — |

---

## 16. Preguntas de negocio que cambian el plan

1. **¿Quién usa la app?** ¿Solo campo (`installer`, `sales_rep`) o también directores y admins quieren el CRM entero en el móvil? Cambia la pantalla de inicio (`/mi-dia` vs dashboard), las capturas y qué se prueba en la beta.
2. **¿Hace falta trabajar sin cobertura de verdad** (sótanos, zonas rurales) o basta con no perder el parte si se corta la red un momento? La decisión de 2026-05-01 fue "online-only". Si cambia, la fase 5 pasa a v1.0 (+15-25 días) y el wizard se rehace en cliente.
3. **¿Quiere seguimiento GPS continuo del técnico durante la jornada** (trazabilidad de ruta, "dónde está ahora") o basta con la posición puntual al fichar e iniciar el parte, que ya existe? Lo primero exige permiso "siempre", justificación en ambas tiendas, información a los trabajadores (art. 90 LOPDGDD), consumo de batería y plugin específico.
4. **¿Cuenta de desarrollador a nombre de Hidromanager o de la empresa de Mario?** Define el nombre que ve el usuario en la tienda, quién paga, y si hace falta D-U-N-S de una u otra. Y confirma: **una sola app "Hidromanager" para todas las empresas cliente**, no apps de marca por empresa.
5. **¿Debe el parte de mantenimiento tener fotos y firma como el de instalación?** Hoy no las tiene. No es requisito de tienda, pero es la carencia de campo más visible y refuerza el argumento "app-like" ante Apple. Son 3-5 días.

---

## Fuentes consultadas (2026-11-09)

- Apple, App Store Review Guidelines (texto de 4.2, 4.2.2, 4.2.6, 5.1.1(v), 5.1.5): https://developer.apple.com/app-store/review/guidelines/
- Apple, 5.1.1 Account deletion: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- Apple, Choosing a Membership (99 USD/año): https://developer.apple.com/support/compare-memberships
- Apple, TestFlight overview (100 internos, 10.000 externos, 90 días): https://developer.apple.com/help/app-store-connect/test-a-beta-version/overview-of-testflight/
- Capacitor, Support Policy (v8: iOS 15, Android 7/API 24, Xcode 26; v7 fin de soporte 2026-12-08): https://capacitorjs.com/docs/main/reference/support-policy
- Ionic, Capacitor 8.5 (UIScene, julio 2026): https://ionic.io/blog/capacitor-8-5-released
- Google, App testing requirements for new personal developer accounts (12 testers, 14 días): https://support.google.com/googleplay/android-developer/answer/14151465
- Google, Organization account / D-U-N-S: https://support.google.com/googleplay/android-developer/answer/13634885
- Google, Target API level requirements (API 36 desde 2026-08-31): https://developer.android.com/google/play/requirements/target-sdk
- Google, App account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111
- Android Developers Blog, ubicación y declaración (abril 2026): https://android-developers.googleblog.com/2026/04/giving-users-clearer-choice-and-everyone-a-safer-more-trusted-app-ecosystem.html
- Android Developers Blog, webview spam y minimum functionality (2020): https://android-developers.googleblog.com/2020/10/developer-tips-and-guides-common-policy.html
- Capawesome, "The right way to update your Capacitor app remotely" (zona gris de `server.url`): https://capawesome.io/blog/the-right-way-to-update-your-capacitor-app-remotely/
- Capgo, requisito Xcode 26 (terceros, A VERIFICAR): https://capgo.app/blog/xcode-26-requirement-for-capacitor-apps/
- Expo, pricing (Free 15+15 builds; Starter 19 USD): https://expo.dev/pricing
- Capgo background geolocation (MIT): https://github.com/Cap-go/capacitor-background-geolocation
- Capawesome Insiders (99 USD/mes): https://capawesome.io/docs/sdks/capacitor/background-geolocation/
- MacRumors / WebKit, web push en iOS 16.4 solo para web apps en pantalla de inicio: https://www.macrumors.com/2023/02/16/ios-16-4-web-push-notifications/

Documentos internos relacionados: `docs/PROJECT_MEMORY.md` (decisión online-only), `docs/MODULOS_FUTUROS.md` §13 (PWA-first para instaladores), `docs/geolocalizacion.md`, `docs/AUDITORIA_ENDPOINTS_2026-11-09.md`.
