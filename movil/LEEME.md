# Hidromanager — app móvil (Capacitor)

Envoltorio nativo de la web de producción. La app **no lleva la web dentro**: abre
`https://crm.hidromanager.es` en un webview con el puente de Capacitor. Si no hay red,
muestra `www/index.html` («Sin conexión · Reintentar»).

Es la **Fase 2 (prueba de concepto)** de `docs/PLAN_APP_MOVIL.md`. Todavía no hay
código nativo propio (adaptador de enlaces, push nativo, deep links, biometría): eso es la Fase 3.

## Qué hay

| Pieza | Valor |
|---|---|
| Capacitor | 8.6.0 (`core`, `cli`, `android`, `ios`) |
| Plugins | `app` 8.1.2, `status-bar` 8.0.4, `splash-screen` 8.0.2, `browser` 8.0.5, `geolocation` 8.2.4, `camera` 8.2.6, `push-notifications` 8.1.3 |
| `appId` | `es.hidromanager.crm` |
| Nombre | Hidromanager |
| Versión | 1.0.0 (Android `versionCode 1`, iOS `CURRENT_PROJECT_VERSION 1`) |
| User-Agent | sufijo `HidromanagerApp/1.0.0` (la web lo usará en la Fase 3 para detectar la app) |
| Navegación interna | solo `crm.hidromanager.es` y `*.supabase.co`; el resto sale al sistema |
| Android | minSdk 24 (Android 7), targetSdk/compileSdk 36 (lo que exige Play desde el 31-08-2026) |
| iOS | mínimo iOS 15, **solo iPhone**, Swift Package Manager (sin CocoaPods). Capacitor 8 pide **Xcode 26** |

Es un paquete **independiente** de la web: su `package.json` no tiene nada que ver con el de la
raíz, la raíz excluye `movil/` en `tsconfig.json` y `.vercelignore`, y Vercel no lo sube.

Estructura:

```
movil/
  capacitor.config.ts     configuración (URL, hosts permitidos, splash, barras)
  www/index.html          pantalla de respaldo sin conexión
  assets/                 PNG de partida de iconos y splash (generados)
  scripts/generar-iconos.mjs
  android/                proyecto de Android Studio (versionado)
  ios/                    proyecto de Xcode (versionado)
```

Al cambiar la versión, hay que tocarla en **tres** sitios: `VERSION_APP` de
`capacitor.config.ts` (User-Agent), `android/app/build.gradle` (`versionCode` +1 y
`versionName`) y en Xcode (`MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` +1).

## Antes de nada (en cualquier máquina)

```bash
cd movil
npm install          # obligatorio: iOS y Android referencian node_modules/@capacitor/*
npx cap sync         # copia config y www/ a android/ e ios/, y actualiza plugins
```

Tras cambiar `capacitor.config.ts` o `www/`, siempre `npx cap sync`.

Iconos y splash: salen de `public/icons/icon.svg` y `maskable.svg`.
`npm run iconos` regenera `assets/*.png`, los PNG de la PWA en `public/icons/` y todos los
recursos nativos de Android e iOS (con `@capacitor/assets`). Las letras «HM» se pintan con la
fuente que haya en el sistema (en Windows sale Arial/Segoe; Nunito Sans no está instalada).

## Android

Requisitos: Android Studio reciente (incluye JDK 21 y el SDK 36).

```bash
cd movil
npm install
npx cap sync android
npx cap open android     # abre Android Studio
```

- **Probar en un móvil**: activa «Opciones de desarrollador» y «Depuración USB», conéctalo y dale a
  *Run*. O *Build > Build APK(s)* y pasa el APK. En compilación *debug* puedes inspeccionar el
  webview desde Chrome del PC en `chrome://inspect`.
- **Clave de subida** (creada el 2026-11-10): `D:\CREDENCIALES PROYECTOS\hidromanager-android\subida-hidromanager.jks`,
  alias `subida`; la contraseña está en Accesos del Cerebro y en `firma.properties` de esa carpeta.
  `android/app/build.gradle` lee ese fichero (o el de la variable `HIDROMANAGER_FIRMA`); sin él, el
  release sale sin firmar. Si se pierde, Google puede restablecerla, pero tarda días.
