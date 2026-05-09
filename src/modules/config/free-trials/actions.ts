"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { DEFAULT_FREE_TRIAL_CONDITIONS } from "./defaults";

export interface FreeTrialsConfig {
  duration_days: number;
  conditions_text: string;
  default_renting_quote_months: number;
}

const schema = z.object({
  duration_days: z.coerce.number().int().min(1).max(180),
  conditions_text: z.string().optional().default(""),
  default_renting_quote_months: z.coerce.number().int().min(1).max(120).default(48),
});

// Plantilla movida a ./defaults.ts (los archivos "use server" sólo
// pueden exportar funciones async).
const _LEGACY_TEMPLATE_DOC = `CONDICIONES DE ENTREGA DE EQUIPO EN PRUEBA

1. {empresa} entrega a {cliente} el equipo {equipo} en régimen de DEPÓSITO PROVISIONAL para una prueba de uso doméstico/profesional sin coste durante {dias_prueba} días, hasta el {fecha_devolucion}.

2. Este documento NO tiene carácter contractual de venta ni de arrendamiento. La propiedad del equipo permanece en todo momento de {empresa}. El cliente actúa como depositario.

3. La instalación, retirada y mantenimiento durante el periodo de prueba son GRATUITOS.

4. El cliente se compromete a:
   - Cuidar el equipo y mantenerlo en condiciones de uso normales.
   - No manipular el equipo ni permitir que terceros ajenos lo manipulen.
   - Notificar de inmediato cualquier avería, fuga o anomalía.
   - Devolver el equipo a primer requerimiento si no decide formalizar la contratación.

5. RESPONSABILIDAD POR DAÑOS Y PÉRDIDA:
   - Daños por uso indebido o negligencia: el cliente abonará el coste de reparación o, si fuera total, el valor de reposición del equipo.
   - Pérdida o sustracción del equipo: el cliente abonará el valor íntegro de reposición.
   - Valor de reposición orientativo del equipo: a indicar por la empresa en albarán.

6. Si transcurridos los {dias_prueba} días el cliente desea quedarse con el equipo, se formalizará el contrato correspondiente. Cuota orientativa: {precio_renting_mes} €/mes ({duracion_renting} meses).

7. Si el cliente no desea quedarse con el equipo, {empresa} retirará el equipo sin coste para el cliente.

8. El cliente declara haber leído y aceptado estas condiciones, y autoriza a {empresa} al tratamiento de los datos facilitados conforme a la normativa de Protección de Datos vigente.

Fecha de entrega: {fecha_entrega}
Lugar: {direccion}

Firma del cliente:                                Firma de {empresa}:`;
void _LEGACY_TEMPLATE_DOC;

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getFreeTrialsConfig(): Promise<FreeTrialsConfig> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("company_settings")
    .select("extra")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const extra = (data?.extra as Record<string, unknown> | null) ?? {};
  const ft = (extra.free_trials as Record<string, unknown> | undefined) ?? {};
  return {
    duration_days: (ft.duration_days as number | undefined) ?? 30,
    conditions_text:
      (ft.conditions_text as string | undefined) || DEFAULT_FREE_TRIAL_CONDITIONS,
    default_renting_quote_months:
      (ft.default_renting_quote_months as number | undefined) ?? 48,
  };
}

export async function updateFreeTrialsConfig(input: unknown) {
  const session = await ensureAdmin();
  const parsed = schema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("extra")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const baseExtra = (existing?.extra as Record<string, unknown>) ?? {};
  const newExtra = { ...baseExtra, free_trials: parsed };
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ extra: newExtra })
      .eq("company_id", session.company_id!);
  } else {
    await supabase
      .from("company_settings")
      .insert({ company_id: session.company_id!, extra: newExtra });
  }
  revalidatePath("/configuracion/pruebas-gratuitas");
}
