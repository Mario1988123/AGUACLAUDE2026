import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import { ToastProvider } from "@/shared/components/toast-provider";
import { ConfirmDialogProvider } from "@/shared/components/confirm-dialog";
import { ServiceWorkerRegister } from "@/shared/components/sw-register";
import "./globals.css";

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hidromanager CRM",
  description: "Hidromanager — CRM para empresas de tratamiento de agua",
  applicationName: "Hidromanager",
  formatDetection: { telephone: true },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hidromanager",
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B4F8A",
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
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        <ToastProvider />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
