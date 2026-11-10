import type { CapacitorConfig } from "@capacitor/cli";

// Envoltorio de Hidromanager: la app carga la web en produccion
// (server.url). No hay bundle local salvo la pantalla de respaldo de www/.
// Ver docs/PLAN_APP_MOVIL.md (Fase 2) y movil/LEEME.md.

const VERSION_APP = "1.0.0";

const config: CapacitorConfig = {
  appId: "es.hidromanager.crm",
  appName: "Hidromanager",
  webDir: "www",
  // La web detectara la app por este sufijo del User-Agent (Fase 3).
  appendUserAgent: `HidromanagerApp/${VERSION_APP}`,
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
    allowMixedContent: false,
    captureInput: false,
    // Depuracion (chrome://inspect, Safari): por defecto activa en debug y
    // apagada en release; no la forzamos.
  },
  ios: {
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
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
