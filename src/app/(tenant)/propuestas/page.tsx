import Link from "next/link";
import { Eye, Download, Plus, Package } from "lucide-react";
import { listProposals } from "@/modules/proposals/actions";
import { Button } from "@/shared/ui/button";
import { StatusPill } from "@/shared/components/status-pill";
import { STATUS_LABEL, PROPOSAL_STATUS } from "@/modules/proposals/schemas";

const PROP_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "rejected",
  expired: "neutral",
  superseded: "neutral",
};

const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  rental: "Alquiler",
  renting: "Renting",
  financing: "Financiación",
};

const PLAN_BG: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rental: "bg-blue-100 text-blue-800 border-blue-200",
  renting: "bg-violet-100 text-violet-800 border-violet-200",
  financing: "bg-amber-100 text-amber-800 border-amber-200",
};

export const dynamic = "force-dynamic";

function formatCents(cents: number | null | undefined) {
  if (cents == null) return null;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

export default async function PropuestasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = PROPOSAL_STATUS.includes(sp.status as never) ? sp.status : undefined;
  const proposals = await listProposals({ status });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Propuestas</h1>
          <p className="text-sm text-muted-foreground">{proposals.length} propuestas</p>
        </div>
        <Button asChild>
          <Link href={"/propuestas/nueva" as never}>
            <Plus className="h-4 w-4" /> Nueva propuesta
          </Link>
        </Button>
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
            {PROPOSAL_STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {status && (
          <Link href="/propuestas" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      {proposals.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No hay propuestas. Crea una desde la ficha de un cliente o desde aquí.
        </div>
      ) : (
        <>
          {/* MÓVIL: cards */}
          <div className="space-y-3 lg:hidden">
            {proposals.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </div>

          {/* DESKTOP: tabla rica */}
          <div className="hidden lg:block overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Ref.</th>
                  <th className="px-4 py-3 text-left">Destinatario</th>
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-left">Plan</th>
                  <th className="px-4 py-3 text-right">Importe</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Validez</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {proposals.map((p) => {
                  const planType = p.chosen_plan_type ?? "cash";
                  const monthly = p.monthly_cents;
                  const main =
                    planType === "cash"
                      ? formatCents(p.total_cash_cents)
                      : monthly
                        ? `${formatCents(monthly)} /mes`
                        : formatCents(p.total_cash_cents);
                  return (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                        {p.reference_code ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/propuestas/${p.id}` as never}
                          className="font-medium text-primary hover:underline"
                        >
                          {p.customer_or_lead_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        {p.product_summary ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate" title={p.product_summary}>
                              {p.product_summary}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PLAN_BG[planType]}`}
                          >
                            {PLAN_LABEL[planType] ?? planType}
                          </span>
                          {p.duration_months && planType !== "cash" && (
                            <span className="text-[11px] text-muted-foreground">
                              {p.duration_months} cuotas
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold tabular-nums whitespace-nowrap">
                          {main ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          label={STATUS_LABEL[p.status]}
                          tone={PROP_TONE[p.status] ?? "info"}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {p.validity_until ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/propuestas/${p.id}` as never}
                            title="Ver propuesta"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-foreground"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <a
                            href={`/api/pdf/proposal/${p.id}`}
                            target="_blank"
                            rel="noopener"
                            title="Descargar PDF"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-foreground"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ProposalCard({
  p,
}: {
  p: Awaited<ReturnType<typeof listProposals>>[number];
}) {
  const planType = p.chosen_plan_type ?? "cash";
  const monthly = p.monthly_cents;
  const main =
    planType === "cash"
      ? formatCents(p.total_cash_cents)
      : monthly
        ? `${formatCents(monthly)} /mes`
        : formatCents(p.total_cash_cents);
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/propuestas/${p.id}` as never}
            className="font-semibold hover:underline block truncate"
          >
            {p.customer_or_lead_name}
          </Link>
          <div className="text-xs font-mono text-muted-foreground">
            {p.reference_code ?? "—"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold tabular-nums">{main ?? "—"}</div>
          <StatusPill
            label={STATUS_LABEL[p.status]}
            tone={PROP_TONE[p.status] ?? "info"}
          />
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PLAN_BG[planType]}`}
        >
          {PLAN_LABEL[planType] ?? planType}
          {p.duration_months && planType !== "cash" && ` · ${p.duration_months}m`}
        </span>
        {p.product_summary && (
          <span
            className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[60%]"
            title={p.product_summary}
          >
            <Package className="h-3 w-3 shrink-0" />
            <span className="truncate">{p.product_summary}</span>
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
        <Link
          href={`/propuestas/${p.id}` as never}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
        >
          <Eye className="h-3.5 w-3.5" /> Ver
        </Link>
        <a
          href={`/api/pdf/proposal/${p.id}`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" /> PDF
        </a>
      </div>
    </div>
  );
}
