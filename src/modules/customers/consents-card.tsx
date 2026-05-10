"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  recordCustomerConsent,
  type ConsentRow,
  type ConsentKind,
} from "./consents-actions";

const KIND_LABEL: Record<ConsentKind, string> = {
  commercial: "Comunicaciones comerciales",
  data_processing: "Tratamiento de datos",
  profiling: "Perfilado para marketing",
};

const KIND_DESCRIPTION: Record<ConsentKind, string> = {
  commercial: "Permite enviar emails / WhatsApp con ofertas, novedades y promociones.",
  data_processing: "Necesario para el contrato. Sin esto no se puede facturar ni atender.",
  profiling: "Permite usar datos para segmentar campañas (productos relevantes, ofertas).",
};

const ALL_KINDS: ConsentKind[] = ["commercial", "data_processing", "profiling"];

export function CustomerConsentsCard({
  customerId,
  consents,
}: {
  customerId: string;
  consents: ConsentRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const consentByKind = new Map(consents.map((c) => [c.kind, c]));

  function setConsent(kind: ConsentKind, granted: boolean) {
    startTransition(async () => {
      try {
        await recordCustomerConsent({
          customer_id: customerId,
          kind,
          granted,
          source: "manual",
        });
        notify.success(
          granted ? "Consentimiento registrado" : "Consentimiento revocado",
        );
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🛡 Consentimientos RGPD
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {ALL_KINDS.map((kind) => {
            const c = consentByKind.get(kind);
            const granted = c?.granted === true;
            const recorded = !!c;
            return (
              <li
                key={kind}
                className={`rounded-xl border-2 p-3 ${
                  granted
                    ? "border-success/40 bg-success/5"
                    : recorded
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{KIND_LABEL[kind]}</span>
                      {!recorded ? (
                        <Badge variant="secondary">Sin registrar</Badge>
                      ) : granted ? (
                        <Badge variant="success">Concedido</Badge>
                      ) : (
                        <Badge variant="destructive">Revocado</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {KIND_DESCRIPTION[kind]}
                    </p>
                    {recorded && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Última actualización:{" "}
                        {new Date(c!.granted_at).toLocaleString("es-ES")} ·
                        Origen: {c!.source}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant={granted ? "outline" : "success"}
                      onClick={() => setConsent(kind, true)}
                      disabled={pending || granted}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Conceder
                    </Button>
                    <Button
                      size="sm"
                      variant={!granted && recorded ? "outline" : "destructive"}
                      onClick={() => setConsent(kind, false)}
                      disabled={pending || (recorded && !granted)}
                    >
                      <ShieldX className="h-3.5 w-3.5" /> Revocar
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Cada cambio queda registrado con fecha, origen y usuario en
          customer_consents para cumplir RGPD. El histórico es inmutable.
        </p>
      </CardContent>
    </Card>
  );
}
