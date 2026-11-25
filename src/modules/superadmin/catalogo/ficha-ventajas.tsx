import { Check } from "lucide-react";

/**
 * «Características clave» (las ventajas): tarjetas grises con icono, título y texto. Sin datos de la base: recibe
 * lo que hay que pintar, para poder usarse también en la ficha de la empresa.
 */

export interface VentajaVista {
  id: string;
  titulo: string;
  descripcion: string | null;
  /** URL ya resuelta (firmada o pública) del icono. */
  icono: string | null;
}

export function FichaVentajas({ ventajas }: { ventajas: VentajaVista[] }) {
  if (ventajas.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {ventajas.map((v) => (
        <li key={v.id} className="flex items-start gap-3 rounded-xl bg-muted p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card text-primary">
            {v.icono ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.icono} alt="" loading="lazy" className="h-7 w-7 object-contain" />
            ) : (
              <Check className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="font-semibold leading-snug">{v.titulo}</div>
            {v.descripcion && (
              <p className="mt-0.5 text-sm text-muted-foreground">{v.descripcion}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
