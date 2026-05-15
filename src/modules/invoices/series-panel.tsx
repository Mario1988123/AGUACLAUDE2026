"use client";

import { useState, useTransition } from "react";
import { Plus, Star } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { upsertInvoiceSeriesAction } from "./verifactu-actions";

interface SeriesRow {
  id: string;
  code: string;
  name: string;
  invoice_type: string;
  next_number: number;
  current_year: number;
  year_reset: boolean;
  is_default: boolean;
}

export function InvoiceSeriesPanel({ series }: { series: SeriesRow[] }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [yearReset, setYearReset] = useState(true);
  const [isDefault, setIsDefault] = useState(series.length === 0);

  function save() {
    if (!code.trim() || !name.trim()) {
      notify.warning("Código y nombre obligatorios");
      return;
    }
    startTransition(async () => {
      const r = await upsertInvoiceSeriesAction({
        code,
        name,
        prefix: prefix || undefined,
        year_reset: yearReset,
        is_default: isDefault,
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Serie creada");
      setCode("");
      setName("");
      setPrefix("");
      setOpen(false);
      location.reload();
    });
  }

  return (
    <div className="space-y-3">
      {series.length === 0 ? (
        <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠ Sin series creadas. Crea al menos una para poder emitir facturas.
        </p>
      ) : (
        <div className="space-y-2">
          {series.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg border bg-card p-3"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{s.code}</span>
                    {s.is_default && (
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {s.invoice_type}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{s.name}</div>
                </div>
              </div>
              <div className="text-right text-xs">
                <div className="font-semibold">
                  Siguiente: {s.code}-{s.current_year}-
                  {String(s.next_number).padStart(4, "0")}
                </div>
                <div className="text-muted-foreground">
                  {s.year_reset ? "Reset anual" : "Continuo"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <Button onClick={() => setOpen(true)} size="sm" variant="outline">
          <Plus className="h-4 w-4" /> Nueva serie
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Código *</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="A"
                maxLength={10}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Nombre *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Serie general 2026"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prefijo (opcional)</Label>
            <Input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="FAC-"
            />
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={yearReset}
                onChange={(e) => setYearReset(e.target.checked)}
              />
              Reiniciar contador cada año
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Serie por defecto
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Creando…" : "Crear serie"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
