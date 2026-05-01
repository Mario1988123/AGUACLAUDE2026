import Link from "next/link";
import { listContracts } from "@/modules/contracts/actions";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT, PLAN_TYPE_LABEL } from "@/modules/contracts/schemas";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ContratosPage() {
  const contracts = await listContracts();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contratos</h1>
          <p className="text-sm text-muted-foreground">{contracts.length} contratos</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Ref.</th>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Cuota</th>
              <th className="px-4 py-3 text-left">Firmado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No hay contratos. Genera uno desde una propuesta aceptada.
                </td>
              </tr>
            ) : (
              contracts.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{c.reference_code ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/contratos/${c.id}` as never}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.customer_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">{PLAN_TYPE_LABEL[c.plan_type]}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(c.total_cash_cents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(c.monthly_cents)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.signed_at ? new Date(c.signed_at).toLocaleDateString("es-ES") : "—"}
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
