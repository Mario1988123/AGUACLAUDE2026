import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { madridDayRangeUtc } from "@/shared/lib/format-date";
import { cargarCatalogoModelo, cargarEquiposConModelo, modeloEquipoDisponible } from "./datos";
import { estadoIdentificacion, etiquetaModelo, type TipoEquipo } from "./logica";

/**
 * Modelo de equipo en la ruta del técnico (plan, sección 6, primera parte):
 * qué fuentes y ósmosis le tocan para poder cargar la furgoneta. Todo con
 * admin + company_id + el propio técnico. Tolerante: sin migración → null.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface ModeloTrabajo {
  etiqueta: string;
  pendiente: boolean;
  tipo: TipoEquipo | null;
  /** Se sabe al menos la gama (o es de otra marca). */
  conModelo: boolean;
}

/** job_id → modelo de su equipo. Trabajos sin equipo = pendiente sin tipo. */
export async function modeloDeTrabajos(
  companyId: string,
  jobIds: string[],
): Promise<Map<string, ModeloTrabajo> | null> {
  if (jobIds.length === 0) return new Map();
  if (!(await modeloEquipoDisponible())) return null;
  const admin = createAdminClient() as Admin;
  const { data } = await admin
    .from("maintenance_jobs")
    .select("id, customer_equipment_id")
    .eq("company_id", companyId)
    .in("id", jobIds.slice(0, 500));
  const jobs = (data ?? []) as Array<{ id: string; customer_equipment_id: string | null }>;
  const eqIds = Array.from(
    new Set(jobs.map((j) => j.customer_equipment_id).filter(Boolean)),
  ) as string[];
  const equipos = await cargarEquiposConModelo(companyId, { equipoIds: eqIds, incluirInactivos: true });
  const porEq = new Map(equipos.map((e) => [e.id, e]));
  const out = new Map<string, ModeloTrabajo>();
  for (const j of jobs) {
    const e = j.customer_equipment_id ? porEq.get(j.customer_equipment_id) : undefined;
    out.set(
      j.id,
      e
        ? {
            etiqueta: e.etiqueta,
            pendiente: e.estado.pendiente,
            tipo: e.estado.tipo,
            conModelo: !!(e.estado.gama || e.estado.variante || e.estado.externo),
          }
        : {
            etiqueta: "Sin equipo · pendiente de identificar",
            pendiente: true,
            tipo: null,
            conModelo: false,
          },
    );
  }
  return out;
}

export interface LineaRuta {
  etiqueta: string;
  tipo: TipoEquipo | null;
  pendiente: boolean;
  n: number;
}

export interface ResumenRuta {
  dia: string;
  mantenimientos: LineaRuta[];
  instalaciones: LineaRuta[];
  /** Pendientes sin gama: no suman a la carga, se atienden con la reserva. */
  sinIdentificar: { fuente: number; osmosis: number; desconocido: number };
  totalMantenimientos: number;
  totalInstalaciones: number;
}

function agrupar(lineas: Array<Omit<LineaRuta, "n">>): LineaRuta[] {
  const m = new Map<string, LineaRuta>();
  for (const l of lineas) {
    const prev = m.get(l.etiqueta);
    if (prev) prev.n += 1;
    else m.set(l.etiqueta, { ...l, n: 1 });
  }
  return Array.from(m.values()).sort(
    (a, b) => (a.tipo ?? "z").localeCompare(b.tipo ?? "z") || a.etiqueta.localeCompare(b.etiqueta, "es"),
  );
}

/** Resumen por modelo de lo que el técnico tiene un día (hoy o mañana). */
export async function resumenRutaPorModelo(
  companyId: string,
  userId: string,
  dia: Date,
): Promise<ResumenRuta | null> {
  if (!(await modeloEquipoDisponible())) return null;
  const admin = createAdminClient() as Admin;
  const { start, end } = madridDayRangeUtc(dia);
  const [mRes, iRes] = await Promise.all([
    admin
      .from("maintenance_jobs")
      .select("id, customer_equipment_id")
      .eq("company_id", companyId)
      .eq("technician_user_id", userId)
      .in("status", ["scheduled", "in_progress", "preprogrammed"])
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .limit(500),
    admin
      .from("installations")
      .select("id, kind")
      .eq("company_id", companyId)
      .eq("installer_user_id", userId)
      .in("status", ["scheduled", "in_progress", "paused"])
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .is("deleted_at", null)
      .limit(500),
  ]);
  const jobs = (mRes.data ?? []) as Array<{ id: string; customer_equipment_id: string | null }>;
  const insts = ((iRes.data ?? []) as Array<{ id: string; kind: string | null }>).filter(
    (i) => i.kind !== "uninstall",
  );

  const sinIdentificar = { fuente: 0, osmosis: 0, desconocido: 0 };
  const lineasMant: Array<Omit<LineaRuta, "n">> = [];
  const modelos = await modeloDeTrabajos(
    companyId,
    jobs.map((j) => j.id),
  );
  for (const j of jobs) {
    const mo = modelos?.get(j.id);
    if (!mo) continue;
    // Pendiente sin gama (solo tipo o nada): va a la reserva.
    if (!mo.conModelo) {
      if (mo.tipo === "fuente") sinIdentificar.fuente += 1;
      else if (mo.tipo === "osmosis") sinIdentificar.osmosis += 1;
      else sinIdentificar.desconocido += 1;
      continue;
    }
    lineasMant.push({ etiqueta: mo.etiqueta, tipo: mo.tipo, pendiente: mo.pendiente });
  }

  const lineasInst: Array<Omit<LineaRuta, "n">> = [];
  if (insts.length > 0) {
    const { data: items } = await admin
      .from("installation_items")
      .select("installation_id, product_id, quantity")
      .eq("company_id", companyId)
      .in(
        "installation_id",
        insts.map((i) => i.id),
      );
    const cat = await cargarCatalogoModelo(companyId);
    for (const it of (items ?? []) as Array<{ product_id: string; quantity: number }>) {
      const est = estadoIdentificacion({ product_id: it.product_id, external_equipment_model_id: null }, cat);
      if (!est.tipo) continue; // accesorios: no son equipo principal
      // En la instalación se lleva la gama; la variante se elige allí.
      const l = {
        etiqueta: etiquetaModelo({ ...est, pendiente: false, falta: null }),
        tipo: est.tipo,
        pendiente: false,
      };
      for (let k = 0; k < Math.max(1, it.quantity ?? 1); k++) lineasInst.push(l);
    }
  }

  return {
    dia: dia.toISOString(),
    mantenimientos: agrupar(lineasMant),
    instalaciones: agrupar(lineasInst),
    sinIdentificar,
    totalMantenimientos: jobs.length,
    totalInstalaciones: insts.length,
  };
}
