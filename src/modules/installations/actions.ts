"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  installationCreateFromContractSchema,
  installationUpdateSchema,
  startInstallationSchema,
  installationStepSchema,
  completeInstallationSchema,
} from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { notifyInstallationCompleted } from "@/modules/notifications/notifier";
import { awardPoints, getPointsSettings } from "@/modules/points/award";
import { autoScheduleMaintenanceForContract } from "@/modules/maintenance/auto-schedule";
import { decrementStockForInstallation } from "@/modules/warehouses/stock-decrement";

/**
 * Reasigna instalador. Solo admin/director técnico.
 */
export async function reassignInstallationAction(
  installationId: string,
  installerUserId: string | null,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // Reasignación restringida a admin de empresa (decisión usuario):
  // los directores técnicos ya no pueden reasignar instalaciones.
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");
  if (!isAdmin) throw new Error("Solo el admin de empresa puede reasignar");

  // Admin client + verificación. Antes el UPDATE silenciaba si la policy
  // inst_update bloqueaba por scope.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("installations")
    .update({ installer_user_id: installerUserId })
    .eq("id", installationId);
  if (r.error) throw new Error(r.error.message);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: installationId,
    kind: "installation.reassigned",
    payload: { to_user_id: installerUserId },
    actor_user_id: session.user_id,
  });

  // Notificar al nuevo instalador
  if (installerUserId) {
    try {
      const { notify } = await import("@/modules/notifications/notifier");
      await notify({
        company_id: session.company_id,
        recipient_user_id: installerUserId,
        kind: "installation.assigned",
        severity: "info",
        title: "Instalación asignada",
        body: "Te han asignado una instalación. Revisa /instalaciones.",
        subject_type: "installation",
        subject_id: installationId,
        action_url: `/instalaciones/${installationId}`,
      });
    } catch {
      /* no-op */
    }
  }

  revalidatePath(`/instalaciones/${installationId}`);
  revalidatePath("/instalaciones");
}

export interface InstallationRow {
  id: string;
  reference_code: string | null;
  status: string;
  kind: string;
  installer_user_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  contract_id: string | null;
  address_id: string | null;
}

export async function listInstallations(filters?: {
  installer_user_id?: string;
  status?: string;
}): Promise<InstallationRow[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let query = supabase
    .from("installations")
    .select(
      "id, reference_code, status, kind, installer_user_id, customer_id, scheduled_at, started_at, completed_at, created_at, contract_id, address_id",
    )
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(200);

  const isLevel1 =
    session.is_superadmin || session.roles.includes("company_admin");
  const isTechDirector = session.roles.includes("technical_director");
  const isInstaller = session.roles.includes("installer");

  // Comercial / telemarketer NO acceden al módulo de instalaciones.
  // Si llega por URL directa devolvemos vacío (la página les redirige
  // al dashboard si quieren).
  if (!isLevel1 && !isTechDirector && !isInstaller) {
    return [];
  }

  // Nivel 3 instalador → solo sus instalaciones activas.
  if (isInstaller && !isLevel1 && !isTechDirector) {
    query = query
      .eq("installer_user_id", session.user_id)
      .not("status", "in", "(completed,cancelled)");
  } else if (filters?.installer_user_id) {
    query = query.eq("installer_user_id", filters.installer_user_id);
  }
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<Omit<InstallationRow, "customer_name">>;
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
  );
  let nameMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
    type CC = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    };
    nameMap = new Map(
      ((cs ?? []) as CC[]).map((c) => [
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Sin nombre"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
      ]),
    );
  }
  return rows.map((r) => ({
    ...r,
    customer_name: r.customer_id ? nameMap.get(r.customer_id) ?? null : null,
  }));
}

/**
 * Lista instalaciones sin agendar (scheduled_at IS NULL) que no están
 * canceladas/completadas. Se usa en /agenda para mostrar todo lo pendiente
 * de programar y en el dashboard del director técnico.
 */
