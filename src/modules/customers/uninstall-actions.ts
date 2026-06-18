"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { madridLocalToUtcISO } from "@/shared/lib/format-date";

/**
 * Destino de cada equipo retirado:
 *  - 'warehouse': vuelve a un almacén (suma stock como usado/dañado). Default.
 *  - 'lost'     : máquina perdida (no se sabe dónde) — no vuelve a stock.
 *  - 'broken'   : rota, se tira a la basura — no vuelve a stock.
 *  - 'stolen'   : robada — no vuelve a stock.
 * En los tres últimos el equipo se da de baja igual, pero NO entra en ningún
 * almacén (queda registrado el motivo en notas + evento de auditoría).
 */
export type EquipmentDisposition = "warehouse" | "lost" | "broken" | "stolen";

export interface UninstallEquipmentInput {
  customer_id: string;
  // Equipos seleccionados a desinstalar (todos del mismo cliente)
  equipment_ids: string[];
  // Almacén destino donde van los equipos usados.
  destination_warehouse_id: string;
  scheduled_at?: string | null;
  // Si por adelantado se sabe el state real (used / damaged), se puede
  // forzar aquí. Default: el técnico decide al completar la instalación.
  default_state?: "used" | "damaged" | null;
  notes?: string | null;
  // Técnico que hará la retirada (opcional). Si se asigna, la verá en su
  // "Mi día" y agenda como RETIRADA.
  installer_user_id?: string | null;
  // Destino por equipo (opcional). Si no se indica para un equipo, se asume
  // 'warehouse' (comportamiento clásico). Permite marcar perdida/rota/robada.
  equipment_dispositions?: Array<{
    equipment_id: string;
    disposition: EquipmentDisposition;
  }> | null;
}

/**
 * Crea una orden de desinstalación: una sola installation kind='uninstall'
 * que agrupa todos los equipos a retirar. Cuando se complete, el flujo
 * suma el stock al almacén destino con state=used (o el que se indique).
 *
 * No descuenta stock — al revés: cuando termine la instalación, el hook
 * de cierre incrementa el almacén destino. Por eso desactivamos el
 * decremento normal: kind='uninstall' lo detecta el flujo de cierre.
 */
