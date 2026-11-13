import Link from "next/link";
import { PackageX } from "lucide-react";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { formatDateES } from "@/shared/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  retiradasConEquiposActivos,
  type EquipoActivo,
  type LineaRetirada,
  type OrdenRetirada,
  type RetiradaPendiente,
} from "./retiradas-pendientes-logica";

export type RetiradaPendienteFila = RetiradaPendiente & { customer_name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const TROZO = 150;
function trozos<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += TROZO) out.push(xs.slice(i, i + TROZO));
  return out;
}

/** Lee por trozos de ids (evita URLs enormes) y por páginas de 1000. */
async function leerPorIds<T>(
  ids: string[],
  label: string,
  build: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of trozos(ids)) {
    out.push(...(await fetchAllRows<T>((from, to) => build(chunk, from, to), { label })));
  }
  return out;
}

/**
 * Retiradas completadas que dejaron equipos activos (fallo de las notas,
 * arreglado el 2026-11-09). Solo admin. Todo filtrado por la empresa de la
 * sesión (cliente admin). Si algo falla, no se pinta (devuelve []).
 */
export async function getRetiradasPendientes(): Promise<RetiradaPendienteFila[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  if (!session.is_superadmin && !session.roles.includes("company_admin")) return [];
  const companyId = session.company_id;
  const admin = createAdminClient() as Admin;

  try {
    const ordenes = await fetchAllRows<OrdenRetirada>(
      (from, to) =>
        admin
          .from("installations")
          .select("id, reference_code, customer_id, completed_at")
          .eq("company_id", companyId)
          .eq("kind", "uninstall")
          .eq("status", "completed")
          .is("free_trial_id", null)
          .not("customer_id", "is", null)
          .order("completed_at", { ascending: false })
          .range(from, to),
      { label: "retiradas-pendientes:ordenes" },
    );
    if (ordenes.length === 0) return [];
    const ordenIds = ordenes.map((o) => o.id);
    const clienteIds = Array.from(new Set(ordenes.map((o) => o.customer_id)));

    const lineas = await leerPorIds<LineaRetirada>(ordenIds, "retiradas-pendientes:lineas", (chunk, from, to) =>
      admin
        .from("installation_items")
        .select("installation_id, product_id, quantity")
        .in("installation_id", chunk)
        .range(from, to),
    );

    const activos = await leerPorIds<EquipoActivo>(clienteIds, "retiradas-pendientes:activos", (chunk, from, to) =>
      admin
        .from("customer_equipment")
        .select("id, customer_id, product_id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .in("customer_id", chunk)
        .range(from, to),
    );

    type Ev = { subject_id: string; kind: string; created_at: string; payload: Record<string, unknown> | null };
    const eventos = await leerPorIds<Ev>(clienteIds, "retiradas-pendientes:eventos", (chunk, from, to) =>
      admin
        .from("events")
        .select("subject_id, kind, created_at:occurred_at, payload")
        .eq("company_id", companyId)
        .eq("subject_type", "customer")
        .in("kind", ["equipment.uninstall_requested", "equipment.manual_uninstall"])
        .in("subject_id", chunk)
        .range(from, to),
    );

    const ordenSet = new Set(ordenIds);
    const equiposDeOrden = new Map<string, string[]>();
    const manualesRaw: Array<{ customer_id: string; created_at: string; ids: string[] }> = [];
    for (const e of eventos) {
      const ids = Array.isArray(e.payload?.equipment_ids)
        ? (e.payload!.equipment_ids as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      if (e.kind === "equipment.uninstall_requested") {
        const inst = typeof e.payload?.installation_id === "string" ? (e.payload.installation_id as string) : null;
        if (inst && ordenSet.has(inst)) equiposDeOrden.set(inst, ids);
      } else {
        manualesRaw.push({ customer_id: e.subject_id, created_at: e.created_at, ids });
      }
    }

    // Producto de los equipos retirados a mano (ya inactivos).
    const idsManuales = Array.from(new Set(manualesRaw.flatMap((m) => m.ids)));
    const productoDe = new Map<string, string | null>();
    if (idsManuales.length > 0) {
      const filas = await leerPorIds<{ id: string; product_id: string | null }>(
        idsManuales,
        "retiradas-pendientes:manuales",
        (chunk, from, to) =>
          admin
            .from("customer_equipment")
            .select("id, product_id")
            .eq("company_id", companyId)
            .in("id", chunk)
            .range(from, to),
      );
      for (const f of filas) productoDe.set(f.id, f.product_id);
    }
    const manuales = manualesRaw.map((m) => ({
      customer_id: m.customer_id,
      created_at: m.created_at,
      product_ids: m.ids.map((id) => productoDe.get(id)).filter((p): p is string => !!p),
    }));

    const pendientes = retiradasConEquiposActivos({ ordenes, lineas, equiposDeOrden, activos, manuales });
    if (pendientes.length === 0) return [];

    const { data: custs, error: cErr } = await admin
      .from("customers")
      .select("id, trade_name, legal_name, first_name, last_name")
      .eq("company_id", companyId)
      .in("id", Array.from(new Set(pendientes.map((p) => p.customer_id))));
    if (cErr) console.error("[retiradas-pendientes] clientes:", cErr.message);
    const nombre = new Map<string, string>();
    for (const c of (custs ?? []) as Array<{
      id: string;
      trade_name: string | null;
      legal_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      nombre.set(
        c.id,
        c.trade_name || c.legal_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente",
      );
    }
    return pendientes.map((p) => ({ ...p, customer_name: nombre.get(p.customer_id) ?? "Cliente" }));
  } catch (e) {
    console.error("[retiradas-pendientes]", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Tarjeta del dashboard (solo se pinta si hay casos). */
export function RetiradasPendientesCard({ items }: { items: RetiradaPendienteFila[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageX className="h-4 w-4 shrink-0 text-amber-700" />
          <span>Retiradas que dejaron equipos activos ({items.length})</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Se cerraron pero el equipo sigue de alta en el cliente (fallo ya corregido). Corrígelo con
          «Retirar manualmente» en la ficha del cliente.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-amber-200">
          {items.map((r) => (
            <li key={r.installation_id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold break-words">
                  <Link href={`/instalaciones/${r.installation_id}` as never} className="hover:underline">
                    {r.reference_code ?? r.installation_id.slice(0, 8)}
                  </Link>
                  <span className="font-normal text-muted-foreground"> · {r.customer_name}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.completed_at ? formatDateES(r.completed_at) : "Sin fecha"} · {r.retirados} retirado
                  {r.retirados === 1 ? "" : "s"} / {r.activos} activo{r.activos === 1 ? "" : "s"}
                </p>
              </div>
              <Link
                href={`/clientes/${r.customer_id}` as never}
                className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-primary hover:underline sm:min-h-0"
              >
                Abrir ficha del cliente →
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
