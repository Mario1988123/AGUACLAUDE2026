"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { decrementStock } from "@/modules/warehouses/stock-decrement";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const createSchema = z.object({
  customer_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  installation_address_id: z.string().uuid().optional(),
  duration_days: z.number().int().positive().default(30),
  conditions_text: z.string().optional(),
  scheduled_at: z.string().optional(),
  assigned_installer_user_id: z.string().uuid().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        product_name_snapshot: z.string(),
        quantity: z.number().int().positive().default(1),
      }),
    )
    .min(1),
});

export interface FreeTrialRow {
  id: string;
  reference_code: string | null;
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  scheduled_at: string | null;
  installed_at: string | null;
  expires_at: string | null;
  decided_outcome: string | null;
  duration_days: number;
  conditions_signed: boolean;
  notes: string | null;
  created_at: string;
}

export async function listFreeTrials(): Promise<FreeTrialRow[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let query = supabase
    .from("free_trials")
    .select(
      "id, reference_code, status, customer_id, lead_id, scheduled_at, installed_at, expires_at, decided_outcome, duration_days, conditions_signed, notes, created_at, assigned_installer_user_id, created_by",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  // Scope: nivel 3 ve solo las suyas (creadas por él o instalador asignado);
  // nivel 2 ve las de su equipo; nivel 1 ve todas.
  if (visibleUserIds) {
    const ids = visibleUserIds.map((u) => `"${u}"`).join(",");
    query = query.or(
      `created_by.in.(${ids}),assigned_installer_user_id.in.(${ids})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FreeTrialRow[];
}

export async function getFreeTrial(id: string): Promise<FreeTrialRow & { items: Array<{ id: string; product_id: string; product_name_snapshot: string; quantity: number; serial_number: string | null }> }> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const cols =
    "id, reference_code, status, customer_id, lead_id, installation_address_id, scheduled_at, installed_at, expires_at, decided_at, decided_outcome, removed_at, rejected_reason, generated_contract_id, duration_days, conditions_text, conditions_signed, assigned_installer_user_id, notes, created_at, is_provisional_install";
  const colsLegacy =
    "id, reference_code, status, customer_id, lead_id, installation_address_id, scheduled_at, installed_at, expires_at, decided_at, decided_outcome, removed_at, rejected_reason, generated_contract_id, duration_days, conditions_text, conditions_signed, assigned_installer_user_id, notes, created_at";
  let trialRes = await supabase
    .from("free_trials")
    .select(cols)
    .eq("id", id)
    .single();
  if (
    trialRes.error &&
    /is_provisional_install/i.test(trialRes.error.message ?? "")
  ) {
    trialRes = await supabase
      .from("free_trials")
      .select(colsLegacy)
      .eq("id", id)
      .single();
  }
  if (trialRes.error) throw trialRes.error;
  const { data: items } = await supabase
    .from("free_trial_items")
    .select("id, product_id, product_name_snapshot, quantity, serial_number")
    .eq("free_trial_id", id);
  return { ...(trialRes.data as FreeTrialRow), items: (items ?? []) } as never;
}

export async function createFreeTrialAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(createSchema, input, "Prueba gratuita");
  if (!parsed.customer_id && !parsed.lead_id) {
    throw new Error("Debe especificarse cliente o lead");
  }
  if (parsed.customer_id && parsed.lead_id) {
    throw new Error("Solo cliente o lead, no ambos");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: created, error } = await supabase
    .from("free_trials")
    .insert({
      company_id: session.company_id,
      customer_id: parsed.customer_id ?? null,
      lead_id: parsed.lead_id ?? null,
      installation_address_id: parsed.installation_address_id ?? null,
      status: parsed.scheduled_at ? "scheduled" : "draft",
      duration_days: parsed.duration_days,
      conditions_text: parsed.conditions_text ?? null,
      scheduled_at: parsed.scheduled_at ?? null,
      assigned_installer_user_id: parsed.assigned_installer_user_id ?? null,
      notes: parsed.notes ?? null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (created as { id: string }).id;

  await supabase.from("free_trial_items").insert(
    parsed.items.map((it) => ({
      free_trial_id: id,
      company_id: session.company_id,
      product_id: it.product_id,
      product_name_snapshot: it.product_name_snapshot,
      quantity: it.quantity,
    })),
  );

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.created",
    payload: { items: parsed.items.length },
    actor_user_id: session.user_id,
  });

  revalidatePath("/pruebas-gratuitas");
  return id;
}

export async function installFreeTrialAction(
  id: string,
  options?: { is_provisional?: boolean },
) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const { data: trial } = await supabase
    .from("free_trials")
    .select(
      "id, duration_days, status, assigned_installer_user_id, customer_id, lead_id, installation_address_id",
    )
    .eq("id", id)
    .single();
  if (!trial) throw new Error("No encontrada");
  const t = trial as {
    duration_days: number;
    status: string;
    assigned_installer_user_id: string | null;
    customer_id: string | null;
    lead_id: string | null;
    installation_address_id: string | null;
  };
  if (t.status === "installed" || t.status === "accepted") {
    throw new Error("Ya instalada");
  }
  const expires = new Date(now);
  expires.setDate(expires.getDate() + t.duration_days);

  // Admin client: la policy ft_update sólo permite UPDATE si status NOT IN
  // (accepted, rejected, expired, removed). Si el cron auto-expiró la
  // prueba ANTES de que el técnico marcara como instalada → silent fail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const updatePayload: Record<string, unknown> = {
    status: "installed",
    installed_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
  if (options?.is_provisional !== undefined) {
    updatePayload.is_provisional_install = options.is_provisional;
  }
  let r = await admin.from("free_trials").update(updatePayload).eq("id", id);
  // Defensa: si la columna is_provisional_install no existe (migración no
  // aplicada), reintentar sin ella.
  if (r.error && /is_provisional_install/i.test(r.error.message ?? "")) {
    delete updatePayload.is_provisional_install;
    r = await admin.from("free_trials").update(updatePayload).eq("id", id);
  }
  if (r.error) throw new Error(r.error.message);
  const installerId = t.assigned_installer_user_id;
  let warehouseId: string | null = null;
  if (installerId) {
    const { data: wh } = await admin
      .from("warehouses")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("assigned_user_id", installerId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    warehouseId = (wh as { id: string } | null)?.id ?? null;
  }
  if (!warehouseId) {
    const { data: wh } = await admin
      .from("warehouses")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("kind", "main")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    warehouseId = (wh as { id: string } | null)?.id ?? null;
  }
  if (warehouseId) {
    const { data: items } = await admin
      .from("free_trial_items")
      .select("product_id, quantity")
      .eq("free_trial_id", id);
    for (const it of ((items ?? []) as Array<{ product_id: string; quantity: number }>)) {
      try {
        await decrementStock({
          company_id: session.company_id,
          warehouse_id: warehouseId,
          product_id: it.product_id,
          quantity: it.quantity,
          movement_type: "outbound_trial",
          free_trial_id: id,
          performed_by: session.user_id,
          notes: "Salida prueba gratuita",
        });
      } catch {
        /* no-op */
      }
    }
  }

  // Crear installation kind='free_trial' status='completed' enlazada
  // a la prueba (installations.free_trial_id existe en schema). Con
  // customer_id si lo conocemos. Esto permite que aparezca en
  // /instalaciones, en el timeline y se enlace al contrato al aceptar.
  let createdInstallationId: string | null = null;
  try {
    const year = now.getFullYear();
    const yearPrefix = `I-${year}-`;
    const { data: lastCoded } = await admin
      .from("installations")
      .select("reference_code")
      .eq("company_id", session.company_id)
      .like("reference_code", `${yearPrefix}%`)
      .order("reference_code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const lastCode = (lastCoded as { reference_code: string | null } | null)?.reference_code;
    if (lastCode) {
      const m = lastCode.match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1]!, 10) + 1;
    }
    const refCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;
    const { data: inst, error: instErr } = await admin
      .from("installations")
      .insert({
        company_id: session.company_id,
        kind: "free_trial",
        status: "completed",
        reference_code: refCode,
        customer_id: t.customer_id,
        free_trial_id: id,
        address_id: t.installation_address_id,
        installer_user_id: installerId,
        scheduled_at: now.toISOString(),
        started_at: now.toISOString(),
        completed_at: now.toISOString(),
        notes: "Instalación de prueba gratuita",
      })
      .select("id")
      .single();
    if (!instErr && inst) {
      createdInstallationId = (inst as { id: string }).id;
      // installation_items
      const { data: ftItems } = await admin
        .from("free_trial_items")
        .select("product_id, quantity, serial_number")
        .eq("free_trial_id", id);
      const ftList = ((ftItems ?? []) as Array<{
        product_id: string;
        quantity: number;
        serial_number: string | null;
      }>);
      if (ftList.length > 0) {
        await admin.from("installation_items").insert(
          ftList.map((it) => ({
            installation_id: createdInstallationId,
            company_id: session.company_id,
            product_id: it.product_id,
            quantity: it.quantity,
            serial_number: it.serial_number,
          })),
        );

        // customer_equipment SOLO si la prueba ya tiene customer_id.
        // Si es lead, se crearán al aceptar (acceptFreeTrialAction).
        if (t.customer_id) {
          await admin.from("customer_equipment").insert(
            ftList.map((it) => ({
              company_id: session.company_id,
              customer_id: t.customer_id,
              product_id: it.product_id,
              installation_id: createdInstallationId,
              address_id: t.installation_address_id,
              serial_number: it.serial_number,
              installed_at: now.toISOString().slice(0, 10),
              notes: "Equipo en prueba gratuita",
            })),
          );
        }
      }
    }
  } catch (e) {
    console.error("[installFreeTrial] installation create:", e);
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.installed",
    payload: {
      expires_at: expires.toISOString(),
      installation_id: createdInstallationId,
    },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/pruebas-gratuitas/${id}`);
  revalidatePath("/pruebas-gratuitas");
  if (t.customer_id) revalidatePath(`/clientes/${t.customer_id}`);
}

/**
 * Firma + instala una prueba gratuita en un solo paso. Recibe firmas en
 * data URL (PNG base64), las sube al bucket privado free-trial-signatures
 * y guarda los paths en free_trials. Después delega en installFreeTrialAction
 * para el resto del flujo (decremento stock, crear installation, etc.).
 *
 * scheduled_for: si null, instala AHORA (now). Si es una fecha futura,
 * solo deja la prueba como 'scheduled' con scheduled_at — el técnico
 * marcará "Instalada" cuando llegue el día.
 */
export async function signAndInstallFreeTrialAction(input: {
  trial_id: string;
  is_provisional: boolean;
  scheduled_for: string | null;
  customer_signer_name: string;
  customer_signer_tax_id?: string | null;
  customer_signature_data_url: string;
  representative_signature_data_url: string;
}): Promise<{ ok: true; status: "scheduled" | "installed" }> {
  try {
    return await _signAndInstallFreeTrialAction(input);
  } catch (err) {
    console.error(
      "[signAndInstallFreeTrial] FAILED:",
      err instanceof Error ? err.message : err,
      err instanceof Error ? err.stack : undefined,
    );
    throw err;
  }
}

async function _signAndInstallFreeTrialAction(input: {
  trial_id: string;
  is_provisional: boolean;
  scheduled_for: string | null;
  customer_signer_name: string;
  customer_signer_tax_id?: string | null;
  customer_signature_data_url: string;
  representative_signature_data_url: string;
}): Promise<{ ok: true; status: "scheduled" | "installed" }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  if (!input.customer_signer_name?.trim())
    throw new Error("Falta el nombre del firmante");
  if (!input.customer_signature_data_url?.startsWith("data:image/"))
    throw new Error("Falta la firma del cliente");
  if (!input.representative_signature_data_url?.startsWith("data:image/"))
    throw new Error("Falta la firma del comercial");

  const { ensureBucket } = await import("@/shared/lib/supabase/storage-buckets");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const BUCKET = "free-trial-signatures";
  const ok = await ensureBucket(admin, BUCKET);
  if (!ok) throw new Error("No se pudo preparar el bucket de firmas");

  function dataUrlToBuffer(dataUrl: string): Buffer {
    const base64 = dataUrl.split(",")[1] ?? "";
    return Buffer.from(base64, "base64");
  }
  const ts = Date.now();
  const customerPath = `${session.company_id}/${input.trial_id}/customer-${ts}.png`;
  const repPath = `${session.company_id}/${input.trial_id}/representative-${ts}.png`;
  const upCust = await admin.storage.from(BUCKET).upload(
    customerPath,
    dataUrlToBuffer(input.customer_signature_data_url),
    { contentType: "image/png", upsert: false, cacheControl: "3600" },
  );
  if (upCust.error) throw new Error(`Firma cliente: ${upCust.error.message}`);
  const upRep = await admin.storage.from(BUCKET).upload(
    repPath,
    dataUrlToBuffer(input.representative_signature_data_url),
    { contentType: "image/png", upsert: false, cacheControl: "3600" },
  );
  if (upRep.error) throw new Error(`Firma comercial: ${upRep.error.message}`);

  // Guardar metadata de firmas + flag de instalación provisional / definitiva
  const nowIso = new Date().toISOString();
  const metaPayload: Record<string, unknown> = {
    customer_signature_path: customerPath,
    customer_signer_name: input.customer_signer_name.trim(),
    customer_signer_tax_id: input.customer_signer_tax_id?.trim() || null,
    customer_signed_at: nowIso,
    representative_signature_path: repPath,
    representative_user_id: session.user_id,
    representative_signed_at: nowIso,
    conditions_signed: true,
    is_provisional_install: input.is_provisional,
  };
  if (input.scheduled_for) {
    metaPayload.scheduled_at = input.scheduled_for;
    metaPayload.status = "scheduled";
  }
  // UPDATE defensivo. PostgREST puede tener cache obsoleto y rechazar
  // alguna columna añadida en migración tardía con "Could not find the
  // 'X' column in the schema cache". En ese caso quitamos esa columna
  // y reintentamos hasta que pase o queden solo las columnas core. Así
  // al menos las firmas quedan en storage y el flag de status avanza.
  const OPTIONAL_COLS = [
    "is_provisional_install",
    "customer_signature_path",
    "customer_signer_name",
    "customer_signer_tax_id",
    "customer_signed_at",
    "representative_signature_path",
    "representative_user_id",
    "representative_signed_at",
    "conditions_signed",
  ];
  let upd = await admin
    .from("free_trials")
    .update(metaPayload)
    .eq("id", input.trial_id);
  while (upd.error) {
    const msg = upd.error.message ?? "";
    // Coincide tanto "column X of free_trials" como "Could not find the 'X' column"
    const m = msg.match(/(?:'|"|column\s+)([a-z_]+)(?:'|"|\s)/i);
    const offending = m?.[1];
    if (offending && OPTIONAL_COLS.includes(offending) && offending in metaPayload) {
      console.warn(
        "[signAndInstallFreeTrial] columna no en schema cache, reintento sin",
        offending,
      );
      delete metaPayload[offending];
      upd = await admin
        .from("free_trials")
        .update(metaPayload)
        .eq("id", input.trial_id);
      continue;
    }
    console.error(
      "[signAndInstallFreeTrial] UPDATE free_trials failed:",
      msg,
      "payload keys:",
      Object.keys(metaPayload).join(","),
    );
    throw new Error(msg);
  }

  // Si es para instalar ahora → ejecutamos installFreeTrialAction
  if (!input.scheduled_for) {
    await installFreeTrialAction(input.trial_id, {
      is_provisional: input.is_provisional,
    });
    revalidatePath(`/pruebas-gratuitas/${input.trial_id}`);
    return { ok: true, status: "installed" };
  }
  revalidatePath(`/pruebas-gratuitas/${input.trial_id}`);
  return { ok: true, status: "scheduled" };
}

/**
 * Convierte una prueba aceptada en cliente + contrato real.
 * Si la prueba estaba enlazada a un lead, lo convierte primero a customer.
 * El contrato se crea en estado 'draft' para que el comercial complete
 * planes y precios desde /contratos/[id]. La instalación, si ya estaba
 * hecha, se enlaza al nuevo contract_id.
 *
 * Devuelve { contract_id, customer_id }.
 */
export async function acceptFreeTrialAction(input: {
  trial_id: string;
  // Plan tentativo (el comercial puede cambiarlo desde la ficha del contrato)
  plan_type?: "cash" | "rental" | "renting";
  monthly_cents?: number | null;
  total_cents?: number | null;
  duration_months?: number | null;
}): Promise<
  { ok: true; contract_id: string; customer_id: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Cargar prueba
    const { data: trialRow } = await admin
      .from("free_trials")
      .select(
        "id, company_id, customer_id, lead_id, installation_address_id, status, generated_contract_id",
      )
      .eq("id", input.trial_id)
      .maybeSingle();
    const trial = trialRow as
      | {
          id: string;
          company_id: string;
          customer_id: string | null;
          lead_id: string | null;
          installation_address_id: string | null;
          status: string;
          generated_contract_id: string | null;
        }
      | null;
    if (!trial) return { ok: false, error: "Prueba no encontrada" };
    if (trial.company_id !== session.company_id) {
      return { ok: false, error: "Otra empresa" };
    }
    if (trial.status === "accepted" && trial.generated_contract_id) {
      return {
        ok: true,
        contract_id: trial.generated_contract_id,
        customer_id: trial.customer_id ?? "",
      };
    }
    if (!["installed", "scheduled", "draft"].includes(trial.status)) {
      return {
        ok: false,
        error: `No se puede aceptar una prueba en estado "${trial.status}"`,
      };
    }

    // 2) Si era lead, convertirlo a cliente
    let customerId = trial.customer_id;
    if (!customerId && trial.lead_id) {
      const { data: lead } = await admin
        .from("leads")
        .select(
          "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, phone_company, tax_id, notes, assigned_user_id",
        )
        .eq("id", trial.lead_id)
        .maybeSingle();
      if (!lead) return { ok: false, error: "Lead origen no encontrado" };
      const l = lead as {
        id: string;
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone_primary: string | null;
        phone_company: string | null;
        tax_id: string | null;
        notes: string | null;
        assigned_user_id: string | null;
      };
      const { data: createdCust, error: cErr } = await admin
        .from("customers")
        .insert({
          company_id: session.company_id,
          party_kind: l.party_kind,
          legal_name: l.legal_name,
          trade_name: l.trade_name,
          first_name: l.first_name,
          last_name: l.last_name,
          email: l.email,
          phone_primary: l.phone_primary,
          phone_company: l.phone_company,
          tax_id: l.tax_id,
          notes: l.notes,
          assigned_user_id: l.assigned_user_id,
          source_lead_id: l.id,
          is_active: true,
        })
        .select("id")
        .single();
      if (cErr) return { ok: false, error: `No se pudo crear cliente: ${cErr.message}` };
      customerId = (createdCust as { id: string }).id;
      // Marcar lead convertido y soft-delete (mismo flow que markContractSigned)
      await admin
        .from("leads")
        .update({
          status: "converted",
          deleted_at: new Date().toISOString(),
        })
        .eq("id", l.id);
    }
    if (!customerId) return { ok: false, error: "Prueba sin cliente ni lead" };

    // 3) Reference code C-YYYY-NNNN
    const year = new Date().getFullYear();
    const yearPrefix = `C-${year}-`;
    const { data: lastCoded } = await admin
      .from("contracts")
      .select("reference_code")
      .eq("company_id", session.company_id)
      .like("reference_code", `${yearPrefix}%`)
      .order("reference_code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const lastCode = (lastCoded as { reference_code: string | null } | null)?.reference_code;
    if (lastCode) {
      const m = lastCode.match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1]!, 10) + 1;
    }
    const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

    // 3.5) Construir customer_snapshot inmutable para el contrato
    let customerSnapshot: Record<string, unknown> = {};
    try {
      const { data: cust } = await admin
        .from("customers")
        .select(
          "party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, tax_id",
        )
        .eq("id", customerId)
        .maybeSingle();
      if (cust) customerSnapshot = cust as Record<string, unknown>;
    } catch {
      /* fail-soft */
    }

    // 4) Crear contrato en draft con customer_snapshot
    const { data: createdContract, error: kErr } = await admin
      .from("contracts")
      .insert({
        company_id: session.company_id,
        customer_id: customerId,
        reference_code: referenceCode,
        status: "draft",
        plan_type: input.plan_type ?? "renting",
        monthly_cents: input.monthly_cents ?? null,
        total_cash_cents: input.total_cents ?? null,
        duration_months: input.duration_months ?? null,
        source_free_trial_id: trial.id,
        customer_snapshot: customerSnapshot,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (kErr) return { ok: false, error: `No se pudo crear contrato: ${kErr.message}` };
    const contractId = (createdContract as { id: string }).id;

    // 5) Copiar items de la prueba como contract_items con todos los
    // campos NOT NULL: product_name_snapshot, product_kind_snapshot,
    // unit_price_cents (lo cogemos del pricing plan o cost del producto).
    try {
      const { data: items } = await admin
        .from("free_trial_items")
        .select("product_id, quantity, product_name_snapshot")
        .eq("free_trial_id", trial.id);
      const list = ((items ?? []) as Array<{
        product_id: string;
        quantity: number;
        product_name_snapshot: string;
      }>);
      if (list.length > 0) {
        const productIds = list.map((it) => it.product_id);
        // Cargamos kind y precio de cada producto
        const { data: prods } = await admin
          .from("products")
          .select("id, kind, cost_cents")
          .in("id", productIds);
        const prodMap = new Map(
          ((prods ?? []) as Array<{
            id: string;
            kind: string;
            cost_cents: number | null;
          }>).map((p) => [p.id, p]),
        );
        // Precios cash actuales desde product_pricing_plans para el
        // unit_price_cents (si no hay, usamos cost_cents como fallback)
        const { data: plans } = await admin
          .from("product_pricing_plans")
          .select("product_id, total_price_cents")
          .in("product_id", productIds)
          .eq("plan_type", "cash")
          .eq("is_active", true);
        const priceMap = new Map(
          ((plans ?? []) as Array<{
            product_id: string;
            total_price_cents: number;
          }>).map((p) => [p.product_id, p.total_price_cents]),
        );

        const rows = list.map((it, idx) => {
          const p = prodMap.get(it.product_id);
          const unitPrice =
            priceMap.get(it.product_id) ?? p?.cost_cents ?? 0;
          return {
            contract_id: contractId,
            company_id: session.company_id,
            product_id: it.product_id,
            quantity: it.quantity,
            product_name_snapshot: it.product_name_snapshot,
            product_kind_snapshot: p?.kind ?? "equipment",
            unit_price_cents: unitPrice,
            installation_address_id: trial.installation_address_id,
            display_order: idx,
          };
        });
        const { error: ciErr } = await admin
          .from("contract_items")
          .insert(rows);
        if (ciErr) {
          console.error("[acceptFreeTrial] contract_items insert:", ciErr.message);
        }
      }
    } catch (e) {
      console.warn("[acceptFreeTrial] contract_items copy:", e);
    }

    // 6) Si ya hay installation enlazada (vía installations.free_trial_id),
    // la enlazamos también al nuevo contract_id Y al customer_id (que
    // puede no existir aún si la prueba era de un lead).
    try {
      await admin
        .from("installations")
        .update({ contract_id: contractId, customer_id: customerId })
        .eq("free_trial_id", trial.id);
    } catch {
      /* no-op */
    }

    // 7) Backfill customer_equipment para pruebas a lead: ahora que el
    // customer existe, creamos los equipos del cliente apuntando a la
    // installation que se creó al instalar la prueba. Idempotente: si ya
    // existe (prueba a customer), no duplicamos.
    try {
      const { data: existingCE } = await admin
        .from("customer_equipment")
        .select("id")
        .eq("customer_id", customerId)
        .in(
          "installation_id",
          [
            ...(
              (await admin
                .from("installations")
                .select("id")
                .eq("free_trial_id", trial.id)
                .then((r: { data: Array<{ id: string }> | null }) => r.data ?? [])) as Array<{ id: string }>
            ).map((x) => x.id),
          ],
        );
      if (((existingCE ?? []) as Array<unknown>).length === 0) {
        const { data: instRow } = await admin
          .from("installations")
          .select("id, address_id")
          .eq("free_trial_id", trial.id)
          .maybeSingle();
        const inst = instRow as { id: string; address_id: string | null } | null;
        if (inst) {
          const { data: ftItems } = await admin
            .from("free_trial_items")
            .select("product_id, quantity, serial_number")
            .eq("free_trial_id", trial.id);
          const list = ((ftItems ?? []) as Array<{
            product_id: string;
            quantity: number;
            serial_number: string | null;
          }>);
          if (list.length > 0) {
            await admin.from("customer_equipment").insert(
              list.map((it) => ({
                company_id: session.company_id,
                customer_id: customerId,
                product_id: it.product_id,
                installation_id: inst.id,
                address_id: inst.address_id ?? trial.installation_address_id,
                serial_number: it.serial_number,
                installed_at: new Date().toISOString().slice(0, 10),
                notes: "Equipo de prueba gratuita aceptada",
              })),
            );
          }
        }
      }
    } catch (e) {
      console.warn("[acceptFreeTrial] customer_equipment backfill:", e);
    }

    // 7) Marcar la prueba aceptada
    await admin
      .from("free_trials")
      .update({
        status: "accepted",
        decided_at: new Date().toISOString(),
        decided_outcome: "accepted",
        generated_contract_id: contractId,
      })
      .eq("id", trial.id);

    // 8) Eventos
    try {
      await admin.from("events").insert([
        {
          company_id: session.company_id,
          subject_type: "free_trial",
          subject_id: trial.id,
          kind: "free_trial.accepted",
          payload: { contract_id: contractId, customer_id: customerId },
          actor_user_id: session.user_id,
        },
        {
          company_id: session.company_id,
          subject_type: "contract",
          subject_id: contractId,
          kind: "contract.created",
          payload: { from_free_trial_id: trial.id },
          actor_user_id: session.user_id,
        },
      ]);
    } catch {
      /* no-op */
    }

    revalidatePath(`/pruebas-gratuitas/${trial.id}`);
    revalidatePath(`/contratos/${contractId}`);
    revalidatePath(`/clientes/${customerId}`);
    return { ok: true, contract_id: contractId, customer_id: customerId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function rejectFreeTrialAction(id: string, reason: string) {
  const session = await requireSession();
  // Admin client: la policy ft_update bloquea si ya está
  // accepted/rejected/expired/removed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("free_trials")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_outcome: "rejected",
      rejected_reason: reason,
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.rejected",
    payload: { reason },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/pruebas-gratuitas/${id}`);
  revalidatePath("/pruebas-gratuitas");
}

export async function markReturnedAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const r = await admin
    .from("free_trials")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);

  // Re-incorporar stock como 'used' al almacén main
  const { data: wh } = await admin
    .from("warehouses")
    .select("id")
    .eq("company_id", session.company_id)
    .eq("kind", "main")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const warehouseId = (wh as { id: string } | null)?.id ?? null;
  if (warehouseId) {
    const { data: items } = await admin
      .from("free_trial_items")
      .select("product_id, quantity")
      .eq("free_trial_id", id);
    for (const it of ((items ?? []) as Array<{ product_id: string; quantity: number }>)) {
      const { data: existing } = await admin
        .from("warehouse_stock")
        .select("id, quantity")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", it.product_id)
        .eq("state", "used")
        .is("location_id", null)
        .maybeSingle();
      const ex = existing as { id: string; quantity: number } | null;
      if (ex) {
        await admin
          .from("warehouse_stock")
          .update({ quantity: ex.quantity + it.quantity, updated_at: new Date().toISOString() })
          .eq("id", ex.id);
      } else {
        await admin.from("warehouse_stock").insert({
          warehouse_id: warehouseId,
          product_id: it.product_id,
          company_id: session.company_id,
          quantity: it.quantity,
          state: "used",
        });
      }
      await admin.from("stock_movements").insert({
        company_id: session.company_id,
        product_id: it.product_id,
        warehouse_id: warehouseId,
        movement_type: "return",
        quantity: it.quantity,
        free_trial_id: id,
        performed_by: session.user_id,
        notes: "Devolución prueba gratuita",
        state_after: "used",
      });
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "free_trial",
    subject_id: id,
    kind: "free_trial.returned",
    payload: {},
    actor_user_id: session.user_id,
  });
  revalidatePath(`/pruebas-gratuitas/${id}`);
  revalidatePath("/pruebas-gratuitas");
}
