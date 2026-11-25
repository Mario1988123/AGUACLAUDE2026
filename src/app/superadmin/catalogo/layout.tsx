import { Suspense } from "react";
import {
  BarraCatalogo,
  BarraCatalogoEsqueleto,
} from "@/modules/superadmin/catalogo/barra-catalogo";

/** Barra de secciones común a todas las pantallas del catálogo maestro. */
export default function CatalogoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-4">
      <Suspense fallback={<BarraCatalogoEsqueleto />}>
        <BarraCatalogo />
      </Suspense>
      {children}
    </div>
  );
}
