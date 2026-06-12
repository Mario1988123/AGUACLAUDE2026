"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface VacationWindow {
  id: string;
  year: number;
  starts_on: string;
  ends_on: string;
  label: string;
  max_concurrent_users: number | null;
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  starts_on: z.string().min(1),
  ends_on: z.string().min(1),
  label: z.string().min(1, "Etiqueta obligatoria"),
  max_concurrent_users: z.coerce.number().int().positive().nullable().optional(),
});

async function ensureAdminOrDirector() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!ok) throw new Error("Solo admin / director");
  return session;
}

export async function listVacationWindowsForYear(
  year: number,
): Promise<VacationWindow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("vacation_windows")
    .select("id, year, starts_on, ends_on, label, max_concurrent_users")
    .eq("company_id", session.company_id)
    .eq("year", year)
    .order("starts_on");
  if (error) {
    console.warn("[listVacationWindowsForYear]", error.message);
    return [];
  }
  return (data ?? []) as VacationWindow[];
}

export async function upsertVacationWindowAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(upsertSchema, input, "Ventana vacacional");
    const startDate = new Date(parsed.starts_on);
    const endDate = new Date(parsed.ends_on);
    if (endDate < startDate) {
      return {
        ok: false,
        error: "La fecha fin no puede ser anterior a la de inicio",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const year = startDate.getFullYear();
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      year,
      starts_on: parsed.starts_on,
      ends_on: parsed.ends_on,
      label: parsed.label,
      max_concurrent_users: parsed.max_concurrent_users ?? null,
    };
    if (parsed.id) {
      // Scoping cross-tenant: solo actualizar si la ventana es de MI empresa.
      // Con admin client (salta RLS) hay que filtrar también por company_id;
      // si es de otra empresa, .select() devuelve 0 filas → abortamos.
      const r = await admin
        .from("vacation_windows")
        .update(payload)
        .eq("id", parsed.id)
        .eq("company_id", session.company_id)
        .select("id")
        .maybeSingle();
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data) return { ok: false, error: "No encontrado" };
      revalidatePath("/configuracion/festivos");
      return { ok: true, id: parsed.id };
    }
    const r = await admin
      .from("vacation_windows")
      .insert({ ...payload, created_by: session.user_id })
      .select("id")
      .single();
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/configuracion/festivos");
    return { ok: true, id: (r.data as { id: string }).id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error",
    };
  }
}

export async function deleteVacationWindowAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Scoping cross-tenant: añadir company_id para no borrar ventanas de otra
    // empresa con admin client (salta RLS). Si es de otra empresa → 0 filas.
    const r = await admin
      .from("vacation_windows")
      .delete()
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/configuracion/festivos");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error",
    };
  }
}

/** Comprueba si una solicitud de vacaciones (rango de fechas) está
 *  permitida según las reglas:
 *   - ≤2 días laborables → siempre permitido (días sueltos).
 *   - >2 días → debe encajar enteramente dentro de UNA ventana
 *     vacacional definida, y la ventana no debe estar al tope de aforo.
 *
 *  Devuelve { ok: true } o { ok: false, reason }. */
export async function checkVacationRequestAllowed(input: {
  user_id: string;
  starts_on: string;
  ends_on: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const start = new Date(input.starts_on + "T00:00:00");
  const end = new Date(input.ends_on + "T00:00:00");
  if (end < start) return { ok: false, reason: "Fecha fin antes de inicio" };

  // Contar días laborables (lun-vie) del rango
  let businessDays = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) businessDays++;
    cur.setDate(cur.getDate() + 1);
  }

  // ≤2 días → siempre OK
  if (businessDays <= 2) return { ok: true };

  // >2 días → buscar ventana que contenga TODO el rango
  const session = await requireSession();
  if (!session.company_id) return { ok: false, reason: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: windows, error } = await admin
    .from("vacation_windows")
    .select("id, starts_on, ends_on, label, max_concurrent_users")
    .eq("company_id", session.company_id)
    .lte("starts_on", input.starts_on)
    .gte("ends_on", input.ends_on);
  if (error) {
    // Si la tabla no existe aún (migración pendiente), permitir.
    return { ok: true };
  }
  type W = {
    id: string;
    starts_on: string;
    ends_on: string;
    label: string;
    max_concurrent_users: number | null;
  };
  const matching = (windows ?? []) as W[];
  if (matching.length === 0) {
    return {
      ok: false,
      reason:
        "Solo puedes pedir vacaciones de más de 2 días dentro de las ventanas autorizadas por la empresa. Fuera de ellas únicamente se admiten 1 o 2 días sueltos.",
    };
  }

  // Hay al menos una ventana que cubre el rango. Si tiene cap, comprobar.
  for (const w of matching) {
    if (w.max_concurrent_users == null) return { ok: true };
    // Contar ausencias aprobadas que solapen el rango pedido EN ESTA ventana
    const { data: overlapping } = await admin
      .from("time_absences")
      .select("user_id")
      .eq("company_id", session.company_id)
      .eq("status", "approved")
      .eq("kind", "vacation")
      .neq("user_id", input.user_id) // no contar a uno mismo si re-pide
      .lte("starts_on", input.ends_on)
      .gte("ends_on", input.starts_on);
    const users = new Set(
      ((overlapping ?? []) as Array<{ user_id: string }>).map((o) => o.user_id),
    );
    if (users.size >= w.max_concurrent_users) {
      return {
        ok: false,
        reason: `La ventana "${w.label}" ya tiene el cupo máximo de ${w.max_concurrent_users} personas. Pide otras fechas o consulta con admin.`,
      };
    }
  }
  return { ok: true };
}
