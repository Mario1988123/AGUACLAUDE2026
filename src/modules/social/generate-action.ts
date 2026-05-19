"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { generateMonthlyPosts } from "./generator";

/**
 * Genera todos los posts borrador del mes indicado para la empresa
 * actual. Idempotente: si ya hay posts del mes para canal/día/efeméride,
 * salta y no duplica.
 *
 * Llamado desde:
 *   · Botón "Generar mes X" en /rrss (admin/director)
 *   · Cron diario (día 25) para empresas en autonomous_mode = true
 */
export async function generateMonthlyPostsAction(input: {
  year: number;
  month: number;
}): Promise<
  | { ok: true; posts_created: number; ephemerides_used: number }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) {
      return { ok: false, error: "Solo admin o director comercial" };
    }
    if (
      !Number.isInteger(input.year) ||
      !Number.isInteger(input.month) ||
      input.month < 1 ||
      input.month > 12
    ) {
      return { ok: false, error: "Año/mes inválidos" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await generateMonthlyPosts(admin, session.company_id, input.year, input.month);
    if (!r.ok) {
      return {
        ok: false,
        error: `Generación con errores: ${r.errors.slice(0, 2).join(" · ")}`,
      };
    }
    revalidatePath("/rrss");
    revalidatePath("/rrss/posts");
    return {
      ok: true,
      posts_created: r.posts_created,
      ephemerides_used: r.ephemerides_used,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
