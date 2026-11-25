"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";

/**
 * «Sustituir esta parte» de un pack con complemento (Horeca + ósmosis/UF).
 * Mario 2026-11-25: «si una parte falla, se puede SUSTITUIR solo esa parte».
 *
 * No es «Corregir modelo» (eso arregla un dato mal puesto y va a
 * correcciones_modelo_equipo). Aquí hay un equipo físico nuevo:
 *  - vale el MISMO modelo con otro número de serie, o un modelo distinto del
 *    mismo tipo de equipo;
 *  - el registro del cliente conserva parent_equipment_id y pack_role (el
 *    pack sigue igual) y su historial de mantenimientos;
 *  - la unidad vieja queda como equipo dado de baja (histórico) con su modelo
 *    y su número de serie;
 *  - la unidad nueva se descuenta del almacén: la furgoneta de quien la hace
 *    o, si no tiene, el almacén principal. La vieja NO vuelve al stock sola.
 *  - queda el evento customer.equipment_pack_part_replaced.
 * Permisos: admin de empresa y director técnico (como reubicar o dar de baja).
 */
export async function sustituirParteDelPackAction(input: {
  equipo_id: string;
  product_id: string;
  serial_number?: string | null;
  motivo: string;
}): Promise<
  | { ok: true; equipo_id: string; aviso_stock: string | null }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    const companyId = session.company_id;
    if (!companyId) return { ok: false, error: "Sin empresa" };
    const puede =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director");
    if (!puede) {
      return { ok: false, error: "Solo el administrador o el director técnico pueden sustituir equipos" };
    }
    const motivo = (input.motivo ?? "").trim();
    if (motivo.length < 3) return { ok: false, error: "Escribe el motivo de la sustitución" };
    const serieNueva = (input.serial_number ?? "").trim() || null;
    if (!input.equipo_id || !input.product_id) return { ok: false, error: "Elige el equipo nuevo" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) La parte y su pack (admin salta RLS → company_id explícito).
    const { data: eqRaw, error: eqErr } = await admin
      .from("customer_equipment")
      .select(
        "id, customer_id, product_id, external_equipment_model_id, serial_number, address_id, installed_at, is_active, parent_equipment_id, pack_role, tipo_equipo",
      )
      .eq("id", input.equipo_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (eqErr) {
      if (/pack_role|tipo_equipo/i.test(eqErr.message ?? "")) {
        return { ok: false, error: "Falta aplicar la migración del pack con complemento" };
      }
      return { ok: false, error: eqErr.message };
    }
    const eq = eqRaw as {
      id: string;
      customer_id: string;
      product_id: string | null;
      external_equipment_model_id: string | null;
      serial_number: string | null;
      address_id: string | null;
      installed_at: string | null;
      is_active: boolean;
      parent_equipment_id: string | null;
      pack_role: string | null;
      tipo_equipo: string | null;
    } | null;
    if (!eq) return { ok: false, error: "Equipo no encontrado" };
    if (!eq.is_active) return { ok: false, error: "Ese equipo ya está dado de baja" };

    let enPack = eq.pack_role === "complemento";
    if (!enPack) {
      const { count } = await admin
        .from("customer_equipment")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("parent_equipment_id", eq.id)
        .eq("pack_role", "complemento")
        .eq("is_active", true);
      enPack = (count ?? 0) > 0;
    }
    if (!enPack) {
      return { ok: false, error: "Solo se sustituyen partes de un pack con equipo complementario" };
    }

    // 2) El equipo nuevo: de tu catálogo y del mismo tipo que el que sale.
    const { data: prodRaw } = await admin
      .from("products")
      .select("id, name")
      .eq("id", input.product_id)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    const prod = prodRaw as { id: string; name: string } | null;
    if (!prod) return { ok: false, error: "Ese equipo no está en tu catálogo" };

    const { cargarCatalogoModelo } = await import("@/modules/equipos-modelo/datos");
    const { tipoEfectivoProducto } = await import("@/modules/equipos-modelo/logica");
    const cat = await cargarCatalogoModelo(companyId);
    const tipoNuevo = tipoEfectivoProducto(prod.id, cat);
    const tipoViejo = eq.tipo_equipo ?? tipoEfectivoProducto(eq.product_id, cat);
    if (tipoViejo && tipoNuevo && tipoViejo !== tipoNuevo) {
      return {
        ok: false,
        error: "El equipo nuevo tiene que ser del mismo tipo que el que se sustituye (Horeca por Horeca, ósmosis por ósmosis)",
      };
    }
    if (prod.id === eq.product_id && (!serieNueva || serieNueva === eq.serial_number)) {
      return { ok: false, error: "Si es el mismo modelo, escribe el número de serie del equipo nuevo" };
    }

    const hoy = new Date().toISOString().slice(0, 10);

    // 3) Histórico de la unidad que sale: queda como equipo dado de baja.
    //    Fail-soft: si no se puede, la sustitución sigue y lo dice el evento.
    let historicoId: string | null = null;
    {
      const { data: h, error: hErr } = await admin
        .from("customer_equipment")
        .insert({
          company_id: companyId,
          customer_id: eq.customer_id,
          product_id: eq.product_id,
          external_equipment_model_id: eq.product_id ? null : eq.external_equipment_model_id,
          serial_number: eq.serial_number,
          address_id: eq.address_id,
          installed_at: eq.installed_at,
          is_active: false,
          notes: `Sustituido el ${hoy} por ${prod.name}${serieNueva ? ` (S/N ${serieNueva})` : ""}. Motivo: ${motivo}`,
        })
        .select("id")
        .single();
      if (hErr) console.error("[sustituirParteDelPack] histórico:", hErr.message);
      else historicoId = (h as { id: string }).id;
    }

    // 4) La parte del pack pasa a ser el equipo nuevo. NO se tocan
    //    parent_equipment_id ni pack_role: el pack se conserva.
    const { error: upErr } = await admin
      .from("customer_equipment")
      .update({
        product_id: prod.id,
        external_equipment_model_id: null,
        serial_number: serieNueva,
        installed_at: hoy,
        ...(tipoNuevo ? { tipo_equipo: tipoNuevo } : {}),
        pendiente_identificar: false,
      })
      .eq("id", eq.id)
      .eq("company_id", companyId);
    if (upErr) {
      if (historicoId) {
        await admin.from("customer_equipment").delete().eq("id", historicoId).eq("company_id", companyId);
      }
      return { ok: false, error: upErr.message };
    }

    // 5) Stock de la unidad nueva: furgoneta de quien sustituye o almacén
    //    principal. Fail-soft: la sustitución no se deshace por el stock.
    let avisoStock: string | null = null;
    let almacenId: string | null = null;
    let movidas = 0;
    try {
      const { data: whs } = await admin
        .from("warehouses")
        .select("id, kind, assigned_user_id")
        .eq("company_id", companyId)
        .is("deleted_at", null);
      const lista = (whs ?? []) as Array<{ id: string; kind: string; assigned_user_id: string | null }>;
      almacenId =
        lista.find((w) => w.kind === "vehicle" && w.assigned_user_id === session.user_id)?.id ??
        lista.find((w) => w.kind === "main")?.id ??
        null;
      if (!almacenId) {
        avisoStock = "No hay almacén del que descontar el equipo nuevo: ajusta el stock a mano.";
      } else {
        const { decrementStock } = await import("@/modules/warehouses/stock-decrement");
        movidas = await decrementStock({
          company_id: companyId,
          warehouse_id: almacenId,
          product_id: prod.id,
          quantity: 1,
          movement_type: "outbound_install",
          performed_by: session.user_id,
          notes: `Sustitución de una parte del pack (equipo ${eq.id})`,
        });
        if (movidas < 1) {
          avisoStock = "No había stock del equipo nuevo en el almacén: revisa el inventario.";
        }
      }
    } catch (e) {
      console.error("[sustituirParteDelPack] stock:", e);
      avisoStock = "No se pudo descontar el stock del equipo nuevo: ajústalo a mano.";
    }

    await admin.from("events").insert({
      company_id: companyId,
      subject_type: "customer",
      subject_id: eq.customer_id,
      kind: "customer.equipment_pack_part_replaced",
      payload: {
        equipment_id: eq.id,
        pack_role: eq.pack_role,
        parent_equipment_id: eq.parent_equipment_id,
        product_id_antes: eq.product_id,
        product_id_despues: prod.id,
        serial_antes: eq.serial_number,
        serial_despues: serieNueva,
        historico_equipo_id: historicoId,
        almacen_id: almacenId,
        unidades_descontadas: movidas,
        motivo,
      },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/clientes/${eq.customer_id}`);
    return { ok: true, equipo_id: eq.id, aviso_stock: avisoStock };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
