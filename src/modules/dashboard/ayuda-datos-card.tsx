import Link from "next/link";
import { HelpCircle, ChevronRight } from "lucide-react";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { esGestorStock } from "@/shared/lib/auth/role-scope";

/**
 * «Necesitamos tu ayuda» (2026-11-25): preguntas de datos a la admin de la
 * empresa que salen en su DASHBOARD. Se activan con un aviso normal
 * (`notifications`, kind = AYUDA_FILTROS_FUENTES) creado por SQL de datos
 * para esa persona; la lista se calcula EN VIVO, así que cada gama
 * desaparece en cuanto tiene filtros y la tarjeta se va sola al acabar.
 *
 * Primera pregunta: qué filtros lleva cada gama de fuente que no tiene
 * ninguno (sin ellos la carga sugerida no sabe qué llevar al mantenimiento).
 */

export const AYUDA_FILTROS_FUENTES = "datos.ayuda_filtros_fuentes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface AyudaFiltrosFuentes {
  mensaje: string | null;
  gamas: Array<{ id: string; nombre: string; equipos: number }>;
}

export async function getAyudaFiltrosFuentes(): Promise<AyudaFiltrosFuentes | null> {
  const session = await requireSession();
  if (!session.company_id || !esGestorStock(session)) return null;
  const companyId = session.company_id;
  const admin = createAdminClient() as Admin;

  const { data: aviso } = await admin
    .from("notifications")
    .select("id, body")
    .eq("company_id", companyId)
    .eq("recipient_user_id", session.user_id)
    .eq("kind", AYUDA_FILTROS_FUENTES)
    .is("acted_at", null)
    .is("auto_resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!aviso) return null;

  const [pr, ca, asg, eq] = await Promise.all([
    admin
      .from("products")
      .select("id, name, category_id, tipo_equipo, gama_id")
      .eq("company_id", companyId)
      .eq("kind", "equipment")
      .is("deleted_at", null)
      .limit(1000),
    admin.from("product_categories").select("id, tipo_equipo").eq("company_id", companyId).limit(1000),
    admin.from("product_filter_assignments").select("product_id").eq("company_id", companyId).limit(5000),
    admin
      .from("customer_equipment")
      .select("product_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .not("product_id", "is", null)
      .limit(5000),
  ]);
  const tipoCat = new Map(
    ((ca.data ?? []) as Array<{ id: string; tipo_equipo: string | null }>).map((c) => [c.id, c.tipo_equipo]),
  );
  const conFiltros = new Set(((asg.data ?? []) as Array<{ product_id: string }>).map((a) => a.product_id));
  const productos = (pr.data ?? []) as Array<{
    id: string;
    name: string;
    category_id: string | null;
    tipo_equipo: string | null;
    gama_id: string | null;
  }>;
  // Equipos por gama (una variante cuenta para su gama).
  const gamaDe = new Map(productos.map((p) => [p.id, p.gama_id ?? p.id]));
  const equipos = new Map<string, number>();
  for (const e of (eq.data ?? []) as Array<{ product_id: string }>) {
    const g = gamaDe.get(e.product_id) ?? e.product_id;
    equipos.set(g, (equipos.get(g) ?? 0) + 1);
  }
  const gamas = productos
    .filter((p) => !p.gama_id)
    .filter((p) => (p.tipo_equipo ?? (p.category_id ? tipoCat.get(p.category_id) : null)) === "fuente")
    .filter((p) => !conFiltros.has(p.id))
    .map((p) => ({ id: p.id, nombre: p.name.trim(), equipos: equipos.get(p.id) ?? 0 }))
    .sort((a, b) => b.equipos - a.equipos || a.nombre.localeCompare(b.nombre, "es"));
  if (gamas.length === 0) return null;
  return { mensaje: (aviso as { body: string | null }).body, gamas };
}

export function AyudaFiltrosFuentesCard({ data }: { data: AyudaFiltrosFuentes }) {
  return (
    <section
      className="rounded-2xl border-2 border-sky-300 bg-sky-50/60 p-4 dark:border-sky-800 dark:bg-sky-950/30"
      aria-labelledby="ayuda-datos-titulo"
    >
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="ayuda-datos-titulo" className="text-base font-bold">
            Necesitamos tu ayuda
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.mensaje ??
              "¿Qué filtros lleva cada una de estas fuentes? Sin ellos, la carga de la furgoneta no sabe qué llevar a sus mantenimientos."}
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-sky-200 rounded-xl border border-sky-200 bg-card dark:divide-sky-900 dark:border-sky-900">
        {data.gamas.map((g) => (
          <li key={g.id}>
            <Link
              href={`/productos/${g.id}?abrir=filtros` as never}
              className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{g.nombre}</span>
                <span className="block text-xs text-muted-foreground">
                  {g.equipos} equipo{g.equipos === 1 ? "" : "s"} de clientes · asignar filtros
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
