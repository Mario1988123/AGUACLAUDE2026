import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import { ToastProvider } from "@/shared/components/toast-provider";
import { ServiceWorkerRegister } from "@/shared/components/sw-register";
import "./globals.css";

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AguaClaude CRM",
  description: "CRM multi-tenant para empresas de tratamiento de agua",
  applicationName: "AguaClaude",
  formatDetection: { telephone: true },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AguaClaude",
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4880FF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${nunito.variable} font-sans antialiased`}>
        {children}
        <ToastProvider />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
