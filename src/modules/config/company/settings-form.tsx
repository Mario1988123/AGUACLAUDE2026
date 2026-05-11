"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateCompanySettingsAction, type CompanySettings } from "./actions";

export function CompanySettingsForm({ initial }: { initial: CompanySettings }) {
  const [pdfColor, setPdfColor] = useState(initial.pdf_brand_color);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateCompanySettingsAction({
          pdf_brand_color: pdfColor,
        });
        notify.success("Configuración guardada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/*
        Datos fiscales viven en /configuracion/fiscal — fuente única.
        Horario comercial vive en /configuracion/horarios desde 2026-05-11.
        Tolerancias instalación viven en /configuracion/instalaciones desde
        2026-05-11.
      */}
      <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm space-y-1">
        <p>
          <strong>Datos fiscales</strong> (razón social, CIF, dirección, teléfono,
          email, IBAN) →{" "}
          <Link
            href="/configuracion/fiscal"
            className="font-bold text-primary hover:underline"
          >
            Datos fiscales
          </Link>
        </p>
        <p>
          <strong>Horario comercial</strong> →{" "}
          <Link
            href="/configuracion/horarios"
            className="font-bold text-primary hover:underline"
          >
            Horarios y vacaciones
          </Link>
        </p>
        <p>
          <strong>Tolerancias instalación</strong> (geo, tiempo) →{" "}
          <Link
            href="/configuracion/instalaciones"
            className="font-bold text-primary hover:underline"
          >
            Instalaciones
          </Link>
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Marca corporativa
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Color PDF</Label>
            <Input
              type="color"
              value={pdfColor}
              onChange={(e) => setPdfColor(e.target.value)}
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              Color principal aplicado en cabeceras y bandas de PDFs (contratos,
              propuestas, albaranes).
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar configuración"}
        </Button>
      </div>
    </form>
  );
}
