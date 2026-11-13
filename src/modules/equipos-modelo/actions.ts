"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { assertTrabajoAsignado } from "@/shared/lib/auth/role-scope";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  cargarCatalogoModelo,
  cargarEquiposConModelo,
  modeloEquipoDisponible,
} from "./datos";
import { esTipoEquipo, tipoEfectivoProducto, validarModeloElegido, type TipoEquipo } from "./logica";

type Resultado = { ok: true; equipo_id: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const SIN_MIGRACION =
  "Falta aplicar la migración del modelo de equipo (20261113090000). Avisa al administrador.";

/** Oficina = admin de empresa o director técnico (o superadmin). */
function esOficina(s: SessionClaims): boolean {
  return (
    s.is_superadmin || s.roles.includes("company_admin") || s.roles.includes("technical_director")
  );
}

export interface IdentificarEntrada {
  customer_id: string;
  /** Equipo a identificar. Null = crear un equipo nuevo para el cliente. */
  equipo_id?: string | null;
  /** Mantenimiento desde el que identifica el técnico (opcional). */
  maintenance_job_id?: string | null;
  /** Modelo nuestro (variante, o gama sin variantes). */
  product_id?: string | null;
  /** Modelo de otra marca. */
  external_equipment_model_id?: string | null;
  /** Solo la oficina: fijar únicamente el tipo de un equipo pendiente. */
  solo_tipo?: TipoEquipo | null;
  /** Técnico: el trabajo no tenía equipo y es uno ya identificado del
   *  cliente → solo se enlaza el trabajo a ese equipo. */
  solo_enlazar?: boolean;
}

/**
 * Identifica el modelo de un equipo del cliente y queda para siempre
 * (decisiones 1 y 4). La hace el técnico asignado desde el mantenimiento o la
 * oficina desde la ficha. NO sobrescribe un modelo ya identificado: para eso
 * está `corregirModeloEquipoAction` (solo admin, con motivo).
 */
export async function identificarEquipoAction(input: IdentificarEntrada): Promise<Resultado> {
  try {
    const session = await requireSession();
    const companyId = session.company_id;
    if (!companyId) return { ok: false, error: "Sin empresa" };
    if (!(await modeloEquipoDisponible())) return { ok: false, error: SIN_MIGRACION };
    if (!esUuid(input.customer_id)) return { ok: false, error: "Cliente no válido" };

    const productId = esUuid(input.product_id) ? input.product_id : null;
    const externoId = esUuid(input.external_equipment_model_id)
      ? input.external_equipment_model_id
      : null;
    const soloTipo = esTipoEquipo(input.solo_tipo) ? input.solo_tipo : null;
    const soloEnlazar = input.solo_enlazar === true;
    if (!soloEnlazar && [productId, externoId, soloTipo].filter(Boolean).length !== 1) {
      return { ok: false, error: "Elige un modelo" };
    }
    if (soloEnlazar && (!input.maintenance_job_id || !input.equipo_id)) {
      return { ok: false, error: "Elige el equipo" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Permiso: técnico asignado al trabajo, o la oficina.
    type Trabajo = {
      id: string;
      customer_id: string;
      customer_equipment_id: string | null;
      address_id?: string | null;
    };
    let job: Trabajo | null = null;
    if (input.maintenance_job_id) {
      if (!esUuid(input.maintenance_job_id)) return { ok: false, error: "Mantenimiento no válido" };
      const { data } = await admin
        .from("maintenance_jobs")
        .select("id, customer_id, customer_equipment_id, technician_user_id, status")
        .eq("id", input.maintenance_job_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!data) return { ok: false, error: "Mantenimiento no encontrado" };
      assertTrabajoAsignado(
        session,
        (data as { technician_user_id: string | null }).technician_user_id,
        "mantenimiento",
      );
      if ((data as { customer_id: string }).customer_id !== input.customer_id) {
        return { ok: false, error: "El mantenimiento no es de este cliente" };
      }
      job = data as Trabajo;
      // address_id del trabajo es columna añadida después: lectura aparte y tolerante.
      const ra = await admin
        .from("maintenance_jobs")
        .select("address_id")
        .eq("id", input.maintenance_job_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!ra.error && job) {
        job.address_id = (ra.data as { address_id: string | null } | null)?.address_id ?? null;
      }
    } else if (!esOficina(session)) {
      return { ok: false, error: "Solo la oficina puede identificar equipos desde la ficha" };
    }
    // El trabajo ya tiene equipo: se identifica ESE, nunca uno nuevo.
    if (job?.customer_equipment_id && !input.equipo_id) {
      input = { ...input, equipo_id: job.customer_equipment_id };
    }
    if (job?.customer_equipment_id && input.equipo_id && input.equipo_id !== job.customer_equipment_id) {
      return { ok: false, error: "Este mantenimiento es de otro equipo" };
    }
    if (soloTipo && job) {
      return { ok: false, error: "En el mantenimiento hay que elegir el modelo, no solo el tipo" };
    }

    // Cliente de la empresa.
    const { data: cust } = await admin
      .from("customers")
      .select("id")
      .eq("id", input.customer_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!cust) return { ok: false, error: "Cliente no encontrado" };

    if (soloEnlazar && job) {
      const [eq] = await cargarEquiposConModelo(companyId, { equipoIds: [input.equipo_id!] });
      if (!eq || eq.customer_id !== input.customer_id) {
        return { ok: false, error: "Equipo no encontrado en este cliente" };
      }
      if (eq.estado.pendiente) return { ok: false, error: "Ese equipo está sin identificar: identifícalo" };
      if (job.customer_equipment_id) return { ok: false, error: "Este mantenimiento ya tiene equipo" };
      const { error } = await admin
        .from("maintenance_jobs")
        .update({ customer_equipment_id: eq.id })
        .eq("id", job.id)
        .eq("company_id", companyId)
        .is("customer_equipment_id", null);
      if (error) return { ok: false, error: error.message };
      revalidatePath(`/mantenimientos/${job.id}`);
      return { ok: true, equipo_id: eq.id };
    }

    // Modelo elegido válido.
    let tipo: TipoEquipo | null = soloTipo;
    if (productId) {
      const cat = await cargarCatalogoModelo(companyId);
      const err = validarModeloElegido(productId, cat);
      if (err) return { ok: false, error: err };
      tipo = tipoEfectivoProducto(productId, cat);
    }
    if (externoId) {
      const { data: ext } = await admin
        .from("external_equipment_models")
        .select("id, company_id")
        .eq("id", externoId)
        .maybeSingle();
      const e = ext as { company_id: string | null } | null;
      if (!e || (e.company_id !== null && e.company_id !== companyId)) {
        return { ok: false, error: "Modelo de otra marca no válido" };
      }
    }

    const ahora = new Date().toISOString();
    const origen = job ? "tecnico" : "oficina";
    const identificado = !soloTipo;
    const cambios: Record<string, unknown> = identificado
      ? {
          product_id: productId,
          external_equipment_model_id: externoId,
          tipo_equipo: tipo,
          pendiente_identificar: false,
          modelo_identificado_at: ahora,
          modelo_identificado_por: session.user_id,
          modelo_origen: origen,
        }
      : { tipo_equipo: soloTipo, pendiente_identificar: true };
    // Otra marca: no se sabe el tipo → no se borra el que hubiera.
    if (cambios.tipo_equipo == null) delete cambios.tipo_equipo;

    let equipoId: string;
    if (input.equipo_id) {
      if (!esUuid(input.equipo_id)) return { ok: false, error: "Equipo no válido" };
      const [eq] = await cargarEquiposConModelo(companyId, { equipoIds: [input.equipo_id] });
      if (!eq || eq.customer_id !== input.customer_id) {
        return { ok: false, error: "Equipo no encontrado en este cliente" };
      }
      if (!eq.estado.pendiente) {
        return {
          ok: false,
          error: "Este equipo ya está identificado. Si está mal, la oficina puede corregirlo.",
        };
      }
      if (soloTipo && eq.product_id) {
        return { ok: false, error: "Este equipo ya tiene gama: elige la variante" };
      }
      // Compare-and-set sobre el modelo que había: si otro lo identificó a la
      // vez, no se pisa.
      let q = admin
        .from("customer_equipment")
        .update(cambios)
        .eq("id", eq.id)
        .eq("company_id", companyId);
      q = eq.product_id ? q.eq("product_id", eq.product_id) : q.is("product_id", null);
      q = q.is("external_equipment_model_id", null);
      const { data: upd, error } = await q.select("id");
      if (error) return { ok: false, error: error.message };
      if (!upd || (upd as unknown[]).length === 0) {
        return { ok: false, error: "Alguien acaba de identificar este equipo. Recarga la página." };
      }
      equipoId = eq.id;
    } else {
      // Equipo nuevo: dirección del trabajo o la principal del cliente.
      let addressId: string | null = job?.address_id ?? null;
      if (!addressId) {
        const { data: ad } = await admin
          .from("addresses")
          .select("id")
          .eq("company_id", companyId)
          .eq("customer_id", input.customer_id)
          .is("deleted_at", null)
          .order("is_primary", { ascending: false })
          .order("id")
          .limit(1)
          .maybeSingle();
        addressId = (ad as { id: string } | null)?.id ?? null;
      }
      const { data: ins, error } = await admin
        .from("customer_equipment")
        .insert({
          company_id: companyId,
          customer_id: input.customer_id,
          address_id: addressId,
          is_active: true,
          ...cambios,
          modelo_origen: origen,
        })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      equipoId = (ins as { id: string }).id;
    }

    // El trabajo sin equipo queda enlazado (solo si no tenía).
    if (job && !job.customer_equipment_id) {
      await admin
        .from("maintenance_jobs")
        .update({ customer_equipment_id: equipoId })
        .eq("id", job.id)
        .eq("company_id", companyId)
        .is("customer_equipment_id", null);
    }

    await admin.from("events").insert({
      company_id: companyId,
      subject_type: "customer",
      subject_id: input.customer_id,
      kind: identificado ? "customer.equipment_model_identified" : "customer.equipment_type_set",
      payload: {
        equipment_id: equipoId,
        product_id: productId,
        external_model_id: externoId,
        tipo_equipo: tipo,
        origen,
        maintenance_job_id: job?.id ?? null,
      },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/clientes/${input.customer_id}`);
    if (job) revalidatePath(`/mantenimientos/${job.id}`);
    return { ok: true, equipo_id: equipoId };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Corrige el modelo de un equipo ya identificado (decisión 5). Solo admin de
 * empresa, con motivo, y queda registrado en `correcciones_modelo_equipo`.
 */
export async function corregirModeloEquipoAction(input: {
  equipo_id: string;
  product_id?: string | null;
  external_equipment_model_id?: string | null;
  motivo: string;
}): Promise<Resultado> {
  try {
    const session = await requireSession();
    const companyId = session.company_id;
    if (!companyId) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo el administrador puede corregir el modelo" };
    }
    if (!(await modeloEquipoDisponible())) return { ok: false, error: SIN_MIGRACION };
    const motivo = (input.motivo ?? "").trim();
    if (motivo.length < 3) return { ok: false, error: "Escribe el motivo de la corrección" };
    if (!esUuid(input.equipo_id)) return { ok: false, error: "Equipo no válido" };
    const productId = esUuid(input.product_id) ? input.product_id : null;
    const externoId = esUuid(input.external_equipment_model_id)
      ? input.external_equipment_model_id
      : null;
    if ((productId ? 1 : 0) + (externoId ? 1 : 0) !== 1) {
      return { ok: false, error: "Elige un modelo" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const [eq] = await cargarEquiposConModelo(companyId, {
      equipoIds: [input.equipo_id],
      incluirInactivos: true,
    });
    if (!eq) return { ok: false, error: "Equipo no encontrado" };

    let tipo: TipoEquipo | null = eq.estado.tipo;
    if (productId) {
      const cat = await cargarCatalogoModelo(companyId);
      const err = validarModeloElegido(productId, cat);
      if (err) return { ok: false, error: err };
      tipo = tipoEfectivoProducto(productId, cat);
    } else if (externoId) {
      const { data: ext } = await admin
        .from("external_equipment_models")
        .select("id, company_id")
        .eq("id", externoId)
        .maybeSingle();
      const e = ext as { company_id: string | null } | null;
      if (!e || (e.company_id !== null && e.company_id !== companyId)) {
        return { ok: false, error: "Modelo de otra marca no válido" };
      }
    }
    if (eq.product_id === productId && eq.external_equipment_model_id === externoId) {
      return { ok: false, error: "Es el mismo modelo que ya tiene" };
    }

    const { error: rErr } = await admin.from("correcciones_modelo_equipo").insert({
      company_id: companyId,
      customer_equipment_id: eq.id,
      product_id_antes: eq.product_id,
      product_id_despues: productId,
      externo_antes: eq.external_equipment_model_id,
      externo_despues: externoId,
      tipo_antes: eq.estado.tipo,
      tipo_despues: tipo,
      motivo,
      corregido_por: session.user_id,
    });
    if (rErr) return { ok: false, error: rErr.message };

    const { error } = await admin
      .from("customer_equipment")
      .update({
        product_id: productId,
        external_equipment_model_id: externoId,
        ...(tipo ? { tipo_equipo: tipo } : {}),
        pendiente_identificar: false,
        modelo_identificado_at: new Date().toISOString(),
        modelo_identificado_por: session.user_id,
        modelo_origen: "oficina",
      })
      .eq("id", eq.id)
      .eq("company_id", companyId);
    if (error) return { ok: false, error: error.message };

    await admin.from("events").insert({
      company_id: companyId,
      subject_type: "customer",
      subject_id: eq.customer_id,
      kind: "customer.equipment_model_corrected",
      payload: {
        equipment_id: eq.id,
        product_id_antes: eq.product_id,
        product_id_despues: productId,
        motivo,
      },
      actor_user_id: session.user_id,
    });
    revalidatePath(`/clientes/${eq.customer_id}`);
    return { ok: true, equipo_id: eq.id };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