export async function listUnscheduledInstallations(): Promise<InstallationRow[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const isLevel1 =
    session.is_superadmin || session.roles.includes("company_admin");
  const isTechDirector = session.roles.includes("technical_director");
  if (!isLevel1 && !isTechDirector) return [];

  const { data, error } = await supabase
    .from("installations")
    .select(
      "id, reference_code, status, kind, installer_user_id, customer_id, scheduled_at, started_at, completed_at, created_at, contract_id, address_id",
    )
    .is("deleted_at", null)
    .is("scheduled_at", null)
    .not("status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  const rows = (data ?? []) as Array<Omit<InstallationRow, "customer_name">>;
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
  );
  let nameMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
    type CC = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    };
    nameMap = new Map(
      ((cs ?? []) as CC[]).map((c) => [
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Sin nombre"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
      ]),
    );
  }
  return rows.map((r) => ({
    ...r,
    customer_name: r.customer_id ? nameMap.get(r.customer_id) ?? null : null,
  }));
}

export async function getInstallation(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("installations")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  const inst = data as Record<string, unknown> & {
    id: string;
    company_id?: string;
    reference_code?: string | null;
    created_at: string;
  };
  // Backfill I-YYYY-NNNN si no tiene código
  if (!inst.reference_code && inst.company_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const year = new Date(inst.created_at).getFullYear();
      const yearPrefix = `I-${year}-`;
      const { data: last } = await admin
        .from("installations")
        .select("reference_code")
        .eq("company_id", inst.company_id)
        .like("reference_code", `${yearPrefix}%`)
        .order("reference_code", { ascending: false })
        .limit(1)
        .maybeSingle();
      let n = 1;
      const lastCode = (last as { reference_code: string | null } | null)?.reference_code;
      if (lastCode) {
        const m = lastCode.match(/-(\d+)$/);
        if (m) n = parseInt(m[1]!, 10) + 1;
      }
      const code = `${yearPrefix}${String(n).padStart(4, "0")}`;
      await admin.from("installations").update({ reference_code: code }).eq("id", id);
      inst.reference_code = code;
    } catch {
      /* fail-soft */
    }
  }
  return inst;
}

export async function getInstallationItems(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installation_items")
    .select("id, product_id, quantity, serial_number, notes")
    .eq("installation_id", installationId);
  type Row = {
    id: string;
    product_id: string;
    quantity: number;
    serial_number: string | null;
    notes: string | null;
  };
  const rows = (data ?? []) as Row[];
  // Resolver nombres reales de los productos (antes mostrábamos los 8
  // primeros chars del UUID — confuso para el técnico que esperaba ver
  // "Senda" o "Brisa").
  let nameMap = new Map<string, string>();
  if (rows.length > 0) {
    const ids = Array.from(new Set(rows.map((r) => r.product_id)));
    const { data: prods } = await supabase
      .from("products")
      .select("id, name")
      .in("id", ids);
    nameMap = new Map(
      ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
    );
  }
  return rows.map((r) => ({
    ...r,
    product_name: nameMap.get(r.product_id) ?? "Producto sin nombre",
  })) as Array<Row & { product_name: string }>;
}

export async function getInstallationPhotos(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installation_photos")
    .select("id, storage_path, category, caption, taken_at")
    .eq("installation_id", installationId)
    .order("taken_at");
  return (data ?? []) as Array<{
    id: string;
    storage_path: string;
    category: string;
    caption: string | null;
    taken_at: string;
  }>;
}

export async function getInstallationSignatures(installationId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installation_signatures")
    .select("id, signer_role, signer_name, context, signed_at")
    .eq("installation_id", installationId)
    .order("signed_at");
  return (data ?? []) as Array<{
    id: string;
    signer_role: string;
    signer_name: string;
    context: string | null;
    signed_at: string;
  }>;
}

