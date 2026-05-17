import Link from "next/link";
import { Plus, Eye, Download, Mail, FileSignature, Trash2, TrendingDown } from "lucide-react";
import { listSavingsProposals } from "@/modules/savings/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { BackButton } from "@/shared/components/back-button";
import { formatDateES } from "@/shared/lib/format-date";
import { SavingsRowDelete } from "@/modules/savings/row-delete";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  converted: "Convertida",
  archived: "Archivada",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning"> = {
  draft: "secondary",
  sent: "default",
  converted: "success",
  archived: "secondary",
};

const SERVICE_LABEL: Record<string, string> = {
  bottled: "Botellas",
  service: "Servicio garrafas",
  osmosis: "Ósmosis ya tiene",
  tap: "Grifo",
  none: "Sin servicio",
};

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

export default async function CalculadoraAhorroListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const list = await listSavingsProposals({ status: sp.status });

  const totalSavings5y = list
    .filter((s) => s.status !== "archived")
    .reduce((acc, s) => acc + (s.total_saved_5y_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Calculadora de ahorro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {list.length} propuestas guardadas. Ahorro total estimado:{" "}
            <strong className="text-emerald-700">{eur(totalSavings5y)}</strong> a 5 años.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BackButton href="/dashboard" />
          <Button asChild variant="success">
            <Link href={"/calculadora-ahorro/nueva" as never}>
              <Plus className="h-4 w-4" /> Nueva calculadora
            </Link>
          </Button>
        </div>
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
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {sp.status && (
          <Link href="/calculadora-ahorro" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Propuestas guardadas</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No hay propuestas todavía.{" "}
              <Link href="/calculadora-ahorro/nueva" className="text-primary underline">
                Crea la primera
              </Link>
              .
            </div>
          ) : (
            <>
            {/* Mobile: cards apiladas */}
            <ul className="space-y-2 md:hidden">
              {list.map((s) => {
                const positiveSavings =
                  (s.total_saved_5y_cents ?? 0) > 0 && s.payback_months != null;
                return (
                  <li key={s.id} className="rounded-xl border bg-card p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {s.reference_code ?? "—"}
                        </div>
                        {s.customer_id ? (
                          <Link
                            href={`/clientes/${s.customer_id}` as never}
                            className="font-medium text-primary hover:underline truncate block"
                          >
                            {s.customer_name ?? "Cliente"}
                          </Link>
                        ) : s.lead_id ? (
                          <Link
                            href={`/leads/${s.lead_id}` as never}
                            className="font-medium text-primary hover:underline truncate block"
                          >
                            <Badge variant="secondary" className="mr-1 text-[10px]">LEAD</Badge>
                            {s.lead_name ?? "Lead"}
                          </Link>
                        ) : (
                          <span className="text-xs text-amber-700">⚠ sin asignar</span>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {s.product_name_snapshot ?? "—"}
                          {s.plan_type && ` · ${s.plan_type}`}
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANT[s.status] ?? "default"}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-2 text-[11px] tabular-nums">
                      <div>
                        <div className="text-muted-foreground">Actual</div>
                        <div>{eur(s.current_monthly_cost_cents)}/m</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Nuevo</div>
                        <div>{eur(s.total_monthly_cost_cents)}/m</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Ahorro 5y</div>
                        {positiveSavings ? (
                          <div className="font-bold text-emerald-700 inline-flex items-center gap-0.5">
                            <TrendingDown className="h-3 w-3" />
                            {eur(s.total_saved_5y_cents)}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">—</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateES(s.created_at)}
                      </span>
                      <div className="flex items-center gap-1">
                        <a
                          href={`/api/pdf/savings/${s.id}`}
                          target="_blank"
                          rel="noopener"
                          title="Ver PDF"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                        <a
                          href={`/api/pdf/savings/${s.id}`}
                          download={`ahorro-${s.reference_code ?? s.id.slice(0, 8)}.pdf`}
                          title="Descargar PDF"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left">Ref</th>
                    <th className="py-2 text-left">Cliente</th>
                    <th className="py-2 text-left">Lead</th>
                    <th className="py-2 text-left">Producto</th>
                    <th className="py-2 text-left">Consumo actual</th>
                    <th className="py-2 text-right">Coste actual</th>
                    <th className="py-2 text-right">Coste nuevo</th>
                    <th className="py-2 text-right">Ahorro 5y</th>
                    <th className="py-2 text-left">Estado</th>
                    <th className="py-2 text-left">Fecha</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((s) => {
                    const positiveSavings =
                      (s.total_saved_5y_cents ?? 0) > 0 && s.payback_months != null;
                    return (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="py-2 font-mono text-xs">{s.reference_code ?? "—"}</td>
                        <td className="py-2">
                          {s.customer_id ? (
                            <Link
                              href={`/clientes/${s.customer_id}` as never}
                              className="font-medium text-primary hover:underline"
                            >
                              {s.customer_name ?? "Cliente"}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2">
                          {s.lead_id ? (
                            <Link
                              href={`/leads/${s.lead_id}` as never}
                              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                            >
                              <Badge variant="secondary" className="text-[10px]">
                                LEAD
                              </Badge>
                              {s.lead_name ?? "Lead"}
                            </Link>
                          ) : s.customer_id ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="text-xs text-amber-700">⚠ sin asignar</span>
                          )}
                        </td>
                        <td className="py-2 text-xs">
                          {s.product_name_snapshot ?? "—"}
                          {s.plan_type && (
                            <span className="ml-1 text-muted-foreground">· {s.plan_type}</span>
                          )}
                        </td>
                        <td className="py-2 text-xs">
                          {SERVICE_LABEL[s.current_service] ?? s.current_service}
                          <span className="text-muted-foreground"> · {s.num_people}p</span>
                        </td>
                        <td className="py-2 text-right tabular-nums whitespace-nowrap">
                          {eur(s.current_monthly_cost_cents)}/m
                        </td>
                        <td className="py-2 text-right tabular-nums whitespace-nowrap">
                          {eur(s.total_monthly_cost_cents)}/m
                        </td>
                        <td className="py-2 text-right tabular-nums whitespace-nowrap">
                          {positiveSavings ? (
                            <span className="font-bold text-emerald-700 inline-flex items-center gap-1">
                              <TrendingDown className="h-3.5 w-3.5" />
                              {eur(s.total_saved_5y_cents)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2">
                          <Badge variant={STATUS_VARIANT[s.status] ?? "default"}>
                            {STATUS_LABEL[s.status] ?? s.status}
                          </Badge>
                          {s.converted_to_proposal_id && (
                            <Link
                              href={`/propuestas/${s.converted_to_proposal_id}` as never}
                              className="ml-1 text-[10px] text-primary hover:underline"
                            >
                              ver
                            </Link>
                          )}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateES(s.created_at)}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <a
                              href={`/api/pdf/savings/${s.id}`}
                              target="_blank"
                              rel="noopener"
                              title="Ver PDF"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              <Eye className="h-4 w-4" />
                            </a>
                            <a
                              href={`/api/pdf/savings/${s.id}`}
                              download={`ahorro-${s.reference_code ?? s.id.slice(0, 8)}.pdf`}
                              title="Descargar PDF"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                            <SavingsRowDelete id={s.id} reference={s.reference_code} />
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
        </CardContent>
      </Card>

      {/* Iconos extra solo para tipos no usados — keep imports clean */}
      <div className="hidden">
        <Mail />
        <FileSignature />
        <Trash2 />
      </div>
    </div>
  );
}
