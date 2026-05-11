import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // Desactivado: el SW interceptaba navegaciones que fallaban en server y
  // empeoraba la UX (no-response). Volverá cuando endurecemos el offline.
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
};

export default withSerwist(nextConfig);
