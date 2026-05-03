import Link from "next/link";
import { listContracts } from "@/modules/contracts/actions";
import { StatusPill } from "@/shared/components/status-pill";
import { STATUS_LABEL, PLAN_TYPE_LABEL, CONTRACT_STATUS } from "@/modules/contracts/schemas";

export const dynamic = "force-dynamic";

const CONTRACT_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  draft: "neutral",
  pending_data: "onhold",
  pending_signature: "onhold",
  signed: "processing",
  active: "success",
  cancelled: "rejected",
  completed: "info",
};

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; plan?: string }>;
}) {
  const sp = await searchParams;
  const status = CONTRACT_STATUS.includes(sp.status as never) ? sp.status : undefined;
  const planType = sp.plan === "cash" || sp.plan === "renting" || sp.plan === "rental" ? sp.plan : undefined;
  const contracts = await listContracts({ status, plan_type: planType });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Contratos</h1>
          <p className="text-sm text-muted-foreground">{contracts.length} contratos</p>
        </div>
        <Link
          href={"/api/export/contracts" as never}
          prefetch={false}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          ⬇ Exportar CSV
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Estado</label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {CONTRACT_STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Tipo</label>
          <select
            name="plan"
            defaultValue={planType ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="cash">Contado</option>
            <option value="renting">Renting</option>
            <option value="rental">Alquiler</option>
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(status || planType) && (
          <Link href="/contratos" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

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
                  No hay contratos con esos filtros.
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
                    <StatusPill
                      label={STATUS_LABEL[c.status]}
                      tone={CONTRACT_TONE[c.status] ?? "info"}
                    />
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