/**
 * Crea instalación a partir de un contrato firmado/activo.
 * Copia items del contrato y deja en estado unscheduled.
 */
export async function createInstallationFromContract(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");

  // Guard: solo niveles 1-2 (admin/director técnico) pueden crear/programar
  // instalaciones manualmente. El comercial NO. La instalación se crea
  // automáticamente al firmar contrato.
  const isAuthorized =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!isAuthorized) {
    throw new Error(
      "Solo el admin o director técnico puede generar/programar instalaciones",
    );
  }

  const parsed = parseOrFriendly(installationCreateFromContractSchema, input, "Instalación");

  // Admin client: la policy installations_insert tiene scope que puede
  // bloquear según rol. Como ya hemos validado los permisos arriba,
  // usamos admin para evitar silent fail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: contract } = await admin
    .from("contracts")
    .select("id, status, customer_id, company_id")
    .eq("id", parsed.contract_id)
    .single();
  if (!contract) throw new Error("Contrato no encontrado");
  const c = contract as {
    id: string;
    status: string;
    customer_id: string;
    company_id: string;
  };
  if (c.company_id !== session.company_id) {
    throw new Error("Contrato de otra empresa");
  }
  if (!["signed", "active"].includes(c.status)) {
    throw new Error("El contrato debe estar firmado o activo");
  }

  // Verificar que no hay ya instalación para este contrato
  const { count } = await admin
    .from("installations")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", parsed.contract_id)
    .is("deleted_at", null);
  if ((count ?? 0) > 0) throw new Error("Ya existe una instalación para este contrato");

  // Generar reference_code I-YYYY-NNNN
  const year = new Date().getFullYear();
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
  const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

  const { data: created, error } = await admin
    .from("installations")
    .insert({
      company_id: session.company_id,
      kind: "normal",
      status: parsed.scheduled_at ? "scheduled" : "unscheduled",
      contract_id: c.id,
      customer_id: c.customer_id,
      reference_code: referenceCode,
      scheduled_at: parsed.scheduled_at || null,
      installer_user_id: parsed.installer_user_id || null,
      source_warehouse_id: parsed.source_warehouse_id || null,
      assigned_at: parsed.installer_user_id ? new Date().toISOString() : null,
      assigned_by: parsed.installer_user_id ? session.user_id : null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[createInstallationFromContract] insert failed:", error.message);
    throw new Error(`No se pudo crear la instalación: ${error.message}`);
  }
  const installationId = (created as { id: string }).id;

  // Copiar items del contrato
  const { data: items } = await admin
    .from("contract_items")
    .select("product_id, quantity, display_order, notes")
    .eq("contract_id", c.id);
  type CI = { product_id: string; quantity: number; display_order: number; notes: string | null };
  const list = (items ?? []) as CI[];
  if (list.length > 0) {
    await admin.from("installation_items").insert(
      list.map((it) => ({
        installation_id: installationId,
        company_id: session.company_id,
        product_id: it.product_id,
        quantity: it.quantity,
        display_order: it.display_order,
        notes: it.notes,
      })),
    );
  }

  // Si tiene scheduled_at + installer, crear evento agenda
  if (parsed.scheduled_at && parsed.installer_user_id) {
    await admin.from("agenda_events").insert({
      company_id: session.company_id,
      kind: "installation",
      status: "scheduled",
      title: "Instalación programada",
      starts_at: parsed.scheduled_at,
      assigned_user_id: parsed.installer_user_id,
      subject_type: "installation",
      subject_id: installationId,
      created_by: session.user_id,
    });
  }

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "installation",
    subject_id: installationId,
    kind: "installation.scheduled",
    payload: { contract_id: c.id, scheduled_at: parsed.scheduled_at || null },
    actor_user_id: session.user_id,
  });

  // Si se crea ya programada (fecha + installer), comprobar stock y
  // avisar a admin/director técnico si falta material.
  if (parsed.scheduled_at && parsed.installer_user_id) {
    await checkStockAndNotifyIfShort(installationId);
  }

  revalidatePath("/instalaciones");
  revalidatePath(`/contratos/${c.id}`);
  redirect(`/instalaciones/${installationId}` as never);
}

