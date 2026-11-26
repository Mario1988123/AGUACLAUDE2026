/**
 * Prueba gratuita ↔ instalación ↔ cita de agenda (Mario 2026-11-26).
 *
 * Antes la prueba agendada solo vivía en una cita de agenda (subject
 * free_trial) y la fila de `installations` se creaba ya «completada» al
 * instalar: no salía en /instalaciones y mover la cita no movía la prueba.
 *
 * Ahora, al agendar, se crea (o se mueve) UNA instalación kind=free_trial en
 * «scheduled» y UNA cita de agenda con subject installation. Lo que se cambie
 * en cualquiera de los tres sitios se copia a los otros dos con estas
 * funciones. La instalación de verdad (stock, equipos, firma) la sigue
 * haciendo la prueba: ver installFreeTrialAction, que reutiliza esta fila.
 *
 * Helpers de SERVIDOR con admin client: quien llama ya ha comprobado permiso
 * y todo va filtrado por company_id.
 */
import { siguienteReferencia } from "@/modules/scheduling/referencias";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const ESTADOS_ABIERTOS = ["unscheduled", "scheduled", "in_progress", "paused", "incident_pending"];
const DOS_HORAS = 2 * 60 * 60 * 1000;

/** Instalación de la prueba aún sin cerrar (la que se agenda), o null. */
export async function instalacionAbiertaDePrueba(
  admin: Admin,
  companyId: string,
  trialId: string,
): Promise<{ id: string; reference_code: string | null } | null> {
  const { data } = await admin
    .from("installations")
    .select("id, reference_code")
    .eq("company_id", companyId)
    .eq("free_trial_id", trialId)
    .eq("kind", "free_trial")
    .in("status", ESTADOS_ABIERTOS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const fila = (data ?? [])[0] as { id: string; reference_code: string | null } | undefined;
  return fila ?? null;
}

/** Nombre del cliente o del lead de la prueba, para el título de la cita. */
async function nombreDePrueba(
  admin: Admin,
  companyId: string,
  trial: { customer_id: string | null; lead_id: string | null },
): Promise<string | null> {
  if (trial.customer_id) {
    const { data } = await admin
      .from("customers")
      .select("trade_name, legal_name, first_name, last_name")
      .eq("id", trial.customer_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const c = data as Record<string, string | null> | null;
    if (c) {
      return (
        c.trade_name || c.legal_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || null
      );
    }
  }
  if (trial.lead_id) {
    const { data } = await admin
      .from("leads")
      .select("party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", trial.lead_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const l = data as Record<string, string | null> | null;
    if (l) {
      return l.party_kind === "company"
        ? l.trade_name || l.legal_name || null
        : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || null;
    }
  }
  return null;
}

/**
 * Deja UNA cita de agenda (subject installation) con la fecha y el
 * instalador. Si había la cita antigua de la prueba (subject free_trial), la
 * reconvierte en vez de crear otra: así no sale dos veces.
 */
async function citaDeInstalacion(
  admin: Admin,
  p: {
    companyId: string;
    installationId: string;
    trialId: string;
    startsAt: string;
    installerId: string | null;
    titulo: string;
    addressId: string | null;
    actorId: string | null;
  },
): Promise<void> {
  const base = {
    starts_at: p.startsAt,
    ends_at: new Date(new Date(p.startsAt).getTime() + DOS_HORAS).toISOString(),
    assigned_user_id: p.installerId,
    title: p.titulo,
    address_id: p.addressId,
    status: "scheduled",
    kind: "installation",
    subject_type: "installation",
    subject_id: p.installationId,
  };
  const { data: deInst } = await admin
    .from("agenda_events")
    .select("id")
    .eq("company_id", p.companyId)
    .eq("subject_type", "installation")
    .eq("subject_id", p.installationId)
    .is("deleted_at", null)
    .limit(1);
  let id = ((deInst ?? [])[0] as { id: string } | undefined)?.id ?? null;
  if (!id) {
    const { data: dePrueba } = await admin
      .from("agenda_events")
      .select("id")
      .eq("company_id", p.companyId)
      .eq("subject_type", "free_trial")
      .eq("subject_id", p.trialId)
      .eq("kind", "installation")
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .limit(1);
    id = ((dePrueba ?? [])[0] as { id: string } | undefined)?.id ?? null;
  }
  const r = id
    ? await admin.from("agenda_events").update(base).eq("id", id).eq("company_id", p.companyId)
    : await admin
        .from("agenda_events")
        .insert({ ...base, company_id: p.companyId, created_by: p.actorId });
  if (r.error) console.error("[instalacionPrueba] cita de agenda:", r.error.message);
}

/**
 * Al agendar la prueba: crea o mueve su instalación en «scheduled» y su cita.
 * Devuelve el id de la instalación (null si el módulo de instalaciones está
 * apagado en la empresa; entonces solo queda la cita).
 */
export async function agendarInstalacionDePrueba(
  admin: Admin,
  p: {
    companyId: string;
    trialId: string;
    startsAt: string;
    installerId: string;
    actorId: string;
  },
): Promise<string | null> {
  const { data: trialData } = await admin
    .from("free_trials")
    .select("id, reference_code, customer_id, lead_id, installation_address_id")
    .eq("id", p.trialId)
    .eq("company_id", p.companyId)
    .maybeSingle();
  const trial = trialData as {
    id: string;
    reference_code: string | null;
    customer_id: string | null;
    lead_id: string | null;
    installation_address_id: string | null;
  } | null;
  if (!trial) throw new Error("Prueba no encontrada");

  const { data: mod } = await admin
    .from("company_modules")
    .select("is_active")
    .eq("company_id", p.companyId)
    .eq("module_key", "installations")
    .maybeSingle();
  const moduloActivo = !(mod && (mod as { is_active: boolean }).is_active === false);

  const nombre = await nombreDePrueba(admin, p.companyId, trial);
  const sufijo = `${trial.reference_code ? ` ${trial.reference_code}` : ""}${nombre ? ` · ${nombre}` : ""}`;
  const titulo = `Instalación prueba gratuita${sufijo}`;

  let installationId: string | null = null;
  if (moduloActivo) {
    const abierta = await instalacionAbiertaDePrueba(admin, p.companyId, trial.id);
    const campos = {
      status: "scheduled",
      scheduled_at: p.startsAt,
      installer_user_id: p.installerId,
      address_id: trial.installation_address_id,
      customer_id: trial.customer_id,
    };
    if (abierta) {
      const { error } = await admin
        .from("installations")
        .update(campos)
        .eq("id", abierta.id)
        .eq("company_id", p.companyId);
      if (error) throw error;
      installationId = abierta.id;
    } else {
      const ref = await siguienteReferencia(admin, p.companyId, "installations", "I");
      const { data: nueva, error } = await admin
        .from("installations")
        .insert({
          ...campos,
          company_id: p.companyId,
          kind: "free_trial",
          free_trial_id: trial.id,
          reference_code: ref,
          notes: "Instalación de prueba gratuita",
          created_by: p.actorId,
        })
        .select("id")
        .single();
      if (error) throw error;
      installationId = (nueva as { id: string }).id;
    }
  }

  if (installationId) {
    await citaDeInstalacion(admin, {
      companyId: p.companyId,
      installationId,
      trialId: trial.id,
      startsAt: p.startsAt,
      installerId: p.installerId,
      titulo,
      addressId: trial.installation_address_id,
      actorId: p.actorId,
    });
  } else {
    // Sin módulo de instalaciones: solo la cita de la prueba, como antes.
    const { data: previa } = await admin
      .from("agenda_events")
      .select("id")
      .eq("company_id", p.companyId)
      .eq("subject_type", "free_trial")
      .eq("subject_id", trial.id)
      .eq("kind", "installation")
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .limit(1);
    const id = ((previa ?? [])[0] as { id: string } | undefined)?.id;
    const cita = {
      starts_at: p.startsAt,
      ends_at: null,
      assigned_user_id: p.installerId,
      title: titulo,
      address_id: trial.installation_address_id,
    };
    const r = id
      ? await admin.from("agenda_events").update(cita).eq("id", id).eq("company_id", p.companyId)
      : await admin.from("agenda_events").insert({
          ...cita,
          company_id: p.companyId,
          kind: "installation",
          status: "scheduled",
          subject_type: "free_trial",
          subject_id: trial.id,
          created_by: p.actorId,
        });
    if (r.error) console.error("[instalacionPrueba] cita de agenda:", r.error.message);
  }
  return installationId;
}

/**
 * Se ha cambiado la fecha o el instalador desde /instalaciones o desde la
 * agenda: si la instalación es de una prueba, copia el cambio a la prueba
 * (y, si se pide, a la cita). No hace nada con instalaciones normales.
 */
export async function copiarCambioAPrueba(
  admin: Admin,
  p: {
    companyId: string;
    installationId: string;
    scheduledAt?: string | null;
    installerId?: string | null;
    moverCita?: boolean;
  },
): Promise<void> {
  try {
    const { data } = await admin
      .from("installations")
      .select("id, kind, free_trial_id, scheduled_at, installer_user_id")
      .eq("id", p.installationId)
      .eq("company_id", p.companyId)
      .maybeSingle();
    const inst = data as {
      kind: string;
      free_trial_id: string | null;
      scheduled_at: string | null;
      installer_user_id: string | null;
    } | null;
    if (!inst || inst.kind !== "free_trial" || !inst.free_trial_id) return;

    const cambios: Record<string, unknown> = {};
    if (p.scheduledAt !== undefined) {
      cambios.scheduled_at = p.scheduledAt;
      if (p.scheduledAt) cambios.status = "scheduled";
    }
    if (p.installerId !== undefined) cambios.assigned_installer_user_id = p.installerId;
    if (Object.keys(cambios).length > 0) {
      const { error } = await admin
        .from("free_trials")
        .update(cambios)
        .eq("id", inst.free_trial_id)
        .eq("company_id", p.companyId)
        .in("status", ["draft", "scheduled"]);
      if (error) console.error("[instalacionPrueba] copiar a la prueba:", error.message);
    }

    if (p.moverCita) {
      const citaCambios: Record<string, unknown> = {};
      if (p.scheduledAt) {
        citaCambios.starts_at = p.scheduledAt;
        citaCambios.ends_at = new Date(new Date(p.scheduledAt).getTime() + DOS_HORAS).toISOString();
      }
      if (p.installerId !== undefined) citaCambios.assigned_user_id = p.installerId;
      if (Object.keys(citaCambios).length > 0) {
        await admin
          .from("agenda_events")
          .update(citaCambios)
          .eq("company_id", p.companyId)
          .eq("subject_type", "installation")
          .eq("subject_id", p.installationId)
          .eq("status", "scheduled")
          .is("deleted_at", null);
      }
    }
  } catch (e) {
    console.error("[instalacionPrueba] copiarCambioAPrueba:", e);
  }
}

/**
 * Se ha movido la cita de una prueba en la agenda (subject free_trial, las
 * antiguas): copia la fecha o el instalador a la prueba y a su instalación.
 */
export async function copiarCitaAPrueba(
  admin: Admin,
  p: {
    companyId: string;
    trialId: string;
    scheduledAt?: string | null;
    installerId?: string | null;
  },
): Promise<void> {
  try {
    const cambios: Record<string, unknown> = {};
    if (p.scheduledAt !== undefined) cambios.scheduled_at = p.scheduledAt;
    if (p.installerId !== undefined) cambios.assigned_installer_user_id = p.installerId;
    if (Object.keys(cambios).length === 0) return;
    await admin
      .from("free_trials")
      .update(cambios)
      .eq("id", p.trialId)
      .eq("company_id", p.companyId)
      .in("status", ["draft", "scheduled"]);
    const abierta = await instalacionAbiertaDePrueba(admin, p.companyId, p.trialId);
    if (abierta) {
      const inst: Record<string, unknown> = {};
      if (p.scheduledAt !== undefined) inst.scheduled_at = p.scheduledAt;
      if (p.installerId !== undefined) inst.installer_user_id = p.installerId;
      await admin
        .from("installations")
        .update(inst)
        .eq("id", abierta.id)
        .eq("company_id", p.companyId);
    }
  } catch (e) {
    console.error("[instalacionPrueba] copiarCitaAPrueba:", e);
  }
}

/** La prueba se rechaza o se anula sin instalar: cancela su instalación y su cita. */
export async function cancelarInstalacionDePrueba(
  admin: Admin,
  companyId: string,
  trialId: string,
  motivo: string,
): Promise<void> {
  try {
    const abierta = await instalacionAbiertaDePrueba(admin, companyId, trialId);
    if (abierta) {
      await admin
        .from("installations")
        .update({ status: "cancelled", cancelled_reason: motivo })
        .eq("id", abierta.id)
        .eq("company_id", companyId);
      await admin
        .from("agenda_events")
        .update({ status: "cancelled" })
        .eq("company_id", companyId)
        .eq("subject_type", "installation")
        .eq("subject_id", abierta.id)
        .eq("status", "scheduled");
    }
    await admin
      .from("agenda_events")
      .update({ status: "cancelled" })
      .eq("company_id", companyId)
      .eq("subject_type", "free_trial")
      .eq("subject_id", trialId)
      .eq("kind", "installation")
      .eq("status", "scheduled");
  } catch (e) {
    console.error("[instalacionPrueba] cancelar:", e);
  }
}
