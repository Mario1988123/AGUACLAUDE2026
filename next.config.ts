import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // Re-activado 2026-05-20: SW reescrito sin interceptar /api/* ni RSC,
  // push notifications operativas. En dev seguimos deshabilitado.
  disable: process.env.NODE_ENV === "development",
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
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
