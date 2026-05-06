import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getContract,
  getContractItems,
  getContractPayments,
} from "@/modules/contracts/actions";
import { listContractSignatures } from "@/modules/contracts/signatures-actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { listWarehouses } from "@/modules/warehouses/actions";
import { getFiscalSettings } from "@/modules/config/fiscal/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT, PLAN_TYPE_LABEL } from "@/modules/contracts/schemas";
import { ContractStatusActions } from "@/modules/contracts/status-actions";
import { CreateInstallationButton } from "@/modules/contracts/create-installation-button";
import { QuickCollectButton } from "@/modules/contracts/quick-collect-button";
import { InvoiceFromContractButton } from "@/modules/invoices/invoice-from-contract-button";
import { ContractClausesEditor } from "@/modules/contracts/clauses-editor";
import { ContractNotesEditor } from "@/modules/contracts/notes-editor";
import { ReassignContractButton } from "@/modules/contracts/reassign-button";
import { Timeline } from "@/modules/events/timeline";
import { ContractPhotosCard } from "@/modules/contracts/photo-uploader";
import { SignaturesCard } from "@/modules/contracts/signature-pad";
import { InstallPreference } from "@/modules/contracts/install-preference";
import { ViewA4Button } from "@/modules/contracts/view-a4-button";
import { ContractPreviewButton } from "@/modules/contracts/preview-modal-button";
import { ContractCompleteWizard } from "@/modules/contracts/complete-wizard";
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
  const [items, payments, team, warehouses, session, signatures, fiscal] = await Promise.all([
    getContractItems(id),
    getContractPayments(id),
    listTeamMembers(),
    listWarehouses().catch(() => []),
    requireSession(),
    listContractSignatures(id),
    getFiscalSettings().catch(() => null),
  ]);
  const installers = team;
  const canEditClauses =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = contract as any;
  const clauses = (c.clauses_snapshot ?? []) as Array<{
    title: string;
    body: string;
    display_order: number;
  }>;
  const customerSnap = (c.customer_snapshot ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tax_id?: string | null;
  };
  const customerName =
    customerSnap.trade_name ||
    customerSnap.legal_name ||
    `${customerSnap.first_name ?? ""} ${customerSnap.last_name ?? ""}`.trim() ||
    "Cliente";

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

  // ¿hay algún pago por transferencia? Si sí, mostramos el IBAN de la
  // empresa para que el cliente pueda hacer el ingreso.
  const hasTransferPayment = payments.some((p) => p.method === "transfer");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
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
        <div className="flex items-center gap-3 flex-wrap">
          {!["signed", "active", "completed", "cancelled"].includes(contract.status) && (
          <ContractCompleteWizard
            contractId={contract.id}
            payments={payments.map((p) => ({
              id: p.id,
              concept: p.concept,
              amount_cents: p.amount_cents,
              method: p.method,
              moment: p.moment,
              status: p.status,
            }))}
            signatures={signatures}
            initialPreference={{
              slot: c.preferred_install_time_slot ?? null,
              notes: c.preferred_install_time_notes ?? null,
              days_of_week: c.preferred_install_days_of_week ?? null,
              dates: c.preferred_install_dates ?? null,
            }}
            defaultRepresentativeName={session.full_name ?? session.email ?? "Representante"}
            defaultCustomerName={customerName}
            defaultCustomerTaxId={customerSnap.tax_id ?? null}
            canEdit={canEditClauses || ["draft", "pending_data", "pending_signature"].includes(contract.status)}
            preview={{
              contractRef: contract.reference_code ?? "(sin código)",
              customerName,
              customerTaxId: customerSnap.tax_id ?? null,
              planLabel: PLAN_TYPE_LABEL[contract.plan_type] ?? contract.plan_type,
              durationMonths: contract.duration_months,
              totalCash: contract.total_cash_cents,
              monthly: contract.monthly_cents,
              items: items.map((it) => ({
                product_name_snapshot: it.product_name_snapshot,
                quantity: it.quantity,
                unit_price_cents: it.unit_price_cents,
              })),
              payments: payments.map((p) => ({
                id: p.id,
                concept: p.concept,
                amount_cents: p.amount_cents,
                method: p.method,
                moment: p.moment,
                status: p.status,
              })),
              clauses,
              signatures,
              companyIban: fiscal?.fiscal_iban ?? null,
              companyName: fiscal?.fiscal_legal_name ?? null,
              preferredSlotLabel: null,
            }}
          />
          )}
          <ContractPreviewButton
            contractRef={contract.reference_code ?? "(sin código)"}
            customerName={customerName}
            customerTaxId={customerSnap.tax_id ?? null}
            planLabel={PLAN_TYPE_LABEL[contract.plan_type] ?? contract.plan_type}
            durationMonths={contract.duration_months}
            totalCash={contract.total_cash_cents}
            monthly={contract.monthly_cents}
            items={items.map((it) => ({
              product_name_snapshot: it.product_name_snapshot,
              quantity: it.quantity,
              unit_price_cents: it.unit_price_cents,
            }))}
            payments={payments.map((p) => ({
              concept: p.concept,
              amount_cents: p.amount_cents,
              method: p.method,
              moment: p.moment,
            }))}
            clauses={clauses}
            signatures={signatures.map((s) => ({
              signer_role: s.signer_role,
              signer_name: s.signer_name,
              signer_tax_id: s.signer_tax_id,
              signature_data_url: s.signature_data_url,
            }))}
            companyIban={fiscal?.fiscal_iban ?? null}
            companyName={fiscal?.fiscal_legal_name ?? null}
            preferredSlotLabel={(() => {
              const parts: string[] = [];
              const slot = c.preferred_install_time_slot as string | null;
              if (slot === "morning") parts.push("Mañana (9–14h)");
              else if (slot === "afternoon") parts.push("Tarde (16–20h)");
              else if (slot === "any") parts.push("Cualquier hora");
              else if (slot === "custom" && c.preferred_install_time_notes) parts.push(c.preferred_install_time_notes);
              const dows = c.preferred_install_days_of_week as number[] | null;
              if (dows && dows.length > 0) {
                const map = ["", "L", "M", "X", "J", "V", "S", "D"];
                parts.push(`Días: ${dows.map((d) => map[d]).join(", ")}`);
              }
              const dates = c.preferred_install_dates as string[] | null;
              if (dates && dates.length > 0) {
                parts.push(
                  `Fechas: ${dates
                    .map((d) =>
                      new Date(d).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      }),
                    )
                    .join(", ")}`,
                );
              }
              return parts.length > 0 ? parts.join(" · ") : null;
            })()}
          />
          <ViewA4Button contractId={contract.id} />
          {contract.status === "signed" && <InvoiceFromContractButton contractId={contract.id} />}
          <a
            href={`/api/pdf/contract/${contract.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📄 PDF
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
            {/* Reasignar comercial: SOLO superadmin / company_admin. Antes
                lo veían también directores comerciales/técnicos via
                canEditClauses. El user pidió restringir a admin. */}
            {(session.is_superadmin || session.roles.includes("company_admin")) && (
              <div className="border-t pt-4">
                <ReassignContractButton
                  contractId={contract.id}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  currentUserId={(contract as any).assigned_user_id ?? null}
                  team={team}
                />
              </div>
            )}
            {/* "Generar instalación" solo lo ven niveles 1-2 con scope
                técnico/admin. Comerciales NO — la instalación se crea
                automáticamente al firmar y la programación es del director
                técnico/admin. */}
            {isSignedOrActive &&
              (session.is_superadmin ||
                session.roles.includes("company_admin") ||
                session.roles.includes("technical_director")) && (
                <div className="border-t pt-4">
                  <CreateInstallationButton
                    contractId={contract.id}
                    installers={installers}
                    warehouses={warehouses.map((w) => ({
                      id: w.id,
                      name: w.name,
                      kind: w.kind,
                      assigned_user_id: w.assigned_user_id,
                    }))}
                    hasInstallation={hasInstallation}
                    preferredSlot={c.preferred_install_time_slot ?? null}
                    preferredNotes={c.preferred_install_time_notes ?? null}
                    preferredDaysOfWeek={c.preferred_install_days_of_week ?? null}
                    preferredDates={c.preferred_install_dates ?? null}
                  />
                </div>
              )}
            {/* Comercial: solo ve mensaje informativo */}
            {isSignedOrActive &&
              !session.is_superadmin &&
              !session.roles.includes("company_admin") &&
              !session.roles.includes("technical_director") && (
                <div className="border-t pt-4">
                  <p className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    ✓ Contrato firmado. La instalación se ha generado
                    automáticamente y el director técnico la programará.
                    Recibirás una notificación cuando se complete.
                  </p>
                </div>
              )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pagos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos definidos.</p>
          ) : (
            <>
            <table className="w-full border-separate border-spacing-x-3 border-spacing-y-1 text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Concepto</th>
                  <th className="px-2 py-2 text-right">Importe</th>
                  <th className="px-2 py-2 text-left">Método</th>
                  <th className="px-2 py-2 text-left">Momento</th>
                  <th className="px-2 py-2 text-left">Estado</th>
                  <th className="px-2 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-border">
                    <td className="px-2 py-2">{p.concept}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCents(p.amount_cents)}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {PAYMENT_MOMENT_LABEL[p.moment] ?? p.moment}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={p.status === "validated" ? "success" : "secondary"}>
                        {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <QuickCollectButton
                        paymentId={p.id}
                        status={p.status}
                        defaultMethod={p.method}
                        amountLabel={formatCents(p.amount_cents) ?? undefined}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              💡 Cada línea (equipo, instalación, fianza, cuota…) se cobra de forma
              independiente: puedes elegir momento (ahora / instalación) y método de
              pago distinto para cada una.
            </p>
            </>
          )}
          {hasTransferPayment && fiscal?.fiscal_iban && (
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="font-bold text-blue-900">💳 Pagos por transferencia:</span>
                <div className="flex-1">
                  <code className="rounded bg-white px-2 py-1 font-mono text-xs">
                    {fiscal.fiscal_iban}
                  </code>
                  {fiscal.fiscal_legal_name && (
                    <span className="ml-2 text-xs text-blue-800">
                      Titular: {fiscal.fiscal_legal_name}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-blue-800">
                Este IBAN aparecerá en el PDF del contrato para que el cliente haga el ingreso.
              </p>
            </div>
          )}
          {hasTransferPayment && !fiscal?.fiscal_iban && (
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              ⚠️ Hay pagos por transferencia pero la empresa no tiene IBAN configurado.{" "}
              <Link href="/configuracion/fiscal" className="font-bold underline">
                Configúralo aquí
              </Link>{" "}
              para que aparezca en el contrato.
            </div>
          )}
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

      <Card>
        <CardHeader>
          <CardTitle>Firmas</CardTitle>
        </CardHeader>
        <CardContent>
          <SignaturesCard
            contractId={id}
            signatures={signatures}
            defaultRepresentativeName={
              session.full_name ?? session.email ?? "Representante"
            }
            defaultCustomerName={customerName}
            defaultCustomerTaxId={customerSnap.tax_id ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferencia horaria de instalación</CardTitle>
        </CardHeader>
        <CardContent>
          <InstallPreference
            contractId={id}
            initialSlot={c.preferred_install_time_slot ?? null}
            initialNotes={c.preferred_install_time_notes ?? null}
            initialDaysOfWeek={c.preferred_install_days_of_week ?? null}
            initialDates={c.preferred_install_dates ?? null}
            canEdit={canEditClauses || ["draft", "pending_data", "pending_signature"].includes(contract.status)}
          />
        </CardContent>
      </Card>

      <ContractPhotosCard contractId={id} />

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
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="contract" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