/**
 * Devuelve por día cuántas instalaciones tiene programadas un instalador
 * (o el conjunto de instaladores si no se filtra). Usado por el calendario
 * de "Programar instalación" para mostrar disponibilidad antes de fijar
 * la fecha. Devuelve un mapa "YYYY-MM-DD" → count.
 */
export async function getInstallerAvailabilityAction(
  installerUserId: string | null,
  fromDate: string, // "YYYY-MM-DD"
  toDate: string, // "YYYY-MM-DD"
): Promise<Record<string, number>> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("installations")
    .select("scheduled_at, installer_user_id")
    .gte("scheduled_at", `${fromDate}T00:00:00`)
    .lte("scheduled_at", `${toDate}T23:59:59`)
    .not("status", "in", "(cancelled,completed)")
    .is("deleted_at", null);
  if (installerUserId) q = q.eq("installer_user_id", installerUserId);
  const { data } = await q;
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ scheduled_at: string }>) {
    const d = new Date(row.scheduled_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}

export async function updateInstallationAction(input: unknown) {
  const session = await requireSession();

  // Solo niveles 1-2 (admin / director técnico) pueden programar/editar.
  const isAuthorized =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!isAuthorized) {
    throw new Error(
      "Solo el admin o director técnico puede programar/editar instalaciones",
    );
  }

  const parsed = parseOrFriendly(installationUpdateSchema, input, "Instalación");
  // Admin client: la policy installations_update por scope puede bloquear.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const update: Record<string, unknown> = {};
  if (parsed.scheduled_at !== undefined) update.scheduled_at = parsed.scheduled_at || null;
  if (parsed.installer_user_id !== undefined) {
    update.installer_user_id = parsed.installer_user_id || null;
    update.assigned_at = parsed.installer_user_id ? new Date().toISOString() : null;
    update.assigned_by = parsed.installer_user_id ? session.user_id : null;
  }
  if (parsed.preferred_time_slot !== undefined)
    update.preferred_time_slot = parsed.preferred_time_slot || null;
  if (Object.keys(update).length === 0) return;
  if (update.scheduled_at && update.installer_user_id) update.status = "scheduled";

  const { error } = await admin.from("installations").update(update).eq("id", parsed.id);
  if (error) {
    console.error("[updateInstallation] update failed:", error.message);
    throw new Error(`No se pudo actualizar: ${error.message}`);
  }

  // Si pasó a estado scheduled (fecha + instalador), comprobar stock y
  // notificar a admin si falta material para esa instalación.
  if (update.status === "scheduled") {
    await checkStockAndNotifyIfShort(parsed.id);
  }

  revalidatePath(`/instalaciones/${parsed.id}`);
}

/**
 * Comprueba stock disponible para los items de la instalación. Si en
 * el almacén origen (o en cualquier almacén si no hay origen asignado)
 * falta material, notifica a admin y director técnico para que generen
 * orden de carga / pedido.
 *
 * No bloquea la programación — sólo avisa. Es informativo.
 */
/**
 * Wrapper público — nunca lanza. Si algo falla (tabla, bucket, permisos),
 * silenciamos para que el flujo de programación no se rompa por un
 * efecto secundario informativo.
 */
async function checkStockAndNotifyIfShort(installationId: string): Promise<void> {
  try {
    await checkStockAndNotifyIfShortInner(installationId);
  } catch {
    /* no-op */
  }
}

