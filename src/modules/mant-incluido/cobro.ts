import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import type { SessionClaims } from "@/shared/lib/auth/session";
import { cargarMantVisita, type MantVisita } from "./datos";
import {
  ETIQUETA_TARIFA,
  diferenciaMembrana,
  eur,
  totalConIva,
  type PagoEstado,
  type Tarifa,
} from "./logica";

/**
 * Cobro de la visita al CERRARLA (flujo §2.1 del plan). Dos pasos:
 *  1. `prepararCobroCierre` ANTES de marcar la visita completada: valida lo
 *     que manda el técnico y decide qué hay que escribir (o lanza un error
 *     legible, y la visita no se cierra).
 *  2. `aplicarCobroCierre` DESPUÉS del cierre: escribe con compare-and-set
 *     sobre pago_estado (si la oficina la marcó pagada mientras tanto, gana
 *     la oficina y no se crea la línea de wallet) y crea UNA línea de wallet
 *     (índice único por visita).
 * Nada de facturas: la facturación del CRM está parada (2026-11-09).
 */

export interface CobroEntrada {
  cobrado: boolean;
  metodo?: "cash" | "card" | null;
  /** Lo que entra en caja, IVA incluido. */
  cents?: number | null;
  motivo?: string | null;
}

type Plan =
  | { tipo: "nada" }
  | { tipo: "solo_tarifa"; tarifa: Tarifa }
  | {
      tipo: "cobro";
      /** Estados de los que puede venir la fila (compare-and-set). */
      desde: PagoEstado[];
      tarifa: Tarifa;
      baseCents: number | null;
      iva: number;
      diferencia: boolean;
      cobro: CobroEntrada;
      customerId: string;
    };

export interface PreparadoCobro {
  plan: Plan;
  visita: MantVisita | null;
}

const SIN_TARIFA = "Elige qué tarifa has hecho: solo filtros o filtros + membrana";

export async function prepararCobroCierre(
  companyId: string,
  jobId: string,
  customerId: string,
  tarifa: Tarifa | null | undefined,
  cobro: CobroEntrada | null | undefined,
): Promise<PreparadoCobro> {
  const visita = await cargarMantVisita(companyId, jobId);
  if (!visita) return { plan: { tipo: "nada" }, visita };
  const ef = visita.pagoEfectivo;
  const r = visita.resumen;

  if (ef === "cobrado_tecnico" || ef === "no_cobrado") return { plan: { tipo: "nada" }, visita };

  if (ef === "incluido") {
    return { plan: tarifa ? { tipo: "solo_tarifa", tarifa } : { tipo: "nada" }, visita };
  }

  if (ef === "pagado_oficina") {
    if (!tarifa) return { plan: { tipo: "nada" }, visita };
    const dif = diferenciaMembrana(
      visita.pagadoOficina?.tarifa ?? null,
      tarifa,
      r?.aplicado.solo_filtros.cents ?? null,
      r?.aplicado.filtros_membrana.cents ?? null,
      visita.pagadoOficina?.cents ?? null,
    );
    if (dif == null) return { plan: { tipo: "solo_tarifa", tarifa }, visita };
    validarCobro(cobro);
    return {
      plan: {
        tipo: "cobro",
        desde: ["pagado_oficina"],
        tarifa,
        baseCents: dif,
        iva: r?.iva ?? 21,
        diferencia: true,
        cobro: cobro!,
        customerId,
      },
      visita,
    };
  }

  // pendiente: hay que cobrar esta visita.
  if (!tarifa) throw new Error(SIN_TARIFA);
  validarCobro(cobro);
  return {
    plan: {
      tipo: "cobro",
      desde: ["incluido", "pendiente"],
      tarifa,
      baseCents: r?.aplicado[tarifa].cents ?? null,
      iva: r?.iva ?? 21,
      diferencia: false,
      cobro: cobro!,
      customerId,
    },
    visita,
  };
}

function validarCobro(cobro: CobroEntrada | null | undefined): void {
  if (!cobro) throw new Error("Indica si has cobrado el mantenimiento");
  if (cobro.cobrado) {
    if (cobro.metodo !== "cash" && cobro.metodo !== "card") {
      throw new Error("Elige la forma de pago: efectivo o tarjeta");
    }
    if (!cobro.cents || cobro.cents <= 0) throw new Error("Indica el importe cobrado");
    if (cobro.cents > 1_000_000) throw new Error("El importe cobrado no parece correcto");
  } else if (!cobro.motivo?.trim()) {
    throw new Error("Escribe por qué no has cobrado");
  }
}

