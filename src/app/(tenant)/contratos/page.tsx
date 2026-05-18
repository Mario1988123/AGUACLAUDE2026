import Link from "next/link";
import { Eye, Download, Home, AlertCircle } from "lucide-react";
import { listContracts } from "@/modules/contracts/actions";
import { StatusPill } from "@/shared/components/status-pill";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, PLAN_TYPE_LABEL, CONTRACT_STATUS } from "@/modules/contracts/schemas";
import { Pagination } from "@/shared/components/pagination";
import { requireSession } from "@/shared/lib/auth/session";
import {
  ContractSmartAlerts,
  getContractAlerts,
} from "@/modules/contracts/smart-alerts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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

/**
 * Renting firmado/activo sin financiera asignada → requiere atención del
 * admin. Los alquileres NO usan financiera (cobramos al cliente directo).
 */
function needsFinancier(c: {
  plan_type: string;
  status: string;
  financier_id: string | null;
}): boolean {
  return (
    c.plan_type === "renting" &&
    (c.status === "signed" || c.status === "active") &&
    !c.financier_id
  );
}

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    plan?: string;
    page?: string;
    missing_financier?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  const status = CONTRACT_STATUS.includes(sp.status as never) ? sp.status : undefined;
  const planType = sp.plan === "cash" || sp.plan === "renting" || sp.plan === "rental" ? sp.plan : undefined;
  const missingFinancier = sp.missing_financier === "1";
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;
  const [contractsAll, alerts] = await Promise.all([
    listContracts({
      status,
      plan_type: planType,
      missing_financier: missingFinancier,
      limit: PAGE_SIZE + 1,
      offset,
    }),
    isUpper ? getContractAlerts().catch(() => null) : Promise.resolve(null),
  ]);
  const hasMore = contractsAll.length > PAGE_SIZE;
  const contracts = contractsAll.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Contratos</h1>
          <p className="text-sm text-muted-foreground">
            {contracts.length} contratos
            {missingFinancier && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                <AlertCircle className="h-3 w-3" /> filtro: renting sin
                financiera ·{" "}
                <Link href="/contratos" className="underline">
                  quitar
                </Link>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/contratos/alquileres" as never}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <Home className="h-4 w-4" /> Cartera alquileres
          </Link>
          <Link
            href={"/api/export/contracts" as never}
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ Exportar CSV
          </Link>
        </div>
      </div>

      {isUpper && alerts && <ContractSmartAlerts alerts={alerts} />}

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

      {/* Mobile: cards apiladas */}
      <ul className="space-y-2 md:hidden">
        {contracts.length === 0 ? (
          <li className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No hay contratos con esos filtros.
          </li>
        ) : (
          contracts.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border bg-card p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {c.reference_code ?? "—"}
                  </div>
                  <Link
                    href={`/contratos/${c.id}` as never}
                    className="font-medium text-primary hover:underline truncate block"
                  >
                    {c.customer_name}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {PLAN_TYPE_LABEL[c.plan_type]}
                    {c.signed_at && ` · Firmado ${new Date(c.signed_at).toLocaleDateString("es-ES")}`}
                  </div>
                  {needsFinancier(c) && (
                    <Badge variant="warning" className="mt-1 gap-1 text-[10px]">
                      <AlertCircle className="h-3 w-3" /> Sin financiera
                    </Badge>
                  )}
                </div>
                <StatusPill
                  label={STATUS_LABEL[c.status]}
                  tone={CONTRACT_TONE[c.status] ?? "info"}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                <div className="text-xs tabular-nums">
                  {c.total_cash_cents != null && (
                    <span className="font-bold">{formatCents(c.total_cash_cents)}</span>
                  )}
                  {c.monthly_cents != null && (
                    <span className="text-muted-foreground">
                      {c.total_cash_cents != null ? " · " : ""}
                      {formatCents(c.monthly_cents)}/mes
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  <Link
                    href={`/contratos/${c.id}` as never}
                    title="Ver contrato"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                  <a
                    href={`/api/pdf/contract/${c.id}`}
                    target="_blank"
                    rel="noopener"
                    title="Descargar PDF"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      {/* Desktop: tabla densa */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Ref.</th>
              <th className="px-4 py-3 text-left">Cliente</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Cuota</th>
              <th className="px-4 py-3 text-left">Firmado</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
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
                  <td className="px-4 py-3 text-xs">
                    {PLAN_TYPE_LABEL[c.plan_type]}
                    {needsFinancier(c) && (
                      <Badge
                        variant="warning"
                        className="ml-2 gap-1 text-[10px]"
                        title="Renting firmado sin financiera asignada"
                      >
                        <AlertCircle className="h-3 w-3" /> Sin financiera
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(c.total_cash_cents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(c.monthly_cents)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.signed_at ? new Date(c.signed_at).toLocaleDateString("es-ES") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/contratos/${c.id}` as never}
                        title="Ver contrato"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <a
                        href={`/api/pdf/contract/${c.id}`}
                        target="_blank"
                        rel="noopener"
                        title="Descargar PDF"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath="/contratos"
        page={page}
        pageSize={PAGE_SIZE}
        hasMore={hasMore}
        preserveParams={{ status, plan: planType }}
      />
    </div>
  );
}