export async function createUninstallAction(
  input: UninstallEquipmentInput,
): Promise<
  { ok: true; installation_id: string } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director")
    ) {
      return { ok: false, error: "Solo admin o director técnico" };
    }
    if (input.equipment_ids.length === 0) {
      return { ok: false, error: "Selecciona al menos un equipo" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Equipos válidos del cliente.
    // ROBUSTO: SIN embed `product:products(name)`. Un embed puede tumbar toda
    // la query (regla feedback_postgrest_embeds_fragiles) y dejar 0 equipos
    // válidos — justo lo que pasaba con equipos EXTERNOS importados (product_id
    // null): "Ningún equipo válido para desinstalar". El nombre se resuelve por
    // id más abajo, igual que en listCustomerEquipment.
    const { data: rawEq } = await admin
      .from("customer_equipment")
      .select(
        "id, company_id, customer_id, product_id, address_id, serial_number, is_active",
      )
      .in("id", input.equipment_ids);
    type EQ = {
      id: string;
      company_id: string;
      customer_id: string;
      product_id: string | null;
      address_id: string | null;
      serial_number: string | null;
      is_active: boolean;
    };
    const equipment = (rawEq ?? []) as EQ[];
    const valid = equipment.filter(
      (e) =>
        e.company_id === session.company_id &&
        e.customer_id === input.customer_id &&
        e.is_active,
    );
    if (valid.length === 0) {
      return { ok: false, error: "Ningún equipo válido para desinstalar" };
    }
    // Destino por equipo (perdida/rota/robada NO vuelve a stock).
    const dispMap = new Map<string, EquipmentDisposition>();
    for (const d of input.equipment_dispositions ?? []) {
      dispMap.set(d.equipment_id, d.disposition);
    }
    const dispOf = (id: string): EquipmentDisposition =>
      dispMap.get(id) ?? "warehouse";
    // Solo los equipos NUESTROS marcados 'warehouse' vuelven al stock.
    const ours = valid.filter(
      (e) => e.product_id && dispOf(e.id) === "warehouse",
    );

    // SEGURIDAD: el almacén destino llega del navegador. Si se indica (no
    // aplica cuando todo es perdida/rota/robada), verificar que es de tu
    // empresa antes de serializarlo y mover stock con él (admin salta RLS).
    if (input.destination_warehouse_id) {
      const { assertWarehouseCompany } = await import(
        "@/modules/warehouses/ownership"
      );
      await assertWarehouseCompany(
        input.destination_warehouse_id,
        session.company_id,
      );
    }

    // 2) Reference code I-YYYY-NNNN
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

    // 3) Notas con el listado de equipos + payload con destino. El destino
    //    por equipo se etiqueta (PERDIDA/ROTA/ROBADA) para auditoría; el
    //    #UUID se mantiene SIEMPRE para que la baja del equipo se aplique al
    //    completar, vuelva o no a stock.
    // Nombres de producto por id (sin embed → robusto). Los externos no tienen
    // product_id → se etiquetan "Equipo externo".
    const prodIds = Array.from(
      new Set(valid.map((e) => e.product_id).filter(Boolean)),
    ) as string[];
    const nameById = new Map<string, string>();
    if (prodIds.length > 0) {
      const { data: prods } = await admin
        .from("products")
        .select("id, name")
        .in("id", prodIds);
      for (const p of (prods ?? []) as Array<{ id: string; name: string }>) {
        nameById.set(p.id, p.name);
      }
    }

    const DISP_TAG: Record<EquipmentDisposition, string> = {
      warehouse: "",
      lost: " [PERDIDA]",
      broken: " [ROTA]",
      stolen: " [ROBADA]",
    };
    const items = valid.map((e) => {
      const name = e.product_id ? nameById.get(e.product_id) ?? "Equipo" : "Equipo externo";
      return `${name}${e.serial_number ? ` (S/N ${e.serial_number})` : ""}${DISP_TAG[dispOf(e.id)]} #${e.id}`;
    });
    const status = input.scheduled_at ? "scheduled" : "unscheduled";
    const notesParts = [
      `Desinstalación de ${valid.length} equipo(s):`,
      ...items.map((i) => `  - ${i}`),
      `destination_warehouse_id=${input.destination_warehouse_id}`,
      `default_state=${input.default_state ?? "used"}`,
      input.notes ?? "",
    ].filter(Boolean);

    // 4) Crear installation
    const firstAddressId = valid[0]?.address_id ?? null;
    const { data: inst, error: instErr } = await admin
      .from("installations")
      .insert({
        company_id: session.company_id,
        kind: "uninstall",
        status,
        reference_code: referenceCode,
        customer_id: input.customer_id,
        address_id: firstAddressId,
        scheduled_at: input.scheduled_at ? madridLocalToUtcISO(input.scheduled_at) : null,
        installer_user_id: input.installer_user_id ?? null,
        assigned_at: input.installer_user_id ? new Date().toISOString() : null,
        assigned_by: input.installer_user_id ? session.user_id : null,
        notes: notesParts.join("\n"),
      })
      .select("id")
      .single();
    if (instErr) return { ok: false, error: instErr.message };
    const installationId = (inst as { id: string }).id;

    // 5) installation_items con cada equipo (1 ud por equipo)
    if (ours.length > 0) {
      const lineRows = ours.map((e) => ({
        installation_id: installationId,
        company_id: session.company_id,
        product_id: e.product_id,
        quantity: 1,
        serial_number: e.serial_number,
        notes: `Desinstalar — equipment ${e.id}`,
      }));
      const { error: lErr } = await admin
        .from("installation_items")
        .insert(lineRows);
      if (lErr) console.error("[uninstall] items insert:", lErr.message);
    }

    // 6) Evento en cada equipo y en el cliente
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "customer",
        subject_id: input.customer_id,
        kind: "equipment.uninstall_requested",
        payload: {
          installation_id: installationId,
          equipment_ids: input.equipment_ids,
          destination_warehouse_id: input.destination_warehouse_id,
          default_state: input.default_state ?? "used",
          dispositions: valid.map((e) => ({ id: e.id, disposition: dispOf(e.id) })),
        },
        actor_user_id: session.user_id,
      });
    } catch {
      /* no-op */
    }

    revalidatePath(`/clientes/${input.customer_id}`);
    revalidatePath("/instalaciones");
    return { ok: true, installation_id: installationId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Programa una desinstalación DESDE LA AGENDA: el admin elige cliente, sus
 * equipos a retirar, el técnico y la fecha. El destino es la FURGONETA del
 * técnico (decisión 2026-06-11: el equipo retirado pasa primero a su furgoneta
 * con etiqueta 'usado' + S/N, y luego él lo descarga donde toque). Si el técnico
 * no tiene furgoneta, cae al almacén principal.
 */
export async function createUninstallFromAgendaAction(input: {
  customer_id: string;
  equipment_ids: string[];
  technician_user_id?: string | null;
  scheduled_at?: string | null;
  notes?: string | null;
}): Promise<
  { ok: true; installation_id: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    return { ok: false, error: "Solo admin o director técnico puede programar retiradas" };
  }
  if (!input.equipment_ids || input.equipment_ids.length === 0) {
    return { ok: false, error: "Selecciona al menos un equipo a retirar" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: whs } = await admin
    .from("warehouses")
    .select("id, kind, assigned_user_id")
    .eq("company_id", session.company_id)
    .is("deleted_at", null);
  const list = (whs ?? []) as Array<{
    id: string;
    kind: string;
    assigned_user_id: string | null;
  }>;

  let destWarehouseId: string | null = null;
  if (input.technician_user_id) {
    const van = list.find(
      (w) => w.kind === "vehicle" && w.assigned_user_id === input.technician_user_id,
    );
    if (van) destWarehouseId = van.id;
  }
  if (!destWarehouseId) {
    const main =
      list.find((w) => w.kind === "main") ?? list.find((w) => w.kind !== "vehicle");
    destWarehouseId = main?.id ?? null;
  }
  if (!destWarehouseId) {
    return {
      ok: false,
      error:
        "No hay almacén destino. Crea un almacén principal o asigna una furgoneta al técnico.",
    };
  }

  return createUninstallAction({
    customer_id: input.customer_id,
    equipment_ids: input.equipment_ids,
    destination_warehouse_id: destWarehouseId,
    default_state: "used",
    scheduled_at: input.scheduled_at ?? null,
    installer_user_id: input.technician_user_id ?? null,
    notes: input.notes ?? null,
  });
}

/**
 * Cuando se completa una installation kind='uninstall', el flujo normal
 * de cierre llama aquí en vez de decrementStockForInstallation: añadimos
 * stock al almacén destino con state='used' (o el indicado) y marcamos
 * los equipos del cliente como is_active=false.
 *
 * El destino y el state se leen de installation.notes (donde
 * createUninstallAction los serializó).
 */
export async function processUninstallCompletion(
  installationId: string,
): Promise<{ moved: number; deactivated: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, kind, notes, customer_id")
    .eq("id", installationId)
    .maybeSingle();
  if (!inst) return { moved: 0, deactivated: 0 };
  const i = inst as {
    id: string;
    company_id: string;
    kind: string;
    notes: string | null;
    customer_id: string | null;
  };
  if (i.kind !== "uninstall") return { moved: 0, deactivated: 0 };

  // Parsear destino y state desde las notas
  const notes = i.notes ?? "";
  const destMatch = notes.match(/destination_warehouse_id=([0-9a-f-]+)/i);
  const stateMatch = notes.match(/default_state=(used|damaged|refurbished)/i);
  const destWarehouseId = destMatch?.[1];
  const stateOnReturn = (stateMatch?.[1] ?? "used") as
    | "used"
    | "damaged"
    | "refurbished";

  // Items a devolver a stock. Solo existen para los equipos marcados
  // 'warehouse' (los perdida/rota/robada no generan installation_items).
  // Si no hay destino o no hay items, NO devolvemos stock, pero más abajo
  // SIEMPRE damos de baja los equipos (clave para el caso "todo perdido").
  type IT = {
    product_id: string;
    quantity: number;
    serial_number: string | null;
    notes: string | null;
  };
  let list: IT[] = [];
  if (destWarehouseId) {
    const { data: items } = await admin
      .from("installation_items")
      .select("product_id, quantity, serial_number, notes")
      .eq("installation_id", installationId);
    list = (items ?? []) as IT[];
  }
  let moved = 0;

  for (const it of list) {
    // Sumar stock en destino con el state acordado (location_id = null)
    const { data: existing } = await admin
      .from("warehouse_stock")
      .select("id, quantity")
      .eq("company_id", i.company_id)
      .eq("warehouse_id", destWarehouseId)
      .eq("product_id", it.product_id)
      .eq("state", stateOnReturn)
      .is("location_id", null)
      .maybeSingle();
    const row = existing as { id: string; quantity: number } | null;
    if (row) {
      await admin
        .from("warehouse_stock")
        .update({ quantity: row.quantity + it.quantity })
        .eq("id", row.id);
    } else {
      await admin.from("warehouse_stock").insert({
        company_id: i.company_id,
        warehouse_id: destWarehouseId,
        product_id: it.product_id,
        quantity: it.quantity,
        state: stateOnReturn,
      });
    }
    // Movement type return + reason "uninstall"
    await admin.from("stock_movements").insert({
      company_id: i.company_id,
      product_id: it.product_id,
      warehouse_id: destWarehouseId,
      movement_type: "return",
      quantity: it.quantity,
      state_after: stateOnReturn,
      installation_id: i.id,
      notes: it.notes ?? null,
      reason: `Desinstalación cliente — entra como ${stateOnReturn}`,
    });
    moved += it.quantity;
  }

  // Desactivar equipos del cliente referenciados en notes
  // notes line "  - Producto (S/N ...) #UUID"
  const eqIds = Array.from(notes.matchAll(/#([0-9a-f-]{36})/gi)).map((m) => m[1]!);
  let deactivated = 0;
  if (eqIds.length > 0 && i.customer_id) {
    const { error: deErr } = await admin
      .from("customer_equipment")
      .update({ is_active: false })
      .in("id", eqIds)
      .eq("customer_id", i.customer_id);
    if (!deErr) deactivated = eqIds.length;
  }

  return { moved, deactivated };
}

/**
 * Cambia el estado de una línea de stock entre new/used/damaged/refurbished.
 * Pensado para "marcar como reacondicionado" desde el almacén de usados.
 * Si no hay otra línea con el nuevo estado, mueve la cantidad. Si hay,
 * fusiona.
 */
export async function changeStockStateAction(input: {
  warehouse_stock_id: string;
  new_state: "new" | "used" | "damaged" | "refurbished";
  quantity?: number;          // por defecto, todo
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director")
    ) {
      return { ok: false, error: "Sin permisos" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("warehouse_stock")
      .select("id, warehouse_id, product_id, quantity, state, location_id, company_id")
      .eq("id", input.warehouse_stock_id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Línea no encontrada" };
    const r = row as {
      id: string;
      warehouse_id: string;
      product_id: string;
      quantity: number;
      state: string;
      location_id: string | null;
      company_id: string;
    };
    // SEGURIDAD: admin client salta RLS → la línea se cargó solo por id;
    // verificamos que es de tu empresa antes de mover/borrar stock.
    if (!session.company_id || r.company_id !== session.company_id) {
      return { ok: false, error: "Línea no encontrada o no pertenece a tu empresa" };
    }
    if (r.state === input.new_state) return { ok: true };
    const qty = Math.min(r.quantity, input.quantity ?? r.quantity);
    if (qty <= 0) return { ok: false, error: "Cantidad inválida" };

    // Decrementar línea original
    if (qty === r.quantity) {
      await admin.from("warehouse_stock").delete().eq("id", r.id);
    } else {
      await admin
        .from("warehouse_stock")
        .update({ quantity: r.quantity - qty })
        .eq("id", r.id);
    }

    // Sumar en línea destino
    const { data: existing } = await admin
      .from("warehouse_stock")
      .select("id, quantity")
      .eq("warehouse_id", r.warehouse_id)
      .eq("product_id", r.product_id)
      .eq("state", input.new_state)
      .is("location_id", r.location_id)
      .maybeSingle();
    const dst = existing as { id: string; quantity: number } | null;
    if (dst) {
      await admin
        .from("warehouse_stock")
        .update({ quantity: dst.quantity + qty })
        .eq("id", dst.id);
    } else {
      await admin.from("warehouse_stock").insert({
        company_id: r.company_id,
        warehouse_id: r.warehouse_id,
        product_id: r.product_id,
        quantity: qty,
        state: input.new_state,
        location_id: r.location_id,
      });
    }

    // Movement informativo
    await admin.from("stock_movements").insert({
      company_id: r.company_id,
      product_id: r.product_id,
      warehouse_id: r.warehouse_id,
      movement_type: "adjustment_plus",
      quantity: qty,
      state_after: input.new_state,
      reason: `Cambio de estado ${r.state} → ${input.new_state}`,
      notes: input.notes ?? null,
      performed_by: session.user_id,
    });

    revalidatePath(`/almacenes/${r.warehouse_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Marca una orden de desinstalación como YA HECHA (cuando el cliente nos dice
 * que el equipo ya se retiró). Pone la installation en 'completed' con la
 * fecha indicada y dispara el cierre (devuelve stock de los 'warehouse' y da
 * de baja TODOS los equipos). Para retiradas que se programan a futuro NO se
 * usa esto: las cierra el técnico desde /instalaciones como siempre.
 */
export async function completeUninstallNowAction(input: {
  installation_id: string;
  completed_at?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director")
    ) {
      return { ok: false, error: "Solo admin o director técnico" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: inst } = await admin
      .from("installations")
      .select("id, company_id, kind, status")
      .eq("id", input.installation_id)
      .maybeSingle();
    const i = inst as
      | { id: string; company_id: string; kind: string; status: string }
      | null;
    if (!i) return { ok: false, error: "Orden no encontrada" };
    // SEGURIDAD: admin client salta RLS → comprobar empresa.
    if (i.company_id !== session.company_id) {
      return { ok: false, error: "No pertenece a tu empresa" };
    }
    if (i.kind !== "uninstall") {
      return { ok: false, error: "No es una orden de desinstalación" };
    }
    const completedAt = input.completed_at || new Date().toISOString();
    await admin
      .from("installations")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", i.id)
      .eq("company_id", session.company_id);

    try {
      await processUninstallCompletion(i.id);
    } catch (e) {
      console.error("[completeUninstallNow] completion:", e);
    }

    revalidatePath("/instalaciones");
    revalidatePath(`/instalaciones/${i.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
