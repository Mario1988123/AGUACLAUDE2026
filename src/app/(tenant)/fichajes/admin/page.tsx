import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { redirect } from "next/navigation";
import {
  listPunchesAdmin,
  getUsersWithoutPunchTodayAction,
  listCompanyUsersForFilter,
} from "@/modules/time-tracking/actions";
import { AdminCreatePunchButton } from "@/modules/time-tracking/admin-create-punch-button";
import { listAbsences } from "@/modules/time-tracking/absences-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ApproveAbsenceButtons } from "@/modules/time-tracking/approve-absence-buttons";
import { ApprovePunchRequestButtons } from "@/modules/time-tracking/approve-punch-request-buttons";
import { AutoCloseButton } from "@/modules/time-tracking/auto-close-button";
import { listPendingPunchRequests } from "@/modules/time-tracking/punch-requests-actions";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  clock_in: "Entrada",
  clock_out: "Salida",
  break_start: "Inicio descanso",
  break_end: "Fin descanso",
};

const ABSENCE_KIND_LABEL: Record<string, string> = {
  vacation: "Vacaciones",
  sick: "Baja médica",
  personal: "Asunto personal",
  training: "Formación",
  other: "Otro",
};

export default async function FichajesAdminPage() {
  await assertModuleActive("time_tracking");
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdmin) redirect("/fichajes" as never);

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0).toISOString();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();
  const [punches, pending, missing, pendingRequests, companyUsers] =
    await Promise.all([
      listPunchesAdmin({ from: start, to: end }),
      listAbsences({ status: "pending" }),
      getUsersWithoutPunchTodayAction(),
      listPendingPunchRequests().catch(() => []),
      listCompanyUsersForFilter().catch(() => []),
    ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Fichajes · Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hoy. Vista global del equipo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminCreatePunchButton users={companyUsers} />
          <a
            href={"/fichajes/admin/historico"}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📜 Histórico + filtros
          </a>
          <AutoCloseButton />
          <a
            href="/api/export/time-records"
            target="_blank"
            rel="noopener"
            download
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ Exportar inspección
          </a>
          <BackButton href="/fichajes" />
        </div>
      </div>

      {missing.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">⏰ Sin fichar hoy ({missing.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {missing.map((u) => (
                <Badge key={u.user_id} variant="warning">
                  {u.full_name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Solicitudes de fichaje pendientes ({pendingRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {pendingRequests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {r.user_name ?? "Usuario"} ·{" "}
                      {r.punch_kind === "clock_in"
                        ? "Entrada"
                        : r.punch_kind === "clock_out"
                          ? "Salida"
                          : r.punch_kind === "break_start"
                            ? "Inicio descanso"
                            : "Fin descanso"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Para el{" "}
                      {new Date(r.requested_at).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Madrid",
                      })}
                    </div>
                    {r.reason && (
                      <div className="mt-1 text-xs italic text-muted-foreground">
                        “{r.reason}”
                      </div>
                    )}
                  </div>
                  <ApprovePunchRequestButtons requestId={r.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Solicitudes de ausencia pendientes ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {pending.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-semibold">
                      {a.user_name} · {ABSENCE_KIND_LABEL[a.kind] ?? a.kind}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Del {new Date(a.starts_on).toLocaleDateString("es-ES")} al{" "}
                      {new Date(a.ends_on).toLocaleDateString("es-ES")}
                      {a.notes && ` · ${a.notes}`}
                    </div>
                  </div>
                  <ApproveAbsenceButtons absenceId={a.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fichajes de hoy ({punches.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {punches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin fichajes hoy.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Hora</th>
                    <th className="py-2">Usuario</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">GPS</th>
                    <th className="py-2">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {punches.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-1.5 tabular-nums">
                        {new Date(p.punched_at).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-1.5 font-semibold">{p.user_name}</td>
                      <td className="py-1.5">{KIND_LABEL[p.punch_kind] ?? p.punch_kind}</td>
                      <td className="py-1.5">
                        {p.needs_geo_review ? (
                          <Badge variant="destructive">⚠ Sin GPS</Badge>
                        ) : (
                          <span className="text-xs text-emerald-600">OK</span>
                        )}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {p.auto_closed && (
                          <Badge variant="warning" className="mr-1">
                            Autocerrado
                          </Badge>
                        )}
                        {p.is_manual && p.edited_reason && `Edit: ${p.edited_reason}`}
                      </td>
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
