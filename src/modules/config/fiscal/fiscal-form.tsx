"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { updateFiscalSettingsAction, type FiscalSettings } from "./actions";

export function FiscalSettingsForm({ initial }: { initial: FiscalSettings }) {
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set<K extends keyof FiscalSettings>(key: K, val: FiscalSettings[K]) {
    setV((x) => ({ ...x, [key]: val }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateFiscalSettingsAction(v);
        notify.success("Datos fiscales guardados");
        // Refrescar el page server component para confirmar que la BD
        // realmente tiene los valores (rehidrata el form).
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
        // Aún así refrescamos para que el usuario vea qué se guardó
        // realmente vs lo que se quedó vacío.
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identificación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Razón social *</Label>
            <Input
              value={v.fiscal_legal_name ?? ""}
              onChange={(e) => set("fiscal_legal_name", e.target.value || null)}
              placeholder="Mi Empresa S.L."
            />
          </div>
          <div className="space-y-1.5">
            <Label>CIF / NIF *</Label>
            <Input
              value={v.fiscal_tax_id ?? ""}
              onChange={(e) => set("fiscal_tax_id", e.target.value || null)}
              placeholder="B12345678"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Registro mercantil</Label>
            <Input
              value={v.fiscal_mercantile_reg ?? ""}
              onChange={(e) => set("fiscal_mercantile_reg", e.target.value || null)}
              placeholder="Inscrita en RM Madrid, Tomo X, Folio Y..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Domicilio fiscal</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Dirección</Label>
            <Input
              value={v.fiscal_street ?? ""}
              onChange={(e) => set("fiscal_street", e.target.value || null)}
              placeholder="Calle, número, piso..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Código postal</Label>
            <Input
              value={v.fiscal_postal_code ?? ""}
              onChange={(e) => set("fiscal_postal_code", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ciudad</Label>
            <Input
              value={v.fiscal_city ?? ""}
              onChange={(e) => set("fiscal_city", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Provincia</Label>
            <Input
              value={v.fiscal_province ?? ""}
              onChange={(e) => set("fiscal_province", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>País</Label>
            <Input
              value={v.fiscal_country}
              onChange={(e) => set("fiscal_country", e.target.value || "España")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacto y bancarios</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={v.fiscal_email ?? ""}
              onChange={(e) => set("fiscal_email", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Teléfono</Label>
            <Input
              value={v.fiscal_phone ?? ""}
              onChange={(e) => set("fiscal_phone", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>IBAN</Label>
            <Input
              value={v.fiscal_iban ?? ""}
              onChange={(e) => set("fiscal_iban", e.target.value || null)}
              placeholder="ES00 0000 0000 0000 0000 0000"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>URL del logo (opcional)</Label>
            <Input
              value={v.fiscal_logo_url ?? ""}
              onChange={(e) => set("fiscal_logo_url", e.target.value || null)}
              placeholder="https://..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facturación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>IVA por defecto (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={v.invoice_default_iva}
              onChange={(e) => set("invoice_default_iva", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Días de vencimiento por defecto</Label>
            <Input
              type="number"
              min={0}
              value={v.invoice_default_due_days}
              onChange={(e) => set("invoice_default_due_days", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Pie de factura (texto legal)</Label>
            <textarea
              value={v.invoice_footer_text ?? ""}
              onChange={(e) => set("invoice_footer_text", e.target.value || null)}
              rows={3}
              className="w-full rounded-xl border border-border bg-card p-3 text-sm"
              placeholder="Forma de pago, condiciones, datos LSSI..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success" size="lg" className="gap-2">
          <Save className="h-5 w-5" /> {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
