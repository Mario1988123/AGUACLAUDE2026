import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { listExpenses, getExpenseSummary } from "@/modules/expenses/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { KpiCard } from "@/shared/components/kpi-card";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  submitted: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  reimbursed: "Liquidado",
  reconciled: "Validado",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  submitted: "warning",
  approved: "default",
  rejected: "destructive",
  reimbursed: "success",
  reconciled: "success",
};

const PAYMENT_LABEL: Record<string, string> = {
  corp_card: "Tarjeta empresa",
  personal: "Personal",
  cash: "Efectivo empresa",
};

function eur(c: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const isApprover =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");

  const [expenses, summary] = await Promise.all([
    listExpenses({ status: sp.status, fromDate: sp.from, toDate: sp.to }),
    getExpenseSummary(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Gastos comerciales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tickets, dietas y kilometraje. Sube la foto y rellenamos los datos.
          </p>
        </div>
        <Link
          href="/gastos/nuevo"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nuevo gasto
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pendientes"
          value={`${summary.pending_count} · ${eur(summary.pending_amount_cents)}`}
          icon="Clock"
          iconColor="warning"
        />
        <KpiCard
          label="Aprobados pdte. liquidar"
          value={eur(summary.approved_pending_reimbursement_cents)}
          icon="HandCoins"
          iconColor="primary"
        />
        <KpiCard
          label="Liquidado este mes"
          value={eur(summary.reimbursed_this_month_cents)}
          icon="CheckCircle2"
          iconColor="success"
        />
        <KpiCard
          label={isApprover ? "Tu rol: aprobador" : "Tu rol: comercial"}
          value={isApprover ? "Aprueba y liquida" : "Tus gastos serán revisados"}
          icon="Receipt"
          iconColor="primary"
        />
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Estado</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Desde</label>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Hasta</label>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(sp.status || sp.from || sp.to) && (
          <Link href="/gastos" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos ({expenses.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Receipt className="h-4 w-4" /> No hay gastos.{" "}
              <Link href="/gastos/nuevo" className="text-primary underline">
                Crea el primero
              </Link>
              .
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left">Fecha</th>
                    <th className="py-2 text-left">Comercio</th>
                    <th className="py-2 text-left">Categoría</th>
                    <th className="py-2 text-left">Cliente</th>
                    <th className="py-2 text-left">Pago</th>
                    <th className="py-2 text-right">Importe</th>
                    <th className="py-2 text-left">Estado</th>
                    <th className="py-2 text-left">Comercial</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="py-2 text-xs text-muted-foreground">
                        {e.issue_date
                          ? new Date(e.issue_date).toLocaleDateString("es-ES")
                          : "—"}
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/gastos/${e.id}` as never}
                          className="font-medium hover:underline"
                        >
                          {e.merchant_name ?? "(sin comercio)"}
                        </Link>
                      </td>
                      <td className="py-2 text-xs">{e.category_name ?? "—"}</td>
                      <td className="py-2 text-xs">{e.customer_name ?? "—"}</td>
                      <td className="py-2 text-xs">
                        {PAYMENT_LABEL[e.payment_method] ?? e.payment_method}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {eur(e.total_cents)}
                      </td>
                      <td className="py-2">
                        <Badge variant={STATUS_VARIANT[e.status]}>
                          {STATUS_LABEL[e.status] ?? e.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{e.user_name ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
