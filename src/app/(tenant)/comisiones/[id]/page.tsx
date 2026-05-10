import Link from "next/link";
import { notFound } from "next/navigation";
import { getCycleDetail } from "@/modules/points/cycles-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { CycleDetailClient } from "@/modules/points/cycle-detail-client";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  pending_review: "Pendiente revisión",
  closed: "Cerrado",
};

function formatEur(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const detail = await getCycleDetail(id);
  if (!detail) notFound();

  const canManage =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");

  const cycleClosed = detail.cycle.status === "closed";
  const cyclePeriodEnded = new Date(detail.cycle.cycle_end_at).getTime() <= Date.now();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/comisiones"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Volver a comisiones
          </Link>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold">
            Ciclo {MONTH_NAMES[detail.cycle.cycle_month - 1]} {detail.cycle.cycle_year}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rango: {formatDate(detail.cycle.cycle_start_at)} →{" "}
            {formatDate(detail.cycle.cycle_end_at)} ·{" "}
            {detail.cycle.close_day === 0
              ? "Mes natural"
              : `Día ${detail.cycle.close_day}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/comisiones/${detail.cycle.id}/export?format=csv`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold hover:bg-muted"
          >
            ↓ CSV
          </a>
          <a
            href={`/api/comisiones/${detail.cycle.id}/export?format=pdf`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold hover:bg-muted"
          >
            ↓ PDF
          </a>
          <Badge
            variant={
              cycleClosed
                ? "outline"
                : detail.cycle.status === "pending_review"
                  ? "secondary"
                  : "success"
            }
          >
            {STATUS_LABEL[detail.cycle.status] ?? detail.cycle.status}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Puntos del ciclo"
          value={detail.total_points.toString()}
        />
        <KpiCard
          label="Total €"
          value={detail.euros_per_point > 0 ? formatEur(detail.total_cents) : "—"}
        />
        <KpiCard
          label="Usuarios con puntos"
          value={detail.users.length.toString()}
        />
      </div>

      {detail.cycle.status === "closed" && (
        <Card>
          <CardHeader>
            <CardTitle>Cierre</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Cerrado el{" "}
            <strong>
              {detail.cycle.closed_at
                ? new Date(detail.cycle.closed_at).toLocaleString("es-ES")
                : "—"}
            </strong>{" "}
            por <strong>{detail.cycle.closed_by_name ?? "—"}</strong>.
            <br />
            Snapshot: {detail.cycle.total_points} puntos ·{" "}
            {formatEur(detail.cycle.total_cents)}.
          </CardContent>
        </Card>
      )}

      <CycleDetailClient
        cycleId={detail.cycle.id}
        cycleStatus={detail.cycle.status}
        canManage={canManage}
        cyclePeriodEnded={cyclePeriodEnded}
        eurosPerPoint={detail.euros_per_point}
        users={detail.users}
      />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