async function checkStockAndNotifyIfShortInner(installationId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: inst } = await admin
    .from("installations")
    .select(
      "id, company_id, reference_code, source_warehouse_id, scheduled_at, customer_id",
    )
    .eq("id", installationId)
    .single();
  const i = inst as
    | {
        id: string;
        company_id: string;
        reference_code: string | null;
        source_warehouse_id: string | null;
        scheduled_at: string | null;
        customer_id: string | null;
      }
    | null;
  if (!i) return;

  // Items requeridos
  const { data: items } = await admin
    .from("installation_items")
    .select("product_id, quantity")
    .eq("installation_id", installationId);
  type IT = { product_id: string; quantity: number };
  const list = (items ?? []) as IT[];
  if (list.length === 0) return;

  const productIds = Array.from(new Set(list.map((it) => it.product_id)));

  // Stock total (todos los almacenes activos) o sólo del origen si está asignado
  let stockQuery = admin
    .from("warehouse_stock")
    .select("product_id, quantity, warehouse_id")
    .in("product_id", productIds);
  if (i.source_warehouse_id) {
    stockQuery = stockQuery.eq("warehouse_id", i.source_warehouse_id);
  }
  const { data: stockRows } = await stockQuery;
  type SR = { product_id: string; quantity: number; warehouse_id: string };
  const stockMap = new Map<string, number>();
  for (const s of (stockRows ?? []) as SR[]) {
    stockMap.set(s.product_id, (stockMap.get(s.product_id) ?? 0) + (s.quantity ?? 0));
  }

  // Detectar shortages
  const shortages: Array<{ product_id: string; required: number; available: number }> = [];
  for (const it of list) {
    const have = stockMap.get(it.product_id) ?? 0;
    if (have < it.quantity) {
      shortages.push({
        product_id: it.product_id,
        required: it.quantity,
        available: have,
      });
    }
  }
  if (shortages.length === 0) return;

  // Resolver nombres de productos
  const { data: prods } = await admin
    .from("products")
    .select("id, name")
    .in(
      "id",
      shortages.map((s) => s.product_id),
    );
  const nameMap = new Map(
    ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );

  const lines = shortages.map(
    (s) =>
      `${nameMap.get(s.product_id) ?? s.product_id}: faltan ${s.required - s.available} (req ${s.required}, hay ${s.available})`,
  );
  const body = lines.join(" · ");

  // Event timeline
  await admin.from("events").insert({
    company_id: i.company_id,
    subject_type: "installation",
    subject_id: installationId,
    kind: "installation.stock_shortage",
    payload: { shortages, scheduled_at: i.scheduled_at, source_warehouse_id: i.source_warehouse_id },
    actor_user_id: null,
  });

  // Notificar a admin y director técnico
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(
      i.company_id,
      ["company_admin", "technical_director"],
      {
        kind: "installation.stock_shortage",
        severity: "warning",
        title: "⚠ Stock insuficiente para instalación programada",
        body: `${i.reference_code ?? "Instalación"}: ${body}`,
        subject_type: "installation",
        subject_id: installationId,
        action_url: `/instalaciones/${installationId}`,
      },
    );
  } catch {
    /* no-op */
  }
}

export async function startInstallation(input: unknown) {
  const session = await requireSession();
  const parsed = parseOrFriendly(startInstallationSchema, input, "Iniciar parte");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("installations")
    .update({
      status: "in_progress",
      started_at: now,
      geo_started_lat: parsed.geo_lat ?? null,
      geo_started_lng: parsed.geo_lng ?? null,
    })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  await supabase.from("installation_steps_log").insert({
    installation_id: parsed.id,
    company_id: session.company_id,
    event_type: "start",
    event_user_id: session.user_id,
    geo_latitude: parsed.geo_lat ?? null,
    geo_longitude: parsed.geo_lng ?? null,
  });

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "installation",
    subject_id: parsed.id,
    kind: "installation.started",
    payload: {},
    actor_user_id: session.user_id,
  });

  revalidatePath(`/instalaciones/${parsed.id}`);
}

