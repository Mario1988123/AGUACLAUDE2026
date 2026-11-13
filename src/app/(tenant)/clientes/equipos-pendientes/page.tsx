import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { BackButton } from "@/shared/components/back-button";
import { ChipModeloEquipo } from "@/modules/equipos-modelo/chip-modelo";
import {
  cargarEquiposConModelo,
  modeloEquipoDisponible,
} from "@/modules/equipos-modelo/datos";

export const dynamic = "force-dynamic";

const MAX_LISTA = 300;

/**
 * Oficina: equipos pendientes de identificar (plan modelo de equipo, UI 10).
 * Cuenta los marcados como pendientes; la lista enseña los primeros 300.
 */
export default async function EquiposPendientesPage() {
  const session = await requireSession();
  const oficina =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!oficina) redirect("/clientes" as never);
  if (!session.company_id) redirect("/dashboard" as never);
  const companyId = session.company_id;

  if (!(await modeloEquipoDisponible())) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Equipos pendientes de identificar</h1>
        <p className="text-sm text-muted-foreground">
          Falta aplicar la migración del modelo de equipo.
        </p>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const filas = await fetchAllRows<{ id: string; customer_id: string; tipo_equipo: string | null }>(
    (from, to) =>
      admin
        .from("customer_equipment")
        .select("id, customer_id, tipo_equipo")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("pendiente_identificar", true)
        .order("created_at")
        .order("id")
        .range(from, to),
    { label: "equipos-pendientes", maxRows: 20000 },
  );
  const porTipo = { fuente: 0, osmosis: 0, desconocido: 0 };
  for (const f of filas) {
    if (f.tipo_equipo === "fuente") porTipo.fuente += 1;
    else if (f.tipo_equipo === "osmosis") porTipo.osmosis += 1;
    else porTipo.desconocido += 1;
  }
  const visibles = filas.slice(0, MAX_LISTA);
  const equipos = await cargarEquiposConModelo(companyId, {
    equipoIds: visibles.map((f) => f.id),
  });
  const custIds = Array.from(new Set(equipos.map((e) => e.customer_id)));
  const nombres = new Map<string, string>();
  for (let i = 0; i < custIds.length; i += 200) {
    const { data } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .eq("company_id", companyId)
      .in("id", custIds.slice(i, i + 200));
    for (const c of (data ?? []) as Array<{
      id: string;
      party_kind: string | null;
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      nombres.set(
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "—"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Equipos pendientes de identificar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filas.length} en total · {porTipo.fuente} fuentes · {porTipo.osmosis} ósmosis ·{" "}
            {porTipo.desconocido} de tipo desconocido. El técnico los identifica en el
            mantenimiento; la oficina, desde la ficha del cliente.
          </p>
        </div>
        <BackButton href="/clientes" />
      </div>
      {equipos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay equipos pendientes.</p>
      ) : (
        <ul className="divide-y rounded-2xl border border-border bg-card">
          {equipos.map((e) => (
            <li key={e.id}>
              <Link
                href={`/clientes/${e.customer_id}`}
                className="flex min-h-14 flex-col gap-1 p-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-semibold">{nombres.get(e.customer_id) ?? "Cliente"}</span>
                <ChipModeloEquipo
                  etiqueta={e.etiqueta}
                  pendiente={e.estado.pendiente}
                  tipo={e.estado.tipo}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {filas.length > MAX_LISTA && (
        <p className="text-xs text-muted-foreground">
          Se enseñan los {MAX_LISTA} primeros de {filas.length}.
        </p>
      )}
    </div>
  );
}
