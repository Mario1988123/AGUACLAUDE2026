import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { recomputeSuggestionsForCompany } from "@/modules/warehouses/purchase-suggestions-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron diario a las 06:00 (vercel.json). Para cada empresa con módulo
 * warehouses activo, recalcula sugerencias de pedido en base a stock_min
 * de los productos. Notifica una vez por empresa si hay sugerencias.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Empresas con warehouses activo (o sin registro → asumir activo)
  const { data: cms } = await admin
    .from("company_modules")
    .select("company_id")
    .eq("module_key", "warehouses")
    .eq("is_active", true);

  const companyIds = ((cms ?? []) as Array<{ company_id: string }>).map(
    (c) => c.company_id,
  );

  let totalCreated = 0;
  const perCompany: Array<{ company_id: string; created: number }> = [];

  for (const companyId of companyIds) {
    try {
      const r = await recomputeSuggestionsForCompany(companyId);
      perCompany.push({ company_id: companyId, created: r.created });
      totalCreated += r.created;

      // Si se generaron sugerencias nuevas, notificar a admins/dir técnicos
      if (r.created > 0) {
        const { data: admins } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("company_id", companyId)
          .in("role_key", ["company_admin", "technical_director"])
          .is("revoked_at", null);
        for (const a of ((admins ?? []) as Array<{ user_id: string }>)) {
          try {
            await admin.from("notifications").insert({
              company_id: companyId,
              recipient_user_id: a.user_id,
              kind: "warehouse.purchase_suggestion",
              severity: "info",
              title: "Sugerencias de pedido pendientes",
              body: `${r.created} producto${r.created === 1 ? "" : "s"} bajo mínimo. Revisa /almacenes/sugerencias.`,
            });
          } catch {
            /* fail-soft */
          }
        }
      }
    } catch (e) {
      console.error("[cron purchase-suggestions]", companyId, e);
    }
  }

  return NextResponse.json({
    ok: true,
    stats: { companies: companyIds.length, total_created: totalCreated, per_company: perCompany },
    ranAt: new Date().toISOString(),
  });
}
