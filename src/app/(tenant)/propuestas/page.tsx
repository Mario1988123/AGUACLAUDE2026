import Link from "next/link";
import { listProposals } from "@/modules/proposals/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/proposals/schemas";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function PropuestasPage() {
  const proposals = await listProposals();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Propuestas</h1>
          <p className="text-sm text-muted-foreground">{proposals.length} propuestas</p>
        </div>
        <Button asChild>
          <Link href={"/propuestas/nueva" as never}>+ Nueva propuesta</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Ref.</th>
              <th className="px-4 py-3 text-left">Destinatario</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Total contado</th>
              <th className="px-4 py-3 text-left">Validez</th>
              <th className="px-4 py-3 text-right">v</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {proposals.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No hay propuestas. Crea una desde la ficha de un cliente o desde aquí.
                </td>
              </tr>
            ) : (
              proposals.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{p.reference_code ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/propuestas/${p.id}` as never}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.customer_or_lead_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(p.total_cash_cents)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {p.validity_until ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    v{p.version_number}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/propuestas/${p.id}` as never}
                      className="text-sm text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
