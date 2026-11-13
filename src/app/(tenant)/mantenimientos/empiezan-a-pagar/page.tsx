import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { esNivel12 } from "@/shared/lib/auth/role-scope";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { formatDateES } from "@/shared/lib/format-date";
import {
  listarEmpiezanPagar,
  listarVisitasPorCobrar,
  mantIncluidoDisponible,
  type FilaEmpiezanPagar,
} from "@/modules/mant-incluido/datos";
import { eur } from "@/modules/mant-incluido/logica";

export const dynamic = "force-dynamic";

/**
 * «Empiezan a pagar» (plan docs/PLAN_MANTENIMIENTOS_INCLUIDOS.md §4.5).
 * Solo marca: aquí no se factura ni se cobra nada.
 */
export default async function EmpiezanAPagarPage() {
  const session = await requireSession();
  if (!session.company_id || !esNivel12(session)) redirect("/mantenimientos");
  const companyId = session.company_id;

  if (!(await mantIncluidoDisponible())) {
    return (
      <div className="space-y-4">
        <BackButton href="/mantenimientos" />
        <h1 className="text-2xl font-bold">Empiezan a pagar</h1>
        <p className="text-sm text-muted-foreground">
          Falta aplicar la migración de mantenimientos incluidos. Cuando esté aplicada, aquí saldrán los equipos que
          ya pagan sus mantenimientos.
        </p>
      </div>
    );
  }

  const [equipos, visitas] = await Promise.all([
    listarEmpiezanPagar(companyId),
    listarVisitasPorCobrar(companyId),
  ]);

  // Nombres de cliente y de equipo (admin + company_id).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const clienteIds = Array.from(new Set([...equipos.map((e) => e.customerId), ...visitas.map((v) => v.customerId)]));
  const nombres = new Map<string, string>();
  for (let i = 0; i < clienteIds.length; i += 200) {
    const { data } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .eq("company_id", companyId)
      .in("id", clienteIds.slice(i, i + 200));
    for (const c of (data ?? []) as Array<Record<string, string | null>>) {
      nombres.set(
        String(c.id),
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Sin nombre"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
      );
    }
  }
  const eqIds = equipos.map((e) => e.equipoId);
  const nombreEquipo = new Map<string, string>();
  for (let i = 0; i < eqIds.length; i += 200) {
    const { data } = await admin
      .from("customer_equipment")
      .select("id, product_id, serial_number")
      .eq("company_id", companyId)
      .in("id", eqIds.slice(i, i + 200));
    const filas = (data ?? []) as Array<{ id: string; product_id: string | null; serial_number: string | null }>;
    const prodIds = Array.from(new Set(filas.map((f) => f.product_id).filter(Boolean))) as string[];
    const prod = new Map<string, string>();
    if (prodIds.length) {
      const { data: ps } = await admin
        .from("products")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", prodIds);
      for (const p of (ps ?? []) as Array<{ id: string; name: string }>) prod.set(p.id, p.name);
    }
    for (const f of filas) {
      const base = (f.product_id && prod.get(f.product_id)) || "Equipo";
      nombreEquipo.set(f.id, f.serial_number ? `${base} · ${f.serial_number}` : base);
    }
  }

  const anioActual = new Date().toLocaleString("en-CA", { timeZone: "Europe/Madrid", year: "numeric" });
  const grupos: Array<{ titulo: string; ayuda: string; filas: FilaEmpiezanPagar[] }> = [
    {
      titulo: "Ya pagan",
      ayuda: "La próxima visita se cobra.",
      filas: equipos.filter((e) => e.estado === "a_pagar"),
    },
    {
      titulo: "Última revisión incluida",
      ayuda: "Avisa al cliente: el año siguiente paga.",
      filas: equipos.filter((e) => e.estado === "ultima_incluida"),
    },
    {
      titulo: "Venta sin nº de mantenimientos incluidos",
      ayuda: "Pon N en la ficha del cliente (lápiz «Mant. incluido» del equipo).",
      filas: equipos.filter((e) => e.estado === "sin_dato"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackButton href="/mantenimientos" />
        <h1 className="text-2xl font-bold">Empiezan a pagar</h1>
        <p className="text-sm text-muted-foreground">
          Equipos cuyo mantenimiento incluido ha terminado o termina, y visitas cerradas sin cobrar. Solo es un
          aviso: no se factura nada. Este año ({anioActual}) empiezan a pagar{" "}
          <strong>{equipos.filter((e) => String(e.anioPaga) === anioActual).length}</strong>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Visitas cerradas sin cobrar ({visitas.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {visitas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna.</p>
          ) : (
            <ul className="divide-y">
              {visitas.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <Link href={`/mantenimientos/${v.id}` as never} className="font-semibold text-primary hover:underline">
                      {nombres.get(v.customerId) ?? "Cliente"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {v.completedAt ? formatDateES(v.completedAt) : "—"}
                      {v.pago === "pendiente" ? " · diferencia de membrana" : " · sin cobrar"}
                      {v.motivo ? ` · ${v.motivo}` : ""}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums text-red-800">
                    {v.pendienteCents != null ? `${eur(v.pendienteCents)} + IVA` : "Sin precio"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {grupos.map((g) => (
        <Card key={g.titulo}>
          <CardHeader>
            <CardTitle>
              {g.titulo} ({g.filas.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">{g.ayuda}</p>
          </CardHeader>
          <CardContent>
            {g.filas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguno.</p>
            ) : (
              <ul className="divide-y">
                {g.filas.map((f) => (
                  <li key={f.equipoId} className="py-2 text-sm">
                    <Link
                      href={`/clientes/${f.customerId}#mant-${f.equipoId}` as never}
                      className="font-semibold text-primary hover:underline"
                    >
                      {nombres.get(f.customerId) ?? "Cliente"}
                    </Link>
                    <span className="block break-words text-xs text-muted-foreground">
                      {nombreEquipo.get(f.equipoId) ?? "Equipo"}
                      {f.installedAt ? ` · instalado ${formatDateES(f.installedAt)}` : ""}
                      {f.n != null ? ` · N = ${f.n}` : ""}
                      {f.anioPaga ? ` · paga desde ${f.anioPaga}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