/** Devuelve un aviso para el técnico (o null si todo fue normal). */
export async function aplicarCobroCierre(
  session: SessionClaims,
  jobId: string,
  prep: PreparadoCobro,
): Promise<string | null> {
  const plan = prep.plan;
  if (plan.tipo === "nada") return null;
  const companyId = session.company_id!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  if (plan.tipo === "solo_tarifa") {
    await admin
      .from("maintenance_jobs")
      .update({ alcance: plan.tarifa })
      .eq("id", jobId)
      .eq("company_id", companyId)
      .is("alcance", null);
    return null;
  }

  const ahora = new Date().toISOString();
  const etiqueta = plan.diferencia
    ? "Diferencia de membrana"
    : `Mantenimiento ${ETIQUETA_TARIFA[plan.tarifa].toLowerCase()}`;

  if (plan.cobro.cobrado) {
    const cents = plan.cobro.cents!;
    const upd = await admin
      .from("maintenance_jobs")
      .update({
        pago_estado: "cobrado_tecnico",
        alcance: plan.tarifa,
        ...(plan.diferencia ? {} : { importe_base_cents: plan.baseCents }),
        iva_porcentaje: plan.iva,
        importe_pendiente_cents: null,
        cobrado_metodo: plan.cobro.metodo,
        cobrado_cents: cents,
        cobrado_por: session.user_id,
        cobrado_at: ahora,
        no_cobrado_motivo: null,
        is_charged: true,
        ...(plan.diferencia ? {} : { charge_cents: plan.baseCents }),
      })
      .eq("id", jobId)
      .eq("company_id", companyId)
      .in("pago_estado", plan.desde)
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data || (upd.data as unknown[]).length === 0) {
      return "Este mantenimiento ya consta como pagado en oficina: no se ha registrado tu cobro.";
    }
    const status = plan.cobro.metodo === "cash" ? "pending_settlement" : "collected";
    const concepto = `${etiqueta}${plan.baseCents == null ? " (sin precio definido)" : ""}`;
    const ins = await admin
      .from("wallet_entries")
      .insert({
        company_id: companyId,
        customer_id: plan.customerId,
        maintenance_job_id: jobId,
        concept: concepto,
        amount_cents: cents,
        method: plan.cobro.metodo,
        status,
        collected_by_user_id: session.user_id,
        collected_at: ahora,
        notes: plan.baseCents != null
          ? `Base ${eur(plan.baseCents)} + IVA ${plan.iva}% = ${eur(totalConIva(plan.baseCents, plan.iva))}`
          : "Importe puesto a mano por el técnico: revísalo",
      })
      .select("id")
      .single();
    if (ins.error) {
      if (ins.error.code === "23505") return null; // ya existía la línea (doble envío)
      console.error("[mant-incluido] wallet:", ins.error.message);
      return "El cobro queda anotado en la visita, pero no se pudo guardar en el wallet. Avisa a la oficina.";
    }
    try {
      const { notifyPaymentPendingValidation, notifyByRoles } = await import(
        "@/modules/notifications/notifier"
      );
      if (status === "collected") {
        await notifyPaymentPendingValidation(companyId, ins.data.id, cents, concepto, String(plan.cobro.metodo));
      }
      if (plan.baseCents == null) {
        await notifyByRoles(companyId, ["company_admin", "technical_director"], {
          kind: "maintenance.cobro_sin_precio",
          category: "alert",
          severity: "warning",
          title: "Mantenimiento cobrado sin precio definido",
          body: `El técnico cobró ${eur(cents)}. Revisa el importe y pon el precio del equipo o de la empresa.`,
          subject_type: "maintenance",
          subject_id: jobId,
          action_url: `/mantenimientos/${jobId}`,
        });
      }
    } catch {
      /* fail-soft: el cobro ya está guardado */
    }
    return null;
  }

  // No cobrado → queda pendiente para la oficina.
  const pendiente =
    plan.baseCents ?? null;
  const upd = await admin
    .from("maintenance_jobs")
    .update({
      pago_estado: plan.diferencia ? "pendiente" : "no_cobrado",
      alcance: plan.tarifa,
      ...(plan.diferencia ? {} : { importe_base_cents: plan.baseCents }),
      iva_porcentaje: plan.iva,
      importe_pendiente_cents: pendiente,
      no_cobrado_motivo: plan.cobro.motivo?.trim().slice(0, 500) ?? null,
      is_charged: true,
      ...(plan.diferencia ? {} : { charge_cents: plan.baseCents }),
    })
    .eq("id", jobId)
    .eq("company_id", companyId)
    .in("pago_estado", plan.desde)
    .select("id");
  if (upd.error) throw new Error(upd.error.message);
  if (!upd.data || (upd.data as unknown[]).length === 0) {
    return "Este mantenimiento ya consta como pagado en oficina.";
  }
  try {
    const { notifyByRoles } = await import("@/modules/notifications/notifier");
    await notifyByRoles(companyId, ["company_admin", "technical_director"], {
      kind: plan.diferencia ? "maintenance.diferencia_membrana" : "maintenance.no_cobrado",
      category: "alert",
      severity: "warning",
      title: plan.diferencia ? "Diferencia de membrana por cobrar" : "Mantenimiento sin cobrar",
      body: [
        pendiente != null ? `${eur(pendiente)} + IVA` : "Precio sin definir",
        plan.cobro.motivo?.trim() ? `Motivo: ${plan.cobro.motivo.trim().slice(0, 200)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      subject_type: "maintenance",
      subject_id: jobId,
      action_url: `/mantenimientos/${jobId}`,
    });
  } catch {
    /* fail-soft */
  }
  return null;
}
