"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateCompanySettingsAction, type CompanySettings } from "./actions";

export function CompanySettingsForm({ initial }: { initial: CompanySettings }) {
  const [geoTol, setGeoTol] = useState(initial.installation_geo_tolerance_m);
  const [timeTol, setTimeTol] = useState(initial.installation_time_tolerance_min);
  const [pdfColor, setPdfColor] = useState(initial.pdf_brand_color);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateCompanySettingsAction({
          installation_geo_tolerance_m: geoTol,
          installation_time_tolerance_min: timeTol,
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
        Datos fiscales viven en /configuracion/fiscal — fuente única para
        evitar duplicación. Antes este form pedía esos campos y se pisaban.
        Horario comercial vive en /configuracion/horarios desde 2026-05-11.
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
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Tolerancias instalación
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Geo (m)</Label>
            <Input
              type="number"
              min={50}
              max={5000}
              value={geoTol}
              onChange={(e) => setGeoTol(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Si instalador está más lejos al iniciar parte → incidencia.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Tiempo (min)</Label>
            <Input
              type="number"
              min={0}
              max={240}
              value={timeTol}
              onChange={(e) => setTimeTol(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Margen ± respecto a la hora agendada para iniciar.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Color PDF</Label>
            <Input
              type="color"
              value={pdfColor}
              onChange={(e) => setPdfColor(e.target.value)}
              className="h-12"
            />
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
