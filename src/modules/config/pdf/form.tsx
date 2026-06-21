"use client";

import { useState, useTransition } from "react";
import { FileText, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { cn } from "@/shared/lib/utils";
import {
  updatePdfSettingsAction,
  type PdfSettings,
  type DatasheetTemplate,
} from "./actions";

const TEMPLATES: Array<{
  key: DatasheetTemplate;
  label: string;
  desc: string;
  icon: typeof FileText;
}> = [
  {
    key: "standard",
    label: "Estándar",
    desc: "Ficha técnica sobria de una página, con tabla de especificaciones. La que trae el sistema.",
    icon: FileText,
  },
  {
    key: "iagua",
    label: "IAGUA",
    desc: "Diseño premium de 2 páginas: portada con hero y foto, características en tarjetas, ficha técnica y página de ventajas. Colores personalizables.",
    icon: Sparkles,
  },
];

function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-semibold">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1"
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-32 rounded-xl border border-input bg-background px-3 font-mono text-sm uppercase"
          maxLength={7}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PdfSettingsForm({ initial }: { initial: PdfSettings }) {
  const [template, setTemplate] = useState<DatasheetTemplate>(initial.datasheet_template);
  const [brand, setBrand] = useState(initial.pdf_brand_color);
  const [accent, setAccent] = useState(initial.pdf_accent_color);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await updatePdfSettingsAction({
        datasheet_template: template,
        pdf_brand_color: brand,
        pdf_accent_color: accent,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Guardado", "El formato de las fichas PDF se ha actualizado.");
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Plantilla de ficha técnica
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            const selected = template === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTemplate(t.key)}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl",
                      selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-bold">{t.label}</span>
                  {selected && (
                    <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      Activa
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Colores de la plantilla
        </div>
        <div className="flex flex-wrap gap-6">
          <ColorField
            label="Color base"
            value={brand}
            onChange={setBrand}
            hint="Cabecera, títulos y cajas oscuras (azul marino en IAGUA)."
          />
          <ColorField
            label="Color de acento"
            value={accent}
            onChange={setAccent}
            hint="Detalles, barras y la palabra destacada del título."
          />
        </div>
        <p className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          El <strong>color de acento</strong> se puede afinar por producto desde su ficha
          (campo «color de acento»), para que cada equipo tenga su tono — como el dorado del
          Golden Eye frente al azul del resto.
        </p>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button onClick={save} disabled={pending} variant="success" className="w-full sm:w-auto">
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
