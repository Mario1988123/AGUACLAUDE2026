"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { setCompanyEmailProviderSafeAction } from "./actions";

type Provider = "smtp" | "resend";

interface Props {
  companyId: string;
  initial: Provider;
  /** Si la empresa ya tiene dominio Resend verificado (info para el aviso). */
  resendDomainVerified?: boolean;
}

const LABEL: Record<Provider, string> = {
  smtp: "SMTP propio (por defecto)",
  resend: "Resend (cuenta de plataforma)",
};

const DESC: Record<Provider, string> = {
  smtp: "La empresa envía con su propio servidor SMTP (configurado en /configuracion/mailing). Sin tracking de aperturas/clics.",
  resend:
    "Los emails de la empresa salen por TU cuenta Resend (tú pagas). Mejor entregabilidad y recupera el tracking de aperturas/clics vía webhook. Requiere que la empresa verifique su dominio en /configuracion/mailing.",
};

export function CompanyEmailProviderPanel({
  companyId,
  initial,
  resendDomainVerified,
}: Props) {
  const [provider, setProvider] = useState<Provider>(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      const r = await setCompanyEmailProviderSafeAction({
        company_id: companyId,
        provider,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Proveedor de email actualizado");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">
          Proveedor actual: <strong>{LABEL[initial]}</strong>
        </span>
      </div>

      <div className="space-y-2">
        {(Object.keys(LABEL) as Provider[]).map((p) => (
          <label
            key={p}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition ${
              provider === p
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name="email_provider"
              value={p}
              checked={provider === p}
              onChange={() => setProvider(p)}
              className="mt-1"
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm">{LABEL[p]}</span>
                {p === "resend" && (
                  <Badge variant="warning" className="text-[10px]">
                    Coste plataforma
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{DESC[p]}</p>
            </div>
          </label>
        ))}
      </div>

      {provider === "resend" && !resendDomainVerified && (
        <div className="rounded-xl border border-amber-300/50 bg-amber-50/50 p-3 text-xs text-amber-800">
          Esta empresa aún no tiene un dominio Resend verificado. Hasta que lo
          verifique en <code>/configuracion/mailing</code>, sus emails seguirán
          saliendo por SMTP (degradación suave).
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success" className="gap-2">
          <Save className="h-4 w-4" />
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
