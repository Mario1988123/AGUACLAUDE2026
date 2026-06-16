"use client";

import { useState, useTransition } from "react";
import { Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  importCustomersSafeAction,
  parseImportXlsxAction,
  type ImportResult,
} from "./import-actions";
import { mapSpreadsheetRows, type ImportCustomerRow } from "./import-mapping";

/** Parte una línea CSV respetando comillas, con el delimitador indicado. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): ImportCustomerRow[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  // Detectar delimitador: Excel español suele guardar con ";".
  const delim =
    (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const header = splitCsvLine(lines[0]!, delim);
  const dataRows = lines.slice(1).map((l) => splitCsvLine(l, delim));
  return mapSpreadsheetRows(header, dataRows);
}

const TEMPLATE_HEADERS = [
  "codigo",
  "tipo",
  "razon_social",
  "nombre_comercial",
  "nombre",
  "apellidos",
  "dni_cif",
  "telefono_1",
  "telefono_2",
  "email",
  "tipo_via",
  "calle",
  "numero",
  "portal",
  "piso",
  "puerta",
  "cp",
  "poblacion",
  "provincia",
  "titular",
  "iban",
  "mandato_completo",
  "equipo",
  "marca",
  "numero_serie",
  "fecha_instalacion",
  "ultimo_mantenimiento",
  "periodicidad_meses",
  "plan",
  "importe_eur",
  "fecha_inicio",
  "notas",
];

export function ImportCustomersButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ImportCustomerRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    setPreview([]);
    if (/\.xlsx$/i.test(f.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
        const b64 = btoa(bin);
        startTransition(async () => {
          const r = await parseImportXlsxAction(b64);
          if (!r.ok) {
            notify.error("No se pudo leer el Excel", r.error);
            return;
          }
          setPreview(r.rows);
        });
      };
      reader.readAsArrayBuffer(f);
    } else {
      const reader = new FileReader();
      reader.onload = () => setPreview(parseCsv(String(reader.result ?? "")));
      reader.readAsText(f, "utf-8");
    }
  }

  function importIt() {
    if (preview.length === 0) {
      notify.warning("Selecciona un archivo con datos");
      return;
    }
    startTransition(async () => {
      // Troceamos en lotes para no pasarnos del límite de tiempo de la server
      // action con listados grandes (cientos de filas). El upsert por código
      // funciona entre lotes (cada lote consulta la BD ya actualizada).
      const CHUNK = 60;
      const acc: ImportResult = {
        inserted: 0,
        updated: 0,
        equipment: 0,
        banks: 0,
        duplicates: 0,
        errors: [],
      };
      setProgress(0);
      for (let i = 0; i < preview.length; i += CHUNK) {
        const slice = preview.slice(i, i + CHUNK);
        const r = await importCustomersSafeAction(slice);
        if (!r.ok) {
          notify.error("Error", r.error);
          setResult(acc);
          return;
        }
        acc.inserted += r.result.inserted;
        acc.updated += r.result.updated;
        acc.equipment += r.result.equipment;
        acc.banks += r.result.banks;
        for (const e of r.result.errors) acc.errors.push({ row: e.row + i, message: e.message });
        setProgress(Math.min(i + CHUNK, preview.length));
      }
      setResult(acc);
      if (acc.inserted > 0 || acc.updated > 0) {
        notify.success(
          `${acc.inserted} nuevos · ${acc.updated} completados`,
          [
            acc.equipment > 0 ? `${acc.equipment} equipos` : "",
            acc.banks > 0 ? `${acc.banks} cuentas banco` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        );
      }
      if (acc.errors.length > 0) notify.warning(`${acc.errors.length} avisos`);
    });
  }

  function downloadTemplate() {
    const example = [
      "CL-0001",
      "particular",
      "",
      "",
      "Juan",
      "Pérez García",
      "12345678Z",
      "600111222",
      "",
      "juan@email.com",
      "Calle",
      "Mayor",
      "3",
      "",
      "2º",
      "B",
      "28001",
      "Madrid",
      "Madrid",
      "Juan Pérez García",
      "ES0000000000000000000000",
      "SI",
      "Ósmosis 5 etapas",
      "",
      "SN-001",
      "2024-03-15",
      "2025-09-15",
      "6",
      "alquiler",
      "29,90",
      "2024-03-15",
      "Cliente heredado",
    ];
    const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [TEMPLATE_HEADERS, example].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4" /> Importar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar clientes (Excel o CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              Sube el <strong>.xlsx</strong> (o CSV) con tus clientes. Importa{" "}
              <strong>con histórico</strong>: datos + dirección troceada + banco
              (IBAN) + equipos + mantenimientos.
            </p>
            <p className="mt-1">
              <strong>Una fila por equipo</strong>; si un cliente tiene varios
              equipos, repite su <code>codigo</code> en varias filas. Solo son
              obligatorios <code>codigo</code> + <code>nombre</code> (o{" "}
              <code>razon_social</code>). <strong>Puedes dejar campos vacíos</strong>{" "}
              y volver a subir el mismo archivo más tarde: casa por{" "}
              <code>codigo</code> y <strong>no duplica</strong>, solo completa lo
              que falte. El mantenimiento se cuadra con{" "}
              <code>ultimo_mantenimiento</code> + <code>periodicidad_meses</code>.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={downloadTemplate}
              type="button"
            >
              <FileText className="h-4 w-4" /> Descargar plantilla CSV
            </Button>
          </div>
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={onFile}
            disabled={pending}
            className="block w-full rounded-xl border border-input bg-background p-3 text-sm"
          />
          {fileName && preview.length > 0 && (
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" /> {fileName} · {preview.length} filas
              </div>
              <div className="mt-2 max-h-48 overflow-auto rounded-lg border bg-card text-xs">
                <table className="w-full">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-2 py-1 text-left">Código</th>
                      <th className="px-2 py-1 text-left">Tipo</th>
                      <th className="px-2 py-1 text-left">Nombre / Razón</th>
                      <th className="px-2 py-1 text-left">DNI/CIF</th>
                      <th className="px-2 py-1 text-left">IBAN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{r.external_code ?? "—"}</td>
                        <td className="px-2 py-1">{r.party_kind}</td>
                        <td className="px-2 py-1">
                          {r.party_kind === "company"
                            ? r.legal_name ?? "—"
                            : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—"}
                        </td>
                        <td className="px-2 py-1">{r.tax_id ?? "—"}</td>
                        <td className="px-2 py-1">{r.iban ? "✓" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 10 && (
                  <div className="border-t p-2 text-center text-muted-foreground">
                    + {preview.length - 10} filas más…
                  </div>
                )}
              </div>
            </div>
          )}
          {result && (
            <div className="space-y-2 rounded-xl border-2 border-success bg-success/5 p-3">
              <div className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 className="h-4 w-4" />
                {result.inserted} nuevos · {result.updated} completados ·{" "}
                {result.equipment} equipos · {result.banks} banco ·{" "}
                {result.errors.length} avisos
              </div>
              {result.errors.length > 0 && (
                <ul className="space-y-1 text-xs text-destructive">
                  {result.errors.slice(0, 6).map((e, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <AlertTriangle className="mt-0.5 h-3 w-3" />
                      Fila {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {result ? "Cerrar" : "Cancelar"}
            </Button>
            <Button onClick={importIt} disabled={pending || preview.length === 0}>
              {pending
                ? progress > 0
                  ? `Importando ${progress}/${preview.length}…`
                  : "Procesando…"
                : `Importar ${preview.length}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