- **AAB firmado** (sin Android Studio): con `JAVA_HOME`, `ANDROID_HOME` y `GRADLE_USER_HOME` apuntando a
  `D:/herramientas-android`, `./gradlew.bat bundleRelease --no-daemon` en `movil/android` →
  `android/app/build/outputs/bundle/release/app-release.aab`. En Play Console, **Play App Signing**
  activado (Google guarda la clave de firma; tú solo la de subida).
- Comprobar antes de subir: `targetSdk 36`, `versionCode` mayor que el anterior.

Permisos declarados (`android/app/src/main/AndroidManifest.xml`): `INTERNET`,
`ACCESS_NETWORK_STATE`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`,
`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`. **Sin** ubicación en segundo plano
ni `READ_MEDIA_IMAGES` (las fotos van por el selector del sistema).
Además: `allowBackup="false"` (que la copia de Google no se lleve las cookies de sesión),
orientación vertical (Android 16 la ignora en tablets y plegables con `targetSdk 36`, que es lo que
queremos: vertical en teléfonos), y `<queries>` para que `tel:`, `mailto:`, WhatsApp y Maps
encuentren su app.

## iOS (en un Mac)

> **Sin Mac**: se compila y se sube a TestFlight desde GitHub Actions con el repo privado
> `Mario1988123/hidromanager-ios` (`D:\IOS_HIDROMANAGER`, copia de esta carpeta sin `android/`).
> Tras cambiar algo aquí, cópialo allí, commit y `gh workflow run ios-testflight.yml -R Mario1988123/hidromanager-ios`.

Requisitos: macOS con **Xcode 26**, cuenta de Apple Developer (99 USD/año) dada de alta en Xcode,
Node instalado. **No hace falta CocoaPods**: el proyecto usa Swift Package Manager
(`ios/App/CapApp-SPM/Package.swift`, que descarga `capacitor-swift-pm` 8.6.0 de GitHub).

```bash
cd movil
npm install
npx cap sync ios
npx cap open ios         # abre ios/App/App.xcodeproj
```

En Xcode, target **App**:

1. *Signing & Capabilities*: marca «Automatically manage signing» y elige el **Team** (el de la
   empresa cuando exista la cuenta de organización). Bundle ID `es.hidromanager.crm`.
2. Para push (cuando toque): *+ Capability* → **Push Notifications** (crea `App.entitlements`).
   No hace falta «Background Modes» para notificaciones normales.
3. Primera apertura: Xcode resuelve los paquetes SPM (*File > Packages > Resolve Package Versions*
   si no lo hace solo). Si falla, comprueba que `npm install` se hizo en `movil/`.
4. **Probar en un iPhone**: conéctalo, activa el «Modo desarrollador» en el iPhone y dale a *Run*.
   El webview se inspecciona desde Safari del Mac (*Desarrollo > [iPhone]*).
5. **TestFlight**: elige el destino «Any iOS Device (arm64)» → *Product > Archive* → *Distribute
   App > App Store Connect > Upload*. En App Store Connect aparece en TestFlight tras procesarse
   (unos minutos); pruebas internas sin revisión, externas con Beta App Review. Las builds caducan a
   los 90 días. Cada subida necesita `CURRENT_PROJECT_VERSION` mayor.

Ya configurado en `ios/App/App/Info.plist`: idioma `es`, textos de permisos en español
(ubicación mientras se usa, cámara, fotos, guardar fotos, micrófono),
`ITSAppUsesNonExemptEncryption = false`, solo orientación vertical. En el proyecto:
`TARGETED_DEVICE_FAMILY = 1` (solo iPhone) y versión 1.0.0. `AppDelegate.swift` ya reenvía el
token de APNs al plugin de push.

Lo que **no se ha podido hacer en Windows**: compilar, resolver los paquetes SPM, firmar y
comprobar que el proyecto abre sin avisos en Xcode. Es lo primero que hay que hacer en el Mac.

## Push: qué falta (no funciona todavía)

`@capacitor/push-notifications` está instalado, pero **sin Firebase no hace nada** y la web aún
no lo llama (la Fase 3 añade `registerDeviceTokenAction`, la tabla `push_device_tokens` y el envío
por FCM; ver el plan, apartado 8). Hasta entonces **no llamar a `PushNotifications.register()`**:
en Android, sin Firebase inicializado, falla.

1. Crear proyecto en Firebase (consola) y dentro dos apps: Android `es.hidromanager.crm` e iOS
   `es.hidromanager.crm`.
2. Android: descargar `google-services.json` → `movil/android/app/google-services.json`.
   `android/app/build.gradle` ya aplica el plugin de Google Services si el fichero existe. Está en
   `.gitignore`: decide si se versiona (no es secreto, pero así queda fuera hasta decidirlo).
3. iOS: en Apple Developer, *Keys* → nueva clave con **Apple Push Notifications service (APNs)** →
   descargar el `.p8` (solo se descarga una vez) y anotar Key ID y Team ID. Subirlo en Firebase →
   *Configuración del proyecto > Cloud Messaging > APNs*. Guardar `.p8`, Key ID y Team ID en
   Accesos del Cerebro. Para usar FCM también en iOS hace falta añadir el SDK de Firebase
   Messaging al proyecto de Xcode (Fase 3), o usar APNs directo desde el servidor.
4. Servidor (Vercel): cuenta de servicio de Firebase en `FIREBASE_SERVICE_ACCOUNT_JSON` (Fase 3).

## Comprobaciones de la Fase 2 en dispositivo real

Hacer en al menos un Android y un iPhone reales, con un usuario instalador y uno comercial.
Anotar cada fallo con móvil, versión del sistema y pasos.

**Decisivas (si fallan, el plan cambia):**

- [ ] `window.Capacitor` existe en la página remota (consola del inspector: `window.Capacitor?.isNativePlatform()` → `true`).
- [ ] El User-Agent termina en `HidromanagerApp/1.0.0` (`navigator.userAgent`).
- [ ] Iniciar sesión, **cerrar la app del todo** (quitarla de recientes) y volver a abrir: sigue la sesión. Repetir tras reiniciar el móvil y tras 24 h.

**Funcionales:**

- [ ] `<input capture>` abre la cámara (foto de equipo en el asistente de instalación, ticket de gasto, DNI).
- [ ] Elegir foto de la galería en esos mismos campos.
- [ ] GPS: al iniciar un parte y al fichar sale el permiso nativo «mientras se usa» y llega la posición.
- [ ] Escáner de códigos de barras (almacenes) abre la cámara en vivo.
- [ ] Nota de voz del chat: pide micrófono y graba.
- [ ] Firma con el dedo (parte, contrato) sin que la página se desplace.
- [ ] `tel:` abre el marcador, `mailto:` el correo, `wa.me` WhatsApp, los enlaces de `google.com/maps` la app de Maps (o el navegador).
- [ ] PDF (`/api/pdf/*`, p. ej. el contrato o el parte). **Esperado que falle**: en iOS `target="_blank"` se abre en Safari, **sin la sesión** (cookies del webview), así que probablemente pida login; en Android el WebView no muestra PDF y no hay gestor de descargas. Lo resuelve el adaptador de la Fase 3.
- [ ] Otros `target="_blank"` / `window.open` (catálogo, compartir): ver adónde van.
- [ ] Botón atrás de Android: con `@capacitor/app` y sin código propio, vuelve atrás en el historial del webview y en la primera pantalla **no hace nada** (no sale de la app). Comprobar que no se pierden formularios a medias; salir en la raíz es Fase 3.
- [ ] Teclado: los campos de abajo (formularios, chat) no quedan tapados.
- [ ] Zonas seguras: barra inferior y cabecera no quedan debajo del notch ni de la barra de gestos; color del texto de la barra de estado legible.
- [ ] Chat en tiempo real (Realtime de Supabase) recibe mensajes con la app abierta y al volver de segundo plano.
- [ ] Subida de un archivo de ~10 MB (vídeo de preparación técnica) por 4G.
- [ ] Sin red (modo avión) al abrir: sale «Sin conexión» y «Reintentar» funciona al volver la red.
- [ ] Volver de segundo plano tras un rato: la página sigue viva o recarga sin perder la sesión.
- [ ] Enlace de «restablecer contraseña» abierto desde el correo (se abrirá en el navegador, no en la app: anotar si funciona).
- [ ] Tiempo de arranque hasta ver «Mi día» (con 4G y con wifi).
- [ ] Icono y splash correctos (Android: icono adaptativo redondo y cuadrado; iOS: sin bordes negros).

Entregable de la fase: APK e IPA instalados en 2-3 móviles y la lista de incidencias con su
solución, y la decisión go/no-go del plan.
