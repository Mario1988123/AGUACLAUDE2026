"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateCompanySettingsAction, type CompanySettings } from "./actions";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

export function CompanySettingsForm({ initial }: { initial: CompanySettings }) {
  const [hours, setHours] = useState(initial.business_hours);
  const [geoTol, setGeoTol] = useState(initial.installation_geo_tolerance_m);
  const [timeTol, setTimeTol] = useState(initial.installation_time_tolerance_min);
  const [pdfColor, setPdfColor] = useState(initial.pdf_brand_color);
  const [contactPhone, setContactPhone] = useState(initial.contact_phone ?? "");
  const [contactEmail, setContactEmail] = useState(initial.contact_email ?? "");
  const [fiscalAddress, setFiscalAddress] = useState(initial.fiscal_address ?? "");
  const [fiscalPostalCode, setFiscalPostalCode] = useState(initial.fiscal_postal_code ?? "");
  const [fiscalCity, setFiscalCity] = useState(initial.fiscal_city ?? "");
  const [fiscalProvince, setFiscalProvince] = useState(initial.fiscal_province ?? "");
  const [pending, startTransition] = useTransition();

  function toggleDay(key: string) {
    setHours((h) => ({
      ...h,
      [key]: h[key] ? null : { open: "09:00", close: "18:00" },
    }));
  }
  function setHour(key: string, kind: "open" | "close", value: string) {
    setHours((h) => ({
      ...h,
      [key]: h[key] ? { ...h[key]!, [kind]: value } : { open: "09:00", close: "18:00", [kind]: value },
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateCompanySettingsAction({
          business_hours: hours,
          installation_geo_tolerance_m: geoTol,
          installation_time_tolerance_min: timeTol,
          pdf_brand_color: pdfColor,
          contact_phone: contactPhone || null,
          contact_email: contactEmail || null,
          fiscal_address: fiscalAddress || null,
          fiscal_postal_code: fiscalPostalCode || null,
          fiscal_city: fiscalCity || null,
          fiscal_province: fiscalProvince || null,
        });
        notify.success("Configuración guardada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Datos de la empresa (aparecen en PDFs)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Teléfono</Label>
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Dirección fiscal</Label>
            <Input value={fiscalAddress} onChange={(e) => setFiscalAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>CP</Label>
            <Input
              value={fiscalPostalCode}
              onChange={(e) => setFiscalPostalCode(e.target.value)}
              maxLength={5}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ciudad</Label>
            <Input value={fiscalCity} onChange={(e) => setFiscalCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Provincia</Label>
            <Input value={fiscalProvince} onChange={(e) => setFiscalProvince(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Horario comercial
        </h3>
        <div className="space-y-2">
          {DAYS.map((d) => {
            const active = hours[d.key] != null;
            return (
              <div
                key={d.key}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <label className="flex w-32 items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleDay(d.key)}
                    className="h-5 w-5"
                  />
                  {d.label}
                </label>
                {active ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      type="time"
                      value={hours[d.key]!.open}
                      onChange={(e) => setHour(d.key, "open", e.target.value)}
                      className="max-w-[120px]"
                    />
                    <span>—</span>
                    <Input
                      type="time"
                      value={hours[d.key]!.close}
                      onChange={(e) => setHour(d.key, "close", e.target.value)}
                      className="max-w-[120px]"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Cerrado</span>
                )}
              </div>
            );
          })}
        </div>
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
