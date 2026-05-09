"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { importStockCsvAction } from "./import-actions";

export function CsvImportButton({ warehouseId }: { warehouseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [csvText, setCsvText] = useState("");
  const [report, setReport] = useState<{
    inserted: number;
    errors: Array<{ line: number; reference: string; reason: string }>;
  } | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function submit() {
    if (!csvText.trim()) {
      notify.warning("Pega o sube un CSV primero");
      return;
    }
    startTransition(async () => {
      const r = await importStockCsvAction({
        warehouse_id: warehouseId,
        csv_text: csvText,
      });
      setReport({ inserted: r.inserted, errors: r.errors });
      if (r.inserted > 0) {
        notify.success(`Importadas ${r.inserted} línea(s)`);
        router.refresh();
      }
      if (r.errors.length > 0) {
        notify.warning(`${r.errors.length} línea(s) con error`);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" size="sm">
        <Upload className="h-4 w-4" /> Importar CSV
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b p-4">
              <h2 className="font-bold">Importar stock desde CSV</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Cabeceras: <code>product_reference,quantity,location_code,notes</code>
                . Separador <code>,</code> o <code>;</code>. <code>product_reference</code>{" "}
                puede ser la referencia interna o el nombre del producto.
              </p>
            </div>
            <div className="space-y-3 p-4">
              <div className="space-y-1">
                <Label>Subir archivo</Label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  className="block w-full text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label>O pegar contenido</Label>
                <textarea
                  rows={8}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background p-2 font-mono text-xs"
                  placeholder={`product_reference,quantity,location_code,notes\nOSM-100,5,22C,Stock inicial\nFIL-200,12,11A,`}
                />
              </div>
              {report && (
                <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                  <p className="font-bold">
                    Importadas: {report.inserted} · Errores: {report.errors.length}
                  </p>
                  {report.errors.length > 0 && (
                    <ul className="mt-2 max-h-40 overflow-y-auto space-y-0.5">
                      {report.errors.map((e, i) => (
                        <li key={i} className="text-destructive">
                          Línea {e.line}: <strong>{e.reference}</strong> — {e.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cerrar
              </Button>
              <Button onClick={submit} disabled={pending} variant="success">
                {pending ? "Importando…" : "Importar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
