"use client";

import { Toaster } from "sonner";

/**
 * Sistema de toast del CRM. NUNCA usar alert() del navegador.
 * Colores semánticos: success=verde, error=rojo, warning=naranja, info=neutro.
 */
export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        classNames: {
          toast: "rounded-md shadow-md text-sm",
          success: "border-l-4 border-success",
          error: "border-l-4 border-destructive",
          warning: "border-l-4 border-warning",
          info: "border-l-4 border-primary",
        },
      }}
    />
  );
}
