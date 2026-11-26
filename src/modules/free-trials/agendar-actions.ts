"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { madridLocalToUtcISO } from "@/shared/lib/format-date";
import { puedeAgendarPrueba } from "./permisos";

const agendarSchema = z.object({
  trial_id: z.string().uuid(),
  /** <input type="datetime-local"> = hora de pared de Madrid. */
  scheduled_at: z.string().min(1, "Indica el día y la hora"),
  installer_user_id: z
    .string({ required_error: "Elige el instalador" })
    .uuid({ message: "Elige el instalador" }),
});

/** Roles que pueden instalar (los mismos que lista listInstallers). */
const ROLES_INSTALADOR = ["installer", "technical_director", "company_admin"];

/**
 * Agenda la instalación de una prueba gratuita: día, hora e instalador
 * (Mario 2026-11-26). Solo admin o director técnico; el comercial crea la
 * prueba y le llega a ellos el aviso con el enlace a esta tarjeta.
 *
 * Deja la prueba en «Agendada», pone la cita en la agenda del instalador
 * (kind installation, subject free_trial; si ya había una, la mueve) y le
 * avisa. La instalación de verdad la sigue marcando el wizard de firma.
 */
export async function agendarInstalacionPruebaSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!puedeAgendarPrueba(session)) {
      return {
        ok: false,
        error: "Solo el admin o el director técnico pueden agendar la instalación.",
      };
    }
    const parsed = parseOrFriendly(agendarSchema, input, "Agendar instalación");
    const iso = madridLocalToUtcISO(parsed.scheduled_at);
    if (!iso) return { ok: false, error: "Fecha y hora no válidas" };
    // Margen de 1 min por desfase de reloj, como en /instalaciones.
    if (new Date(iso).getTime() < Date.now() - 60 * 1000) {
      return { ok: false, error: "No se puede agendar en el pasado. Elige una fecha y hora futura." };
    }

    // Admin client: la policy ft_update depende del scope; el permiso ya se
    // ha comprobado arriba. Todo filtrado por company_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: trialData, error: tErr } = await admin
      .from("free_trials")
      .select("id, status, reference_code, installation_address_id")
      .eq("id", parsed.trial_id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (tErr) throw tErr;
    const trial = trialData as
      | {
          id: string;
          status: string;
          reference_code: string | null;
          installation_address_id: string | null;
        }
      | null;
    if (!trial) return { ok: false, error: "Prueba no encontrada" };
    if (trial.status !== "draft" && trial.status !== "scheduled") {
      return { ok: false, error: "Esta prueba ya no está pendiente de instalar." };
    }

    // El instalador tiene que ser de la empresa y con rol de instalar.
    const { data: rolInst } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("company_id", session.company_id)
      .eq("user_id", parsed.installer_user_id)
      .in("role_key", ROLES_INSTALADOR)
      .is("revoked_at", null)
      .limit(1);
    if (!rolInst?.length) return { ok: false, error: "Ese instalador no es de tu empresa." };

    const { data: upd, error: uErr } = await admin
      .from("free_trials")
      .update({
        status: "scheduled",
        scheduled_at: iso,
        assigned_installer_user_id: parsed.installer_user_id,
      })
      .eq("id", trial.id)
      .eq("company_id", session.company_id)
      .in("status", ["draft", "scheduled"])
      .select("id");
    if (uErr) throw uErr;
    if (!upd?.length) return { ok: false, error: "No se pudo agendar: la prueba ha cambiado de estado." };

    // Cita en la agenda del instalador. Si ya había una abierta, se mueve.
    const titulo = `Instalación prueba gratuita${trial.reference_code ? ` ${trial.reference_code}` : ""}`;
    const { data: citaPrevia } = await admin
      .from("agenda_events")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("subject_type", "free_trial")
      .eq("subject_id", trial.id)
      .eq("kind", "installation")
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    const cita = {
      starts_at: iso,
      ends_at: null,
      assigned_user_id: parsed.installer_user_id,
      title: titulo,
      address_id: trial.installation_address_id,
    };
    const rCita = citaPrevia
      ? await admin
          .from("agenda_events")
          .update(cita)
          .eq("id", (citaPrevia as { id: string }).id)
          .eq("company_id", session.company_id)
      : await admin.from("agenda_events").insert({
          ...cita,
          company_id: session.company_id,
          kind: "installation",
          status: "scheduled",
          subject_type: "free_trial",
          subject_id: trial.id,
          created_by: session.user_id,
        });
    if (rCita.error) {
      // La prueba ya está agendada; la cita es un añadido.
      console.error("[agendarPrueba] cita de agenda:", rCita.error.message);
    }

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "free_trial",
      subject_id: trial.id,
      kind: "free_trial.scheduled",
      payload: { scheduled_at: iso, installer_user_id: parsed.installer_user_id },
      actor_user_id: session.user_id,
    });

    if (parsed.installer_user_id !== session.user_id) {
      try {
        const { notify } = await import("@/modules/notifications/notifier");
        const cuando = new Date(iso).toLocaleString("es-ES", {
          timeZone: "Europe/Madrid",
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
        await notify({
          company_id: session.company_id,
          recipient_user_id: parsed.installer_user_id,
          kind: "free_trial.assigned",
          category: "alert",
          severity: "info",
          title: "Te han asignado una prueba gratuita",
          body: `Instalación el ${cuando}.`,
          subject_type: "free_trial",
          subject_id: trial.id,
          action_url: `/pruebas-gratuitas/${trial.id}`,
        });
      } catch (e) {
        console.error("[agendarPrueba] aviso al instalador:", e);
      }
    }

    revalidatePath(`/pruebas-gratuitas/${trial.id}`);
    revalidatePath("/pruebas-gratuitas");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
