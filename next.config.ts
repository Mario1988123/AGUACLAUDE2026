import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // DESACTIVADO 2026-06-13: el SW (cacheOnNavigation) cacheaba navegaciones y
  // servía listas/páginas viejas tras mutaciones → borrar/desactivar parecía
  // "no se actualiza". Confirmado en incógnito (sin SW funciona perfecto).
  // Lo apagamos del todo; public/sw.js es ahora un kill-switch que desinstala
  // el SW antiguo y limpia la caché en todos los navegadores. (Pausa también
  // las push; reversible con un SW mínimo solo-push si se quiere.)
  disable: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // El default de Next es 1 MB para Server Actions. Subimos a 10 MB porque
  // recibimos firmas (PNG base64), DNIs y fotos del wizard de instalación/
  // pruebas gratuitas y se reventaba con "Body exceeded 1 MB limit".
  // Las fotos grandes ya usan FormData + Storage directo (no llegan aquí),
  // pero firmas pad + DNI base64 suman.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },
  // Headers de seguridad (decisión 2026-05-20)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (no DENY) para permitir el iframe del PDF preview
          // del propio CRM en modales. Sigue bloqueando clickjacking de
          // sitios externos. Cambio 2026-06-02.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
