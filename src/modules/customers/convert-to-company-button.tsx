"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import {
  checkConversionImpactsAction,
  convertCustomerSafeAction,
  type ConversionImpacts,
} from "./convert-actions";

type Mode = "autonomo" | "empresa";

/**
 * Convierte un cliente particular en autónomo o empresa (o un autónomo en
 * empresa). Solo visible para admin (lo controla la página). El titular
 * actual pasa a persona de contacto; su DNI queda en notas + timeline.
 */
export function ConvertToCompanyButton({
  customerId,
  current,
}: {
  customerId: string;
  current: {
    party_kind: "individual" | "company";
    is_autonomo: boolean;
    first_name: string | null;
    last_name: string | null;
    tax_id: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const fromAutonomo = current.party_kind === "company" && current.is_autonomo;
  const [mode, setMode] = useState<Mode>(fromAutonomo ? "empresa" : "autonomo");
  const [impacts, setImpacts] = useState<ConversionImpacts | null>(null);

  const fullName = `${current.first_name ?? ""} ${current.last_name ?? ""}`.trim();
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [cif, setCif] = useState("");
  const [contactName, setContactName] = useState(fullName);

  function openDialog() {
    setMode(fromAutonomo ? "empresa" : "autonomo");
    setLegalName("");
    setTradeName("");
    setCif("");
    setContactName(fullName);
    setImpacts(null);
    setOpen(true);
    startTransition(async () => {
      const r = await checkConversionImpactsAction(customerId);
      if (r.ok) setImpacts(r.impacts);
    });
  }

  function save() {
    startTransition(async () => {
      const parts = contactName.trim().split(/\s+/);
      const r = await convertCustomerSafeAction(customerId, {
        mode,
        legal_name: legalName,
        trade_name: tradeName,
        tax_id: cif,
        contact_first_name: mode === "empresa" ? (parts[0] ?? "") : "",
        contact_last_name: mode === "empresa" ? parts.slice(1).join(" ") : "",
      });
      if (!r.ok) {
        notify.error("No se pudo convertir", r.error);
        return;
      }
      notify.success(
        mode === "autonomo" ? "Cliente convertido a autónomo" : "Cliente convertido a empresa",
      );
      setOpen(false);
      router.refresh();
    });
  }

  const canSave =
    mode === "autonomo" || (legalName.trim().length > 0 && cif.trim().length > 0);

  const warnings: string[] = [];
  if (impacts) {
    if (impacts.active_contracts > 0) {
      warnings.push(
        `${impacts.active_contracts} contrato(s) de alquiler/renting activo(s): las próximas cuotas se emitirán a la nueva titularidad. El contrato firmado y las facturas ya emitidas NO cambian${mode === "empresa" ? "; valora si procede novar el contrato" : ""}.`,
      );
    }
    if (impacts.active_mandates > 0) {
      warnings.push(
        `${impacts.active_mandates} mandato(s) SEPA activo(s) a nombre del titular actual: para domiciliar los cobros a la nueva titularidad hay que firmar un mandato nuevo.`,
      );
    }
    if (impacts.open_proposals > 0) {
      warnings.push(
        `${impacts.open_proposals} propuesta(s) abierta(s): conservan los precios de particular; regenerarlas si procede.`,
      );
    }
  }
  warnings.push(
    "A partir de ahora se aplican los precios de empresa (base + IVA) en propuestas y facturas nuevas.",
  );

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Building2 className="h-4 w-4" />
        {fromAutonomo ? "Pasar a empresa" : "Convertir en empresa"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {fromAutonomo ? "Pasar autónomo a empresa" : "Convertir en autónomo o empresa"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {!fromAutonomo && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "autonomo",
                      title: "Autónomo",
                      desc: "Misma persona con actividad económica. Conserva su nombre y su DNI/NIE.",
                    },
                    {
                      value: "empresa",
                      title: "Empresa (nueva titularidad)",
                      desc: "Razón social y CIF nuevos. El titular actual pasa a persona de contacto.",
                    },
                  ] as Array<{ value: Mode; title: string; desc: string }>
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={`rounded-xl border p-3 text-left text-sm transition ${
                      mode === opt.value
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="font-semibold">{opt.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{opt.desc}</div>
                  </button>
                ))}
              </div>
            )}

            {mode === "autonomo" ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <strong>{fullName || "El cliente"}</strong> pasará a tratarse como
                  empresa (precio base + IVA, financieras de autónomo) manteniendo su
                  nombre y su DNI/NIE{current.tax_id ? ` (${current.tax_id})` : ""}.
                </div>
                <div className="space-y-1.5">
                  <Label>Nombre comercial (opcional)</Label>
                  <Input
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    placeholder="P. ej. Fontanería Pérez"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>
                    Razón social <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Aguas del Norte S.L."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    CIF <span className="text-destructive">*</span>
                  </Label>
                  <TaxIdInput kind="cif" value={cif} onChange={setCif} placeholder="B12345678" />
                </div>
                <div className="space-y-1.5">
                  <Label>Nombre comercial (opcional)</Label>
                  <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Persona de contacto</Label>
                  <Input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Nombre y apellidos"
                  />
                  <p className="text-xs text-muted-foreground">
                    Por defecto, el titular actual. Su DNI
                    {current.tax_id ? ` (${current.tax_id})` : ""} quedará registrado en las
                    notas y en el historial del cliente.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending || !canSave} variant="success">
              {pending ? "Convirtiendo..." : "Convertir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
