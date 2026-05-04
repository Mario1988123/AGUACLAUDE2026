"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSignature, FileText, Send } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { markProposalAccepted, markProposalSent } from "./actions";
import { createContractFromProposal } from "@/modules/contracts/actions";
import type { ProposalListItem } from "./types";
import { STATUS_LABEL, STATUS_VARIANT } from "./schemas";

function fmtEur(c: number | null) {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function ProposalsCard({
  proposals,
  scope,
  onAcceptedRedirect,
}: {
  proposals: ProposalListItem[];
  scope: "lead" | "customer";
  /** Si true (sólo en ficha lead), tras aceptar redirige al cliente nuevo */
  onAcceptedRedirect?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  function send(id: string) {
    startTransition(async () => {
      try {
        await markProposalSent(id);
        notify.success("Propuesta enviada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function accept(id: string) {
    const ok = await ask({
      message: "¿Aceptar esta propuesta? Si es de un lead se convertirá automáticamente en cliente.",
      confirmText: "Aceptar",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const res = await markProposalAccepted(id);
        notify.success("Propuesta aceptada");
        if (onAcceptedRedirect && res.customer_id) {
          router.push(`/clientes/${res.customer_id}` as never);
          return;
        }
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function generateContract(id: string) {
    const ok = await ask({
      message:
        "¿Generar el contrato a partir de esta propuesta? Se creará en estado borrador para revisar y firmar.",
      confirmText: "Generar",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await createContractFromProposal(id);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (proposals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
        Sin propuestas todavía.{" "}
        <Link href="/propuestas/nueva" className="text-primary hover:underline">
          Crear una →
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {proposals.map((p) => {
        const canSend = p.status === "draft";
        const canAccept = p.status === "draft" || p.status === "sent";
        // Sólo mostrar "Generar contrato" si está aceptada Y todavía no
        // tiene contrato asociado. Si ya lo tiene, mostramos en su lugar
        // un atajo "Contrato ya generado" para no permitir duplicados.
        const canGenerateContract =
          p.status === "accepted" && scope === "customer" && !p.has_contract;
        return (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/propuestas/${p.id}` as never}
                className="text-sm font-semibold hover:underline"
              >
                {p.reference_code ?? `#${p.id.slice(0, 8)}`}
              </Link>
              <span className="ml-2 text-xs text-muted-foreground">v{p.version_number}</span>
              <div className="text-xs text-muted-foreground">
                {fmtEur(p.total_cash_cents)} ·{" "}
                {new Date(p.created_at).toLocaleDateString("es-ES")}
              </div>
            </div>
            <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
            {canSend && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => send(p.id)}
                disabled={pending}
              >
                <Send className="h-3 w-3" /> Enviar
              </Button>
            )}
            {canAccept && (
              <Button
                size="sm"
                variant="success"
                onClick={() => accept(p.id)}
                disabled={pending}
              >
                <CheckCircle2 className="h-3 w-3" />
                {scope === "lead" ? "Aceptar y convertir" : "Aceptar"}
              </Button>
            )}
            {canGenerateContract && (
              <Button
                size="sm"
                variant="success"
                onClick={() => generateContract(p.id)}
                disabled={pending}
              >
                <FileSignature className="h-3 w-3" />
                Generar contrato
              </Button>
            )}
            {p.status === "accepted" && p.has_contract && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                <FileSignature className="h-3 w-3" /> Contrato ya generado
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
