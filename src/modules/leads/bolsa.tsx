import Link from "next/link";
import { Inbox } from "lucide-react";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardHeader, CardTitle } from "@/shared/ui/card";
import { ESTADOS_LEAD_ABIERTO } from "./inactividad-logica";

/**
 * «Bolsa» de leads: abiertos y sin comercial asignado. La reparte el admin
 * (decisión de Mario 12-11). Solo admin; para el resto devuelve 0.
 * Cliente admin con company_id a mano (count exacto, sin depender de RLS).
 * Fail-soft: si la consulta falla, 0 (no se pinta nada).
 */
export async function contarLeadsEnBolsa(): Promise<number> {
  const session = await requireSession();
  if (!session.company_id) return 0;
  if (!session.is_superadmin && !session.roles.includes("company_admin")) return 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { count, error } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .is("assigned_user_id", null)
      .in("status", ESTADOS_LEAD_ABIERTO as unknown as string[]);
    if (error) {
      console.error("[leads/bolsa] contar:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.error("[leads/bolsa] contar:", e);
    return 0;
  }
}

/** Aviso del dashboard (solo admin, solo si hay leads en la bolsa). */
export function BolsaLeadsCard({ total }: { total: number }) {
  if (total <= 0) return null;
  return (
    <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              {total} lead{total === 1 ? "" : "s"} sin comercial
            </span>
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Están en la bolsa y nadie los trabaja. Repártelos desde el listado de leads.
          </p>
        </div>
        <Link
          href={"/leads?assigned=unassigned" as never}
          prefetch={false}
          className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary hover:underline"
        >
          Repartir la bolsa →
        </Link>
      </CardHeader>
    </Card>
  );
}
