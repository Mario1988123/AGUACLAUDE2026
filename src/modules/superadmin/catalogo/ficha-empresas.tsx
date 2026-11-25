import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import type { EmpresaFicha } from "./catalogo-lectura";
import { formatearFecha } from "./catalogo-etiquetas";

/**
 * Empresas que tienen este producto del maestro, con el NOMBRE QUE LE HAN
 * PUESTO. Solo lectura: enlaza al detalle de la empresa.
 */
export function FichaEmpresas({ empresas, version }: { empresas: EmpresaFicha[]; version: number }) {
  if (empresas.length === 0) {
    return <p className="text-sm text-muted-foreground">Ninguna empresa lo ha importado todavía.</p>;
  }
  return (
    <ul className="divide-y">
      {empresas.map((e) => {
        const pendiente = e.versionSincronizada != null && e.versionSincronizada < version;
        const alta = formatearFecha(e.alta);
        return (
          <li key={e.productoId}>
            <Link
              href={`/superadmin/empresas/${e.empresaId}` as never}
              className="flex min-h-14 items-center gap-3 rounded-lg px-1 py-2 transition-colors duration-100 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-sm font-semibold">{e.empresa}</div>
                <div className="break-words text-sm">
                  <span className="text-muted-foreground">Lo llama: </span>«{e.nombreEnEmpresa}»
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {e.versionSincronizada != null ? `Versión v${e.versionSincronizada}` : "Versión sin registrar"}
                  </span>
                  {alta && <span>· Alta {alta}</span>}
                  {pendiente && (
                    <Badge variant="warning" className="px-2 py-0.5 text-[11px]">
                      Actualización pendiente
                    </Badge>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
