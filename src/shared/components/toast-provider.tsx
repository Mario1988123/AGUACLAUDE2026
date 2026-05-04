"use client";

import { Toaster } from "sonner";

/**
 * Sistema de toast del CRM. NUNCA usar alert() del navegador.
 * Colores semánticos: success=verde, error=rojo, warning=naranja, info=neutro.
 * Duración 3s con barra de progreso. El botón de cerrar va integrado
 * dentro del propio toast (top-right, no fuera).
 */
export function ToastProvider() {
  return (
    <>
      <Toaster
        position="top-right"
        richColors
        closeButton
        duration={3000}
        toastOptions={{
          classNames: {
            toast:
              "agua-toast rounded-xl shadow-lg text-sm border-0 overflow-hidden relative pr-8",
            closeButton: "agua-toast-close",
            success: "border-l-4 border-success",
            error: "border-l-4 border-destructive",
            warning: "border-l-4 border-warning",
            info: "border-l-4 border-primary",
          },
        }}
      />
      <style jsx global>{`
        /* Botón cerrar INTEGRADO dentro del toast (no flotando fuera) */
        [data-sonner-toaster] [data-close-button] {
          position: absolute !important;
          top: 8px !important;
          right: 8px !important;
          left: auto !important;
          transform: none !important;
          width: 22px !important;
          height: 22px !important;
          background: transparent !important;
          border: none !important;
          color: currentColor !important;
          opacity: 0.6;
        }
        [data-sonner-toaster] [data-close-button]:hover {
          opacity: 1;
          background: rgba(0, 0, 0, 0.08) !important;
        }
        /* Barra de progreso de tiempo en la base del toast */
        [data-sonner-toast] {
          position: relative;
        }
        [data-sonner-toast]::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: 0;
          height: 3px;
          width: 100%;
          background: currentColor;
          opacity: 0.35;
          transform-origin: left;
          animation: aguaToastProgress 3s linear forwards;
        }
        [data-sonner-toast][data-type="success"]::after { background: #10b981; }
        [data-sonner-toast][data-type="error"]::after   { background: #ef4444; }
        [data-sonner-toast][data-type="warning"]::after { background: #f59e0b; }
        [data-sonner-toast][data-type="info"]::after    { background: #4880FF; }
        @keyframes aguaToastProgress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </>
  );
}
