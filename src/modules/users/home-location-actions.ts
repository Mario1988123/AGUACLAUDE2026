"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Guarda coords de origen (casa) del usuario en user_profiles.
 * Necesario para cálculo de rutas óptimas en /mi-día. El propio
 * usuario puede actualizarlo, o el admin de la empresa.
 */
export async function updateUserHomeLocationAction(input: {
  user_id?: string;          // si null, edita el propio
  latitude: number | null;
  longitude: number | null;
  address_label?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const targetUserId = input.user_id ?? session.user_id;
    if (targetUserId !== session.user_id) {
      // Solo admin puede editar coords de otros.
      if (
        !session.is_superadmin &&
        !session.roles.includes("company_admin")
      ) {
        return {
          ok: false,
          error: "Solo admin puede editar coordenadas de otros usuarios",
        };
      }
    }
    if (
      input.latitude != null &&
      (input.latitude < -90 || input.latitude > 90)
    ) {
      return { ok: false, error: "Latitud fuera de rango" };
    }
    if (
      input.longitude != null &&
      (input.longitude < -180 || input.longitude > 180)
    ) {
      return { ok: false, error: "Longitud fuera de rango" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const update: Record<string, unknown> = {
      home_latitude: input.latitude,
      home_longitude: input.longitude,
    };
    if (input.address_label !== undefined) {
      update.home_address_label = input.address_label;
    }
    // Anti cross-tenant: el usuario destino debe pertenecer a MI empresa.
    // El admin client salta RLS, así que filtramos por company_id de la sesión.
    // Si el user_id es de otra empresa, la actualización afecta 0 filas.
    const { error } = await admin
      .from("user_profiles")
      .update(update)
      .eq("user_id", targetUserId)
      .eq("company_id", session.company_id);
    if (error) {
      // Defensa columnas
      if (/column .* does not exist/i.test(error.message ?? "")) {
        // Reintento sin home_address_label si no existe
        delete update.home_address_label;
        const { error: e2 } = await admin
          .from("user_profiles")
          .update(update)
          .eq("user_id", targetUserId)
          .eq("company_id", session.company_id);
        if (e2) return { ok: false, error: e2.message };
      } else {
        return { ok: false, error: error.message };
      }
    }
    revalidatePath("/configuracion/usuarios");
    revalidatePath("/perfil");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
