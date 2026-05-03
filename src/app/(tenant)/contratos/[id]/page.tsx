import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getContract,
  getContractItems,
  getContractPayments,
} from "@/modules/contracts/actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { listWarehouses } from "@/modules/warehouses/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT, PLAN_TYPE_LABEL } from "@/modules/contracts/schemas";
import { ContractStatusActions } from "@/modules/contracts/status-actions";
import { CreateInstallationButton } from "@/modules/contracts/create-installation-button";
import { QuickCollectButton } from "@/modules/contracts/quick-collect-button";
import { ContractClausesEditor } from "@/modules/contracts/clauses-editor";
import { ContractNotesEditor } from "@/modules/contracts/notes-editor";
import { ReassignContractButton } from "@/modules/contracts/reassign-button";
import { Timeline } from "@/modules/events/timeline";
import { ContractPhotosCard } from "@/modules/contracts/photo-uploader";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  collected_pending_validation: "Cobrado · pdte. validar",
  validated: "Validado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};

const PAYMENT_MOMENT_LABEL: Record<string, string> = {
  on_signature: "Firma",
  on_installation: "Instalación",
  intermediate: "Intermedio",
  periodic: "Periódico",
};

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let contract;
  try {
    contract = await getContract(id);
  } catch {
    notFound();
  }
  const [items, payments, team, warehouses, session] = await Promise.all([
    getContractItems(id),
    getContractPayments(id),
    listTeamMembers(),
    listWarehouses().catch(() => []),
    requireSession(),
  ]);
  const installers = team;
  const canEditClauses =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clauses = ((contract as any).clauses_snapshot ?? []) as Array<{
    title: string;
    body: string;
    display_order: number;
  }>;

  // ¿hay instalación ya creada para este contrato?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseCheck = (await createClient()) as any;
  const { count: instCount } = await supabaseCheck
    .from("installations")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", id)
    .is("deleted_at", null);
  const hasInstallation = (instCount ?? 0) > 0;
  const isSignedOrActive = ["signed", "active"].includes(contract.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              Contrato {contract.reference_code ?? "(sin código)"}
            </h1>
            <Badge variant={STATUS_VARIANT[contract.status]}>
              {STATUS_LABEL[contract.status]}
            </Badge>
            {contract.has_provisional_data && (
              <Badge variant="warning">Datos provisionales</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan: {PLAN_TYPE_LABEL[contract.plan_type]}
            {contract.duration_months ? ` · ${contract.duration_months} meses` : ""}
            {contract.signed_at && ` · firmado ${new Date(contract.signed_at).toLocaleDateString("es-ES")}`}
            {contract.service_start_date &&
              ` · servicio desde ${new Date(contract.service_start_date).toLocaleDateString("es-ES")}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/pdf/contract/${contract.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📄 Descargar PDF
          </a>
          <Link href="/contratos" className="text-sm text-primary hover:underline">
            ← Volver
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Equipos / Productos</CardTitle>
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
                        {formatCents(it.unit_price_cents)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCents(it.unit_price_cents * it.quantity)}
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
                      {formatCents(contract.total_cash_cents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ContractStatusActions
              contractId={contract.id}
              status={contract.status}
              hasProvisional={contract.has_provisional_data}
            />
            {canEditClauses && (
              <div className="border-t pt-4">
                <ReassignContractButton
                  contractId={contract.id}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  currentUserId={(contract as any).assigned_user_id ?? null}
                  team={team}
                />
              </div>
            )}
            {isSignedOrActive && (
              <div className="border-t pt-4">
                <CreateInstallationButton
                  contractId={contract.id}
                  installers={installers}
                  warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
                  hasInstallation={hasInstallation}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pagos</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos definidos.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Concepto</th>
                  <th className="py-2 text-right">Importe</th>
                  <th className="py-2 text-left">Método</th>
                  <th className="py-2 text-left">Momento</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{p.concept}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCents(p.amount_cents)}
                    </td>
                    <td className="py-2 text-xs">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</td>
                    <td className="py-2 text-xs">{PAYMENT_MOMENT_LABEL[p.moment] ?? p.moment}</td>
                    <td className="py-2">
                      <Badge variant={p.status === "validated" ? "success" : "secondary"}>
                        {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">
                      <QuickCollectButton paymentId={p.id} status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notas internas</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractNotesEditor
            contractId={id}
            initial={contract.notes}
            canEdit={canEditClauses}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cláusulas del contrato ({clauses.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractClausesEditor
            contractId={id}
            initial={clauses}
            canEdit={canEditClauses}
          />
        </CardContent>
      </Card>

      <ContractPhotosCard contractId={id} />

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="contract" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
