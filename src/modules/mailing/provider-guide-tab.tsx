"use client";

import { EmailProviderGuide } from "./provider-guide";

/**
 * Tab "Guía proveedores" en /configuracion/mailing.
 * El onApply aquí solo muestra los datos al usuario; el rellenado real
 * se hace desde dentro de cada formulario SMTP (que tiene su propio botón
 * "Elegir mi proveedor" que abre el mismo componente en un modal).
 */
export function ProviderGuideTab() {
  return (
    <EmailProviderGuide
      onApply={(p) => {
        alert(
          `Configuración seleccionada:\n\n` +
            `Host: ${p.host}\n` +
            `Puerto: ${p.port}\n` +
            `SSL/TLS: ${p.secure ? "Sí" : "No (STARTTLS)"}\n\n` +
            `Ve a la pestaña "Mi SMTP (Admin)" o "SMTP automático del sistema" y pulsa "Elegir mi proveedor" para auto-rellenar el formulario.`,
        );
      }}
    />
  );
}
