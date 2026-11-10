import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Envoltorio de Hidromanager: la app carga la web en produccion
// (server.url). No hay bundle local salvo la pantalla de respaldo de www/.
// Ver docs/PLAN_APP_MOVIL.md (Fase 2) y movil/LEEME.md.

const VERSION_APP = "1.1.0";

// Marca "HMPush/1" en el User-Agent: le dice a la web que ESTA compilacion
// lleva push nativo y que puede llamar a PushNotifications.register().
//  - iOS: siempre (APNs va con el entitlement de App.entitlements).
//  - Android: solo si existe android/app/google-services.json al hacer
//    `npx cap sync`. Sin Firebase, register() CIERRA la app de golpe; sin la
//    marca, la web ni lo intenta. Tras anadir el fichero: `npx cap sync android`.
const AGENTE = `HidromanagerApp/${VERSION_APP}`;
const MARCA_PUSH = "HMPush/1";
const HAY_FIREBASE_ANDROID = existsSync(
  join(process.cwd(), "android", "app", "google-services.json"),
);

const config: CapacitorConfig = {
  appId: "es.hidromanager.crm",
  appName: "Hidromanager",
  webDir: "www",
  // La web detectara la app por este sufijo del User-Agent (Fase 3).
  // (android e ios lo pisan mas abajo para anadir la marca de push.)
  appendUserAgent: AGENTE,
  backgroundColor: "#0B4F8A",
  server: {
    url: "https://crm.hidromanager.es",
    // Pantalla propia si la web remota no carga (sin cobertura, caida...).
    errorPath: "index.html",
    // Solo estos hosts se abren DENTRO del webview. Todo lo demas
    // (tel:, mailto:, wa.me, google.com/maps, otros dominios) lo abre
    // Capacitor fuera, con el sistema.
    allowNavigation: ["crm.hidromanager.es", "*.supabase.co"],
    cleartext: false,
  },
  android: {
    appendUserAgent: HAY_FIREBASE_ANDROID ? `${AGENTE} ${MARCA_PUSH}` : AGENTE,
    allowMixedContent: false,
    captureInput: false,
    // Depuracion (chrome://inspect, Safari): por defecto activa en debug y
    // apagada en release; no la forzamos.
  },
  ios: {
    appendUserAgent: `${AGENTE} ${MARCA_PUSH}`,
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0B4F8A",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    // La web ya usa viewport-fit=cover y env(safe-area-inset-*): dejamos
    // el webview de borde a borde (obligatorio en Android 15+ con target 35+).
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
    // LIGHT = texto oscuro, para la cabecera clara de la web (verificar en
    // dispositivo).
    StatusBar: {
      style: "LIGHT",
    },
    // Con la app ABIERTA no se ensena la notificacion del sistema: la web la
    // pinta como aviso dentro de la app (registro-push-nativo.tsx). Suena y
    // actualiza el globo. Con la app cerrada o en segundo plano sale la normal.
    PushNotifications: {
      presentationOptions: ["badge", "sound"],
    },
  },
};

export default config;
