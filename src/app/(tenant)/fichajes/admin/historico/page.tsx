import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import {
  listPunchesAdmin,
  listCompanyUsersForFilter,
} from "@/modules/time-tracking/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { BackButton } from "@/shared/components/back-button";
import { AdminCreatePunchButton } from "@/modules/time-tracking/admin-create-punch-button";
import { AdminPunchRowActions } from "@/modules/time-tracking/admin-punch-row-actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  clock_in: "Entrada",
  clock_out: "Salida",
  break_start: "Inicio descanso",
  break_end: "Fin descanso",
};

export default async function HistoricoFichajesPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    user_id?: string;
    kind?: string;
    only_no_geo?: string;
    only_manual?: string;
    only_autoclosed?: string;
  }>;
}) {
  await assertModuleActive("time_tracking");
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdmin) redirect("/fichajes" as never);

  const sp = await searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);

  const from = sp.from || defaultFrom;
  const to = sp.to || defaultTo;
  const userId = sp.user_id || "";
  const kind = sp.kind || "";
  const onlyNoGeo = sp.only_no_geo === "1";
  const onlyManual = sp.only_manual === "1";
  const onlyAutoclosed = sp.only_autoclosed === "1";

  const [punches, users] = await Promise.all([
    listPunchesAdmin({
      from: new Date(from + "T00:00:00").toISOString(),
      to: new Date(to + "T23:59:59.999").toISOString(),
      user_id: userId || undefined,
      kind: (kind as "clock_in" | "clock_out" | "break_start" | "break_end") || undefined,
      only_no_geo: onlyNoGeo,
      only_manual: onlyManual,
      only_autoclosed: onlyAutoclosed,
    }),
    listCompanyUsersForFilter(),
  ]);

  // Construir URL del export con los mismos filtros
  const exportParams = new URLSearchParams();
  exportParams.set("from", from);
  exportParams.set("to", to);
  if (userId) exportParams.set("user_id", userId);
  if (kind) exportParams.set("kind", kind);
  if (onlyNoGeo) exportParams.set("only_no_geo", "1");
  if (onlyManual) exportParams.set("only_manual", "1");
  if (onlyAutoclosed) exportParams.set("only_autoclosed", "1");
  const exportUrl = `/api/export/time-records?${exportParams.toString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Histórico de fichajes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Filtra por usuario, rango y estado. Hasta 2.000 filas por
            consulta.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <AdminCreatePunchButton users={users} />
          <a
            href={exportUrl}
            target="_blank"
            rel="noopener"
            download
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ Exportar CSV
          </a>
          <BackButton href="/fichajes/admin" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="GET" className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" name="from" defaultValue={from} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" name="to" defaultValue={to} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Usuario</Label>
              <select
                name="user_id"
                defaultValue={userId}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Todos —</option>
                {users.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <select
                name="kind"
                defaultValue={kind}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Todos —</option>
                <option value="clock_in">Entrada</option>
                <option value="clock_out">Salida</option>
                <option value="break_start">Inicio descanso</option>
                <option value="break_end">Fin descanso</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-4">
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="only_no_geo"
                    value="1"
                    defaultChecked={onlyNoGeo}
                    className="h-4 w-4"
                  />
                  Sin GPS
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="only_manual"
                    value="1"
                    defaultChecked={onlyManual}
                    className="h-4 w-4"
                  />
                  Solo manuales (editados / aprobados por admin)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="only_autoclosed"
                    value="1"
                    defaultChecked={onlyAutoclosed}
                    className="h-4 w-4"
                  />
                  Solo autocerrados
                </label>
              </div>
            </div>
            <div className="sm:col-span-4 flex justify-end gap-2">
              <Button asChild variant="outline">
                <Link href={"/fichajes/admin/historico" as never}>
                  Limpiar
                </Link>
              </Button>
              <Button type="submit" variant="success">
                Aplicar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultados ({punches.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {punches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay fichajes con esos filtros.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Hora</th>
                    <th className="py-2">Usuario</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">GPS</th>
                    <th className="py-2">Notas</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {punches.map((p) => {
                    const d = new Date(p.punched_at);
                    const dateLabel = d.toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      timeZone: "Europe/Madrid",
                    });
                    const timeLabel = d.toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Madrid",
                    });
                    const ctx = `${KIND_LABEL[p.punch_kind] ?? p.punch_kind} · ${p.user_name ?? "—"} · ${dateLabel} ${timeLabel}`;
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1.5 tabular-nums">{dateLabel}</td>
                        <td className="py-1.5 tabular-nums">{timeLabel}</td>
                        <td className="py-1.5 font-semibold">
                          {p.user_name ?? "—"}
                        </td>
                        <td className="py-1.5">
                          {KIND_LABEL[p.punch_kind] ?? p.punch_kind}
                        </td>
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
                          {p.is_manual && (
                            <Badge variant="secondary" className="mr-1">
                              Manual
                            </Badge>
                          )}
                          {p.edited_reason && `${p.edited_reason}`}
                        </td>
                        <td className="py-1.5 text-right">
                          <div className="flex justify-end">
                            <AdminPunchRowActions
                              punchId={p.id}
                              currentPunchedAt={p.punched_at}
                              contextLabel={ctx}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