export async function pauseInstallation(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("installations").update({ status: "paused" }).eq("id", id);
  // installation_steps_log fue dropeada en migración 20260507100000;
  // los eventos viven ahora en `events`. Los wizards ya escriben allí.
  revalidatePath(`/instalaciones/${id}`);
}

export async function resumeInstallation(id: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("installations").update({ status: "in_progress" }).eq("id", id);
  revalidatePath(`/instalaciones/${id}`);
}

export async function reportDamageOrDrilling(input: unknown) {
  await requireSession();
  const parsed = parseOrFriendly(installationStepSchema, input, "Estado parte");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const update: Record<string, unknown> = {};
  if (parsed.has_previous_damage !== undefined)
    update.has_previous_damage = parsed.has_previous_damage;
  if (parsed.needs_countertop_drilling !== undefined)
    update.needs_countertop_drilling = parsed.needs_countertop_drilling;
  if (Object.keys(update).length > 0) {
    await admin.from("installations").update(update).eq("id", parsed.installation_id);
  }
  // installation_steps_log dropeada — los wizards escriben en `events`.
  revalidatePath(`/instalaciones/${parsed.installation_id}`);
}

export async function completeInstallation(input: unknown) {
  const session = await requireSession();
  const parsed = parseOrFriendly(completeInstallationSchema, input, "Cerrar instalación");
  // Admin client para todo el flow: el instalador (nivel 3) tiene
  // policy installations_update por scope que solo cubre las suyas.
  // Las INSERT a customer_equipment, agenda_events, events también
  // pueden bloquear silentmente. Como ya validamos sesión arriba y
  // el SELECT inicial verifica que la installation existe, es seguro.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const nowIso = now.toISOString();

  // Calcular duración si tenemos started_at
  const { data: inst } = await admin
    .from("installations")
    .select("started_at, contract_id, customer_id, address_id, kind, notes")
    .eq("id", parsed.id)
    .single();
  const startTs = (inst as { started_at: string | null })?.started_at;
  const durationSec = startTs
    ? Math.floor((now.getTime() - new Date(startTs).getTime()) / 1000)
    : null;

  await admin
    .from("installations")
    .update({
      status: "completed",
      completed_at: nowIso,
      duration_seconds: durationSec,
      geo_completed_lat: parsed.geo_lat ?? null,
      geo_completed_lng: parsed.geo_lng ?? null,
      notes: parsed.notes ?? null,
    })
    .eq("id", parsed.id);
  // installation_steps_log dropeada — los wizards escriben en `events`.

  const i = inst as {
    contract_id: string | null;
    customer_id: string | null;
    address_id: string | null;
    kind: "normal" | "free_trial" | "relocation" | "uninstall";
    notes: string | null;
  };

  // ===== Fork por tipo =====
  if (i.kind === "uninstall") {
    // Devuelve stock al almacén destino y desactiva los equipos.
    try {
      const mod = await import("@/modules/customers/uninstall-actions");
      await mod.processUninstallCompletion(parsed.id);
    } catch (e) {
      console.error("[completeInstallation] uninstall flow:", e);
    }
    // No tocamos contratos ni mantenimientos en una desinstalación.
    revalidatePath(`/instalaciones/${parsed.id}`);
    revalidatePath(i.customer_id ? `/clientes/${i.customer_id}` : "/clientes");
    return;
  }

  if (i.kind === "relocation") {
    // No decrementa stock — el equipo solo cambia de dirección.
    // Buscar customer_equipment_id en notas (lo metió relocateEquipmentAction)
    const eqMatch = i.notes?.match(/customer_equipment_id=([0-9a-f-]{36})/i);
    if (eqMatch && i.address_id) {
      try {
        await admin
          .from("customer_equipment")
          .update({ address_id: i.address_id })
          .eq("id", eqMatch[1]);
      } catch (e) {
        console.error("[completeInstallation] relocation address update:", e);
      }
    }
    revalidatePath(`/instalaciones/${parsed.id}`);
    revalidatePath(i.customer_id ? `/clientes/${i.customer_id}` : "/clientes");
    return;
  }

  // ===== Flujo normal: decrementar stock + crear customer_equipment =====
  try {
    await decrementStockForInstallation(parsed.id);
  } catch {
    /* no-op: stock no debe tumbar finalización */
  }

  if (i.customer_id) {
    const { data: items } = await admin
      .from("installation_items")
      .select("product_id, serial_number")
      .eq("installation_id", parsed.id);
    type II = { product_id: string; serial_number: string | null };
    const list = (items ?? []) as II[];
    if (list.length > 0) {
      await admin.from("customer_equipment").insert(
        list.map((it) => ({
          company_id: session.company_id,
          customer_id: i.customer_id,
          product_id: it.product_id,
          installation_id: parsed.id,
          address_id: i.address_id,
          serial_number: it.serial_number,
          installed_at: now.toISOString().slice(0, 10),
        })),
      );
    }
  }

  // Persistir service_start_date en el contrato (fecha de inicio del servicio).
  // Si es hoy o pasada → activar; si es futura → dejar en signed (lo activará el cron).
  if (i.contract_id) {
    const todayIso = now.toISOString().slice(0, 10);
    const startIso = parsed.service_start_date ?? todayIso;
    const isFuture = startIso > todayIso;

    const update: Record<string, unknown> = { service_start_date: startIso };
    if (!isFuture) update.status = "active";

    const { data: updated } = await admin
      .from("contracts")
      .update(update)
      .eq("id", i.contract_id)
      .in("status", ["signed", "active"])
      .select("id, status");
    const wasActivatedNow =
      !isFuture &&
      ((updated ?? []) as Array<{ id: string; status: string }>).some((r) => r.status === "active");
    if (wasActivatedNow) {
      await autoScheduleMaintenanceForContract(i.contract_id);
    }
  }

  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "installation",
    subject_id: parsed.id,
    kind: "installation.completed",
    payload: { duration_seconds: durationSec },
    actor_user_id: session.user_id,
  });

  const { data: instRef } = await admin
    .from("installations")
    .select("reference_code, contract_id")
    .eq("id", parsed.id)
    .single();
  const instRow = instRef as {
    reference_code: string | null;
    contract_id: string | null;
  } | null;
  // Buscamos el comercial que cerró la venta (created_by del contrato)
  // para notificarle que su cliente está instalado y cobra comisión.
  let salesRepId: string | null = null;
  if (instRow?.contract_id) {
    try {
      const { data: contract } = await admin
        .from("contracts")
        .select("created_by")
        .eq("id", instRow.contract_id)
        .maybeSingle();
      salesRepId =
        (contract as { created_by: string | null } | null)?.created_by ?? null;
    } catch {
      /* no bloquea */
    }
  }
  await notifyInstallationCompleted(
    session.company_id!,
    parsed.id,
    instRow?.reference_code ?? null,
    salesRepId,
  );

  // Puntos al instalador
  if (session.company_id) {
    try {
      const { data: full } = await admin
        .from("installations")
        .select("installer_user_id")
        .eq("id", parsed.id)
        .maybeSingle();
      const installerId =
        (full as { installer_user_id: string | null } | null)?.installer_user_id ??
        session.user_id;
      const cfg = await getPointsSettings(session.company_id);
      if (installerId && cfg.points_per_installation > 0) {
        await awardPoints({
          company_id: session.company_id,
          user_id: installerId,
          points: cfg.points_per_installation,
          reason: "installation_completed",
          subject_type: "installation",
          subject_id: parsed.id,
          installation_id: parsed.id,
        });
      }
    } catch {
      /* no-op */
    }
  }

  revalidatePath(`/instalaciones/${parsed.id}`);
  revalidatePath("/instalaciones");
}
