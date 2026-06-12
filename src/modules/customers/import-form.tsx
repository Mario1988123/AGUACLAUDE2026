"use client";

import { useState, useTransition } from "react";
import { Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { importCustomersSafeAction, type ImportCustomerRow, type ImportResult } from "./import-actions";

const HEADER_MAP: Record<string, keyof ImportCustomerRow> = {
  tipo: "party_kind",
  party_kind: "party_kind",
  razon_social: "legal_name",
  legal_name: "legal_name",
  nombre_comercial: "trade_name",
  trade_name: "trade_name",
  nombre: "first_name",
  first_name: "first_name",
  apellidos: "last_name",
  last_name: "last_name",
  email: "email",
  telefono: "phone_primary",
  telefono_1: "phone_primary",
  phone: "phone_primary",
  phone_primary: "phone_primary",
  telefono_secundario: "phone_secondary",
  telefono_2: "phone_secondary",
  phone_secondary: "phone_secondary",
  dni: "tax_id",
  cif: "tax_id",
  dni_cif: "tax_id",
  tax_id: "tax_id",
  notas: "notes",
  notes: "notes",
  // Dirección
  direccion: "address_street",
  calle: "address_street",
  address_street: "address_street",
  cp: "address_postal_code",
  codigo_postal: "address_postal_code",
  poblacion: "address_city",
  ciudad: "address_city",
  provincia: "address_province",
  // Equipo + mantenimiento (1 fila = 1 equipo)
  equipo: "equipment_name",
  equipo_nombre: "equipment_name",
  modelo: "equipment_name",
  marca: "equipment_brand",
  equipo_marca: "equipment_brand",
  numero_serie: "serial_number",
  n_serie: "serial_number",
  serial: "serial_number",
  fecha_instalacion: "installed_at",
  instalado_el: "installed_at",
  periodicidad_meses: "maintenance_periodicity_months",
  periodicidad: "maintenance_periodicity_months",
  ultimo_mantenimiento: "last_maintenance_at",
  proximo_mantenimiento: "next_maintenance_at",
};

function parseCsv(text: string): ImportCustomerRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  function splitLine(line: string): string[] {
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
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  const headers = splitLine(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z_]/g, "_"));
  const rows: ImportCustomerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]!);
    const row: ImportCustomerRow = { party_kind: "individual" };
    headers.forEach((h, j) => {
      const key = HEADER_MAP[h];
      const val = cols[j];
      if (!key || !val) return;
      if (key === "party_kind") {
        const v = val.toLowerCase();
        row.party_kind = v === "company" || v === "empresa" ? "company" : "individual";
      } else if (key === "maintenance_periodicity_months") {
        const n = parseInt(val.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(n) && n > 0) row.maintenance_periodicity_months = n;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (row as any)[key] = val;
      }
    });
    rows.push(row);
  }
  return rows;
}

export function ImportCustomersButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ImportCustomerRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ""));
      setPreview(rows);
    };
    reader.readAsText(f, "utf-8");
  }

  function importIt() {
    if (preview.length === 0) {
      notify.warning("Selecciona un CSV con datos");
      return;
    }
    startTransition(async () => {
      const r = await importCustomersSafeAction(preview);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setResult(r.result);
      if (r.result.inserted > 0)
        notify.success(
          `Importados ${r.result.inserted} clientes`,
          r.result.equipment > 0 ? `${r.result.equipment} equipos con sus mantenimientos` : undefined,
        );
      if (r.result.duplicates > 0) notify.info(`${r.result.duplicates} duplicados ignorados`);
      if (r.result.errors.length > 0) notify.warning(`${r.result.errors.length} errores`);
    });
  }

  function downloadTemplate() {
    const headers = [
      "tipo",
      "razon_social",
      "nombre",
      "apellidos",
      "dni_cif",
      "telefono_1",
      "telefono_2",
      "email",
      "direccion",
      "cp",
      "poblacion",
      "provincia",
      "notas",
      "equipo",
      "marca",
      "numero_serie",
      "fecha_instalacion",
      "periodicidad_meses",
      "ultimo_mantenimiento",
      "proximo_mantenimiento",
    ];
    const examples = [
      ["individual", "", "Juan", "Pérez García", "12345678Z", "600111222", "", "juan@email.com", "Calle Mayor 3", "28001", "Madrid", "Madrid", "Cliente del CRM antiguo", "Ósmosis 5 etapas", "", "SN-001", "2024-03-15", "6", "2025-09-15", "2026-03-15"],
      ["individual", "", "Juan", "Pérez García", "12345678Z", "600111222", "", "juan@email.com", "Calle Mayor 3", "28001", "Madrid", "Madrid", "", "Descalcificador BWT", "BWT", "SN-002", "2024-03-15", "12", "2025-03-15", "2026-03-15"],
      ["company", "Aguas del Norte SL", "", "", "B12345678", "910000000", "910000001", "info@aguasnorte.es", "Pol. Ind. Sur, nave 4", "28100", "Alcobendas", "Madrid", "", "Equipo industrial", "", "SN-100", "2023-06-01", "4", "2025-06-01", "2025-10-01"],
    ];
    const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [headers, ...examples].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-clientes-hidromanager.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4" /> Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar clientes desde CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              Importa clientes del CRM antiguo <strong>con histórico</strong>: datos + dirección
              + equipo + mantenimientos. <strong>Una fila por equipo</strong>; si un cliente tiene
              varios equipos, repite sus datos (mismo DNI) en varias filas.
            </p>
            <p className="mt-1">
              Columnas: <code>tipo (individual/company), razon_social, nombre, apellidos, dni_cif,
              telefono_1, telefono_2, email, direccion, cp, poblacion, provincia, notas, equipo,
              marca, numero_serie, fecha_instalacion, periodicidad_meses, ultimo_mantenimiento,
              proximo_mantenimiento</code>. Si <code>equipo</code> coincide con un producto tuyo se
              vincula al catálogo; si no, se guarda como equipo externo. Con <code>periodicidad_meses</code>
              se generan los mantenimientos del próximo año. Duplicados (DNI/email/teléfono) se ignoran.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={downloadTemplate} type="button">
              <FileText className="h-4 w-4" /> Descargar plantilla CSV
            </Button>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
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
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Tipo</th>
                      <th className="px-2 py-1 text-left">Nombre / Razón</th>
                      <th className="px-2 py-1 text-left">Email</th>
                      <th className="px-2 py-1 text-left">Teléfono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1">{r.party_kind}</td>
                        <td className="px-2 py-1">
                          {r.party_kind === "company"
                            ? r.legal_name ?? "—"
                            : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—"}
                        </td>
                        <td className="px-2 py-1">{r.email ?? "—"}</td>
                        <td className="px-2 py-1">{r.phone_primary ?? "—"}</td>
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
                {result.inserted} clientes · {result.equipment} equipos · {result.duplicates} duplicados · {result.errors.length} errores
              </div>
              {result.errors.length > 0 && (
                <ul className="space-y-1 text-xs text-destructive">
                  {result.errors.slice(0, 5).map((e, i) => (
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
              {pending ? "Importando..." : `Importar ${preview.length}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
