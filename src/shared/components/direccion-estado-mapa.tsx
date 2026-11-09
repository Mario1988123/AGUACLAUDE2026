"use client";

import { MapPin } from "lucide-react";
import type { EstadoDireccion } from "@/shared/lib/geocoding/use-direccion";

/**
 * Lo que va bajo el mapa en los formularios de dirección: el aviso de
 * «arrastra la chincheta», la nota de cómo llama el mapa a la calle y la
 * atribución obligatoria de CartoCiudad (CC BY 4.0) cuando se ha usado.
 */
export function DireccionEstadoMapa({ dir }: { dir: EstadoDireccion }) {
  return (
    <>
      {dir.aviso && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border-2 border-warning/40 bg-warning/10 p-3 text-sm font-semibold text-foreground"
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 break-words">{dir.aviso}</span>
        </div>
      )}
      {dir.nota && (
        <p className="break-words rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{dir.nota}</p>
      )}
      {dir.usaCartociudad && (
        <p className="text-[11px] text-muted-foreground">Direcciones: CartoCiudad (IGN, CC BY 4.0)</p>
      )}
    </>
  );
}
