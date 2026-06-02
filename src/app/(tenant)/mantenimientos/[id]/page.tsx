import Link from "next/link";
import { notFound } from "next/navigation";
import { getMaintenance } from "@/modules/maintenance/actions";
import { computeMaintenanceJobAlerts } from "@/modules/maintenance/alerts";
import { MaintenanceAlertsModal } from "@/modules/maintenance/alerts-modal";
import { listProducts } from "@/modules/products/actions";
import { STATUS_LABEL, STATUS_VARIANT, KIND_LABEL } from "@/modules/maintenance/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Timeline } from "@/modules/events/timeline";
import { MaintenanceCompleteForm } from "@/modules/maintenance/complete-form";
import { StartMaintenanceButton } from "@/modules/maintenance/start-button";
import { ReassignMaintenanceButton } from "@/modules/maintenance/reassign-button";
import { listInstallers } from "@/modules/agenda/actions";
import { listMaintenancePlans } from "@/modules/maintenance-plans/actions";
import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let job;
  try {
    job = await getMaintenance(id);
  } catch {
    notFound();
  }

  // Customer name lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: c } = await supabase
    .from("customers")
    .select("party_kind, legal_name, trade_name, first_name, last_name")
    .eq("id", job.customer_id)
    .single();
  const cu = (c ?? {}) as {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
  const customerName =
    cu.party_kind === "company"
      ? cu.trade_name || cu.legal_name || "—"
      : `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() || "—";

  const products = await listProducts().catch(() => []);
  const session = await requireSession();
  const canReassign =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  const technicians = canReassign
    ? await listInstallers().catch(() => [])
    : [];

  // Planes de mantenimiento disponibles — usados por complete-form
  // para ofrecer renovación al cliente tras la última visita del contrato.
  const maintenancePlans = await listMaintenancePlans().catch(() => []);

  // Avisos operativos del mantenimiento — patrón badge+modal idéntico al
  // de clientes / instalaciones. Se calculan a partir de columnas del job
  // (retraso, sin técnico, en curso >4h, propuesta sin confirmar, etc.).
  const jobAlerts = computeMaintenanceJobAlerts({
    status: job.status,
    scheduled_at: job.scheduled_at,
    started_at: job.started_at,
    technician_user_id: job.technician_user_id,
    customer_called_at: job.customer_called_at,
    confirmed_at: job.confirmed_at,
  });

  // Items reemplazados ya registrados (si completado)
  const { data: replaced } = await supabase
    .from("maintenance_items_replaced")
    .select("id, product_id, quantity")
    .eq("maintenance_job_id", id);
  const replacedList = (replaced ?? []) as Array<{
    id: string;
    product_id: string;
    quantity: number;
  }>;

  return (
    <div className="space-y-6">
      {/* Modal auto-abrir con avisos operativos al entrar a la ficha */}
      <MaintenanceAlertsModal maintenanceId={id} alerts={jobAlerts} />

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Mantenimiento</h1>
            <Badge variant={STATUS_VARIANT[job.status] ?? "default"}>
              {STATUS_LABEL[job.status] ?? job.status}
            </Badge>
            <Badge variant="outline">{KIND_LABEL[job.kind] ?? job.kind}</Badge>
            {jobAlerts.length > 0 && (
              <span
                className="inline-flex h-6 items-center rounded-full bg-red-100 px-2 text-xs font-bold text-red-800"
                title={jobAlerts.join(" · ")}
              >
                ⚠ {jobAlerts.length} aviso{jobAlerts.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cliente: <strong>{customerName}</strong>
            {job.scheduled_at &&
              ` · Programado ${new Date(job.scheduled_at).toLocaleString("es-ES")}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReassign && job.status !== "completed" && (
            <ReassignMaintenanceButton
              maintenanceId={id}
              currentUserId={job.technician_user_id}
              technicians={technicians}
            />
          )}
          <BackButton href="/mantenimientos" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {job.started_at && (
                <div>
                  <strong>Iniciado:</strong> {new Date(job.started_at).toLocaleString("es-ES")}
                </div>
              )}
              {job.completed_at && (
                <div>
                  <strong>Completado:</strong>{" "}
                  {new Date(job.completed_at).toLocaleString("es-ES")}
                </div>
              )}
              {job.duration_seconds && (
                <div>
                  <strong>Duración:</strong> {Math.round(job.duration_seconds / 60)} min
                </div>
              )}
              <div>
                <strong>Cargo:</strong>{" "}
                {job.is_charged
                  ? new Intl.NumberFormat("es-ES", {
                      style: "currency",
                      currency: "EUR",
                    }).format((job.charge_cents ?? 0) / 100)
                  : "Incluido en contrato"}
              </div>
              {job.notes && (
                <div>
                  <strong>Notas:</strong> {job.notes}
                </div>
              )}
            </CardContent>
          </Card>

          {replacedList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recambios utilizados</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {replacedList.map((r) => {
                    const p = products.find((pp) => pp.id === r.product_id);
                    return (
                      <li key={r.id} className="flex justify-between border-b py-2">
                        <span>{p?.name ?? r.product_id.slice(0, 8)}</span>
                        <Badge variant="secondary">x{r.quantity}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            {job.status === "scheduled" && <StartMaintenanceButton id={job.id} />}
            {job.status === "in_progress" && (
              <MaintenanceCompleteForm
                maintenanceId={job.id}
                products={products.map((p) => ({ id: p.id, name: p.name }))}
                maintenancePlans={maintenancePlans.map((p) => ({
                  id: p.id,
                  name: p.name,
                  tier: p.tier,
                  monthly_cents: p.monthly_cents,
                }))}
              />
            )}
            {job.status === "completed" && (
              <p className="text-sm text-success">✓ Mantenimiento completado</p>
            )}
            {job.status === "cancelled" && (
              <p className="text-sm text-destructive">Mantenimiento cancelado</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="maintenance" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
