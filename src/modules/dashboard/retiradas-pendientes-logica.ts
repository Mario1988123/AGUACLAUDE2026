/**
 * Lógica PURA del aviso «Retiradas que dejaron equipos activos».
 *
 * Contexto: hasta el arreglo de las notas (2026-11-09), cerrar una retirada
 * con el asistente del técnico sustituía las notas de la orden y se perdían
 * los equipos a dar de baja: la orden quedaba `completed` pero los equipos
 * seguían activos en el cliente (y el stock sin volver).
 *
 * Criterio (decisión del agente):
 *  1. Si la orden tiene su evento `equipment.uninstall_requested` con
 *     `equipment_ids` (todas las creadas por el CRM lo tienen), se miran ESOS
 *     equipos: la orden está mal si alguno sigue activo. Es exacto y no da
 *     falsos positivos con un cliente que tenga otra unidad del mismo
 *     producto bien instalada.
 *  2. Si no hay evento, se cae a la cuenta por producto: está mal si quedan
 *     equipos activos del cliente con algún producto de sus líneas.
 *  3. Se da por RESUELTA si, después de completarse, hay una retirada manual
 *     (`equipment.manual_uninstall`) del mismo cliente que incluye un equipo
 *     de alguno de esos productos: la persona la corrigió a mano, aunque
 *     eligiera otra unidad física del mismo modelo.
 * Así desaparece sola al corregirse con «Retirar manualmente».
 */

export interface OrdenRetirada {
  id: string;
  reference_code: string | null;
  customer_id: string;
  completed_at: string | null;
}

export interface LineaRetirada {
  installation_id: string;
  product_id: string;
  quantity: number;
}

export interface EquipoActivo {
  id: string;
  customer_id: string;
  product_id: string | null;
}

export interface RetiradaManualPosterior {
  customer_id: string;
  created_at: string;
  /** Productos de los equipos que retiró. */
  product_ids: string[];
}

export interface RetiradaPendiente {
  installation_id: string;
  reference_code: string | null;
  customer_id: string;
  completed_at: string | null;
  retirados: number;
  activos: number;
}

export function retiradasConEquiposActivos(a: {
  ordenes: OrdenRetirada[];
  lineas: LineaRetirada[];
  /** installation_id → equipment_ids de su evento de solicitud. */
  equiposDeOrden: Map<string, string[]>;
  activos: EquipoActivo[];
  manuales: RetiradaManualPosterior[];
}): RetiradaPendiente[] {
  const lineasPor = new Map<string, LineaRetirada[]>();
  for (const l of a.lineas) {
    const arr = lineasPor.get(l.installation_id) ?? [];
    arr.push(l);
    lineasPor.set(l.installation_id, arr);
  }
  const activosPorCliente = new Map<string, EquipoActivo[]>();
  for (const e of a.activos) {
    const arr = activosPorCliente.get(e.customer_id) ?? [];
    arr.push(e);
    activosPorCliente.set(e.customer_id, arr);
  }
  const activoIds = new Set(a.activos.map((e) => e.id));

  const out: RetiradaPendiente[] = [];
  for (const o of a.ordenes) {
    const lineas = lineasPor.get(o.id) ?? [];
    const productos = new Set(lineas.map((l) => l.product_id));
    if (productos.size === 0) continue; // sin líneas: nada que devolver
    const delCliente = activosPorCliente.get(o.customer_id) ?? [];
    const activosProducto = delCliente.filter((e) => e.product_id && productos.has(e.product_id));

    const ids = a.equiposDeOrden.get(o.id);
    const mal =
      ids && ids.length > 0 ? ids.some((id) => activoIds.has(id)) : activosProducto.length > 0;
    if (!mal) continue;

    const t = o.completed_at ? new Date(o.completed_at).getTime() : 0;
    const resuelta = a.manuales.some(
      (m) =>
        m.customer_id === o.customer_id &&
        new Date(m.created_at).getTime() > t &&
        m.product_ids.some((p) => productos.has(p)),
    );
    if (resuelta) continue;

    out.push({
      installation_id: o.id,
      reference_code: o.reference_code,
      customer_id: o.customer_id,
      completed_at: o.completed_at,
      retirados: lineas.reduce((s, l) => s + (l.quantity ?? 0), 0),
      activos: activosProducto.length,
    });
  }
  return out.sort((x, y) => (y.completed_at ?? "").localeCompare(x.completed_at ?? ""));
}
