"use client";

import { useState, useTransition } from "react";
import { Globe, RefreshCw, Check, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  addMailingDomainSafeAction,
  verifyMailingDomainSafeAction,
  type DomainStatus,
} from "./actions";

export function DomainSetupPanel({
  initialDomain,
}: {
  initialDomain: DomainStatus | null;
}) {
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function add() {
    if (!domain.trim()) {
      notify.warning("Introduce un dominio");
      return;
    }
    startTransition(async () => {
      const r = await addMailingDomainSafeAction(domain);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(
        "Dominio añadido",
        "Pega los DNS records en tu proveedor y pulsa Verificar.",
      );
      location.reload();
    });
  }

  function recheck() {
    startTransition(async () => {
      const r = await verifyMailingDomainSafeAction();
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      if (r.status === "verified") {
        notify.success("✓ Dominio verificado");
      } else {
        notify.warning(
          "Aún pendiente",
          "Los DNS pueden tardar 24h en propagar. Vuelve a intentarlo en unas horas.",
        );
      }
      location.reload();
    });
  }

  async function copy(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      notify.warning("No se pudo copiar");
    }
  }

  if (!initialDomain) {
    return (
      <div className="space-y-3">
        <Label>Dominio de tu empresa</Label>
        <div className="flex gap-2">
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="aguasl.com"
            className="flex-1"
          />
          <Button onClick={add} disabled={pending}>
            <Globe className="h-4 w-4" /> Añadir
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Sin <code>http://</code> ni <code>www.</code> Solo el dominio raíz.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
        <Globe className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <div className="font-bold">{initialDomain.domain}</div>
          {initialDomain.verified_at && (
            <div className="text-xs text-emerald-700">
              ✓ Verificado el{" "}
              {new Date(initialDomain.verified_at).toLocaleDateString("es-ES")}
            </div>
          )}
          {initialDomain.failure_reason && (
            <div className="text-xs text-destructive">
              {initialDomain.failure_reason}
            </div>
          )}
        </div>
        {initialDomain.status !== "verified" && (
          <Button
            size="sm"
            variant="outline"
            onClick={recheck}
            disabled={pending}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Verificar
          </Button>
        )}
      </div>

      {initialDomain.status !== "verified" && (
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>Pega estos registros DNS</strong> en tu proveedor (IONOS,
                Cloudflare, GoDaddy...) y luego pulsa <strong>Verificar</strong>.
                La propagación tarda entre 5 minutos y 24 horas.
              </div>
            </div>
          </div>

          {initialDomain.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cargando registros DNS desde Resend…
            </p>
          ) : (
            <div className="space-y-2">
              {initialDomain.records.map((r, i) => (
                <div
                  key={i}
                  className="rounded-lg border bg-card p-3 text-xs"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <Badge variant="outline">{r.type}</Badge>
                    <Badge
                      variant={
                        r.status === "verified" ? "success" : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {r.status === "verified" ? "✓ verificado" : "pendiente"}
                    </Badge>
                  </div>
                  <DnsField
                    label="Nombre"
                    value={r.name}
                    field={`name-${i}`}
                    copy={copy}
                    copiedField={copiedField}
                  />
                  <DnsField
                    label="Valor"
                    value={r.value}
                    field={`value-${i}`}
                    copy={copy}
                    copiedField={copiedField}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DnsField({
  label,
  value,
  field,
  copy,
  copiedField,
}: {
  label: string;
  value: string;
  field: string;
  copy: (v: string, f: string) => void;
  copiedField: string | null;
}) {
  return (
    <div className="mt-1">
      <div className="text-[10px] font-bold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5">
        <code className="flex-1 select-all break-all font-mono text-[11px]">
          {value}
        </code>
        <button
          type="button"
          onClick={() => copy(value, field)}
          className="rounded p-1 hover:bg-muted"
          aria-label={`Copiar ${label}`}
        >
          {copiedField === field ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
