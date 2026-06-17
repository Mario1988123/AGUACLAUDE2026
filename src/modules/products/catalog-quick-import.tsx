"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, PackageCheck, Download, Info } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  lookupCatalogBySupplierRefAction,
  importCatalogProductSafeAction,
} from "./catalog-import-actions";

type Found =
  | { state: "idle" }
  | { state: "none" }
  | { state: "found"; name: string; manufacturerName: string | null }
  | { state: "owned"; id: string };

/**
 * Atajo en el alta de producto: el admin teclea la referencia del proveedor.
 * Si el superadmin la tiene en el catálogo maestro, se crea una copia con todos
 * sus datos + fotos + documentación (la empresa solo pone precio y stock). Si no
 * existe, rellena el formulario normal de abajo.
 */
export function CatalogQuickImport() {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<Found>({ state: "idle" });
  const [searching, startSearch] = useTransition();
  const [importing, startImport] = useTransition();

  function search() {
    const clean = ref.trim();
    if (!clean) {
      notify.warning("Escribe una referencia del proveedor");
      return;
    }
    startSearch(async () => {
      const r = await lookupCatalogBySupplierRefAction(clean);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      if (!r.found) {
        setResult({ state: "none" });
      } else if (r.alreadyOwnedId) {
        setResult({ state: "owned", id: r.alreadyOwnedId });
      } else {
        setResult({ state: "found", name: r.name, manufacturerName: r.manufacturerName });
      }
    });
  }

  function doImport() {
    startImport(async () => {
      const r = await importCatalogProductSafeAction(ref.trim());
      if (!r.ok) {
        notify.error("No se pudo importar", r.error);
        if (r.existingId) router.push(`/productos/${r.existingId}` as never);
        return;
      }
      notify.success("Producto creado desde el catálogo", "Ahora pon su precio y stock.");
      router.push(`/productos/${r.id}` as never);
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <PackageCheck className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-bold">¿Está en el catálogo del fabricante?</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Escribe la <strong>referencia del proveedor</strong>. Si existe, se crea con todos sus
        datos, fotos y documentación y tú solo pones precio y stock.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1 space-y-1">
          <Label className="text-xs">Referencia del proveedor</Label>
          <Input
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setResult({ state: "idle" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            placeholder="Ej. OSM-500-PRO"
          />
        </div>
        <Button variant="outline" onClick={search} disabled={searching || importing}>
          <Search className="h-4 w-4" /> {searching ? "Buscando…" : "Buscar"}
        </Button>
      </div>

      {result.state === "found" && (
        <div className="space-y-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <PackageCheck className="h-4 w-4" />
            Encontrado: {result.name}
            {result.manufacturerName ? ` · ${result.manufacturerName}` : ""}
          </div>
          <p className="text-xs text-emerald-800">
            Se creará con sus datos, fotos y documentos. La referencia quedará bloqueada.
          </p>
          <Button variant="success" onClick={doImport} disabled={importing}>
            <Download className="h-4 w-4" />
            {importing ? "Creando…" : "Crear desde el catálogo"}
          </Button>
        </div>
      )}

      {result.state === "owned" && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4" /> Ya tienes este producto importado.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/productos/${(result as { id: string }).id}` as never)}
          >
            Ver producto
          </Button>
        </div>
      )}

      {result.state === "none" && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4" /> Esa referencia no está en el catálogo del fabricante.
          Rellena el formulario de abajo para crearlo a mano.
        </div>
      )}
    </div>
  );
}
