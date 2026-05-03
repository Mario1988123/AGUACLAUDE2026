import Link from "next/link";
import { notFound } from "next/navigation";
import { getProposal, getProposalItems, listProposalVariants } from "@/modules/proposals/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/proposals/schemas";
import { ProposalActions } from "@/modules/proposals/actions-panel";
import { ProposalVariantsCard } from "@/modules/proposals/variants-card";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let proposal;
  try {
    proposal = await getProposal(id);
  } catch {
    notFound();
  }
  const items = await getProposalItems(id);
  const variants = await listProposalVariants(id).catch(() => []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Propuesta {proposal.reference_code ?? "(sin código)"}</h1>
            <Badge variant={STATUS_VARIANT[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge>
            <Badge variant="outline">v{proposal.version_number}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Para: <strong>{proposal.customer_or_lead_name}</strong>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/pdf/proposal/${proposal.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📄 Descargar PDF
          </a>
          <Link href="/propuestas" className="text-sm text-primary hover:underline">
            ← Volver
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Productos</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin productos.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Producto</th>
                    <th className="py-2 text-right">Cant.</th>
                    <th className="py-2 text-right">Precio</th>
                    <th className="py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2">{it.product_name_snapshot}</td>
                      <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCents(it.unit_price_cash_cents)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCents((it.unit_price_cash_cents ?? 0) * it.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td colSpan={3} className="py-3 text-right">
                      Total contado
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCents(proposal.total_cash_cents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <ProposalActions proposalId={proposal.id} status={proposal.status} />
            {proposal.validity_until && (
              <p className="mt-4 text-xs text-muted-foreground">
                Validez hasta {proposal.validity_until}
              </p>
            )}
            {proposal.rejected_reason && (
              <p className="mt-4 text-xs">
                <strong>Motivo rechazo:</strong> {proposal.rejected_reason}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <ProposalVariantsCard proposalId={proposal.id} variants={variants} />

      {proposal.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{proposal.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
