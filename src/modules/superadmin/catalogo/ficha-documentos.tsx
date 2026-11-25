import { Download, FileText } from "lucide-react";
import {
  PRODUCT_DOC_KIND_LABEL,
  type ProductDocKind,
} from "@/modules/products/documents-constants";
import type { DocumentoFicha } from "./catalogo-lectura";
import {
  APARTADO_DOC_ETIQUETA,
  ORDEN_APARTADO_DOC,
  formatearIdioma,
  formatearTamano,
} from "./catalogo-etiquetas";

/** Documentos agrupados por apartado (fichas, manuales, certificados…). */
export function FichaDocumentos({ documentos }: { documentos: DocumentoFicha[] }) {
  if (documentos.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin documentos.</p>;
  }
  const grupos = ORDEN_APARTADO_DOC.map((a) => ({
    apartado: a,
    docs: documentos.filter((d) => (ORDEN_APARTADO_DOC.includes(d.apartado) ? d.apartado : "otro") === a),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="space-y-5">
      {grupos.map((g) => (
        <section key={g.apartado} aria-label={APARTADO_DOC_ETIQUETA[g.apartado]}>
          <h3 className="mb-1 text-sm font-bold">
            {APARTADO_DOC_ETIQUETA[g.apartado]}{" "}
            <span className="font-normal text-muted-foreground">· {g.docs.length}</span>
          </h3>
          <ul className="divide-y">
            {g.docs.map((d) => {
              const datos = [
                PRODUCT_DOC_KIND_LABEL[d.kind as ProductDocKind] ?? null,
                formatearIdioma(d.idioma),
                formatearTamano(d.tamano),
              ].filter(Boolean);
              return (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm font-medium">{d.titulo}</div>
                    {datos.length > 0 && (
                      <div className="text-xs text-muted-foreground">{datos.join(" · ")}</div>
                    )}
                  </div>
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card hover:bg-muted"
                      aria-label={`Descargar ${d.titulo}`}
                      title="Descargar"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">No disponible</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
