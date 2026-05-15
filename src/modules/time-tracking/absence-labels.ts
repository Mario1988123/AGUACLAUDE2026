// Constantes y tipos compartidos del módulo de ausencias. No es
// "use server" — se puede importar desde client components y server
// actions. Mover desde absences-actions.ts (que sí es "use server" y
// solo puede exportar funciones async).

export type AbsenceKind =
  | "vacation"
  | "sick"
  | "personal"
  | "training"
  | "other"
  | "paternity"
  | "maternity"
  | "marriage"
  | "bereavement"
  | "lactation"
  // Permiso parental hasta los 8 años del menor. Transposición Directiva
  // UE 2019/1158 + RD-ley 7/2024: 8 semanas totales, de las cuales 2
  // son retribuidas desde 2026 y 6 quedan no retribuidas.
  | "parental_paid_8y"
  | "parental_unpaid_8y"
  // mantenemos parental_unpaid solo para retro-compat con datos
  // existentes; se va a borrar cuando todos migren.
  | "parental_unpaid"
  | "mudanza"
  | "civic_duty";

export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled";

export const ABSENCE_KIND_LABEL_LC: Record<AbsenceKind, string> = {
  vacation: "vacaciones",
  sick: "baja médica",
  personal: "asunto personal",
  training: "formación",
  other: "ausencia",
  paternity: "paternidad",
  maternity: "maternidad",
  marriage: "permiso matrimonio",
  bereavement: "fallecimiento familiar",
  lactation: "lactancia",
  parental_paid_8y: "permiso parental retribuido (hasta 8 años)",
  parental_unpaid_8y: "permiso parental no retribuido (hasta 8 años)",
  parental_unpaid: "permiso parental",
  mudanza: "mudanza",
  civic_duty: "deber público",
};

export const ABSENCE_KIND_LABEL_UC: Record<AbsenceKind, string> = {
  vacation: "Vacaciones",
  sick: "Baja médica",
  personal: "Asunto personal",
  training: "Formación",
  other: "Otro",
  paternity: "Paternidad",
  maternity: "Maternidad",
  marriage: "Permiso matrimonio",
  bereavement: "Fallecimiento familiar",
  lactation: "Lactancia",
  parental_paid_8y: "Parental retribuido (hasta 8 años)",
  parental_unpaid_8y: "Parental no retribuido (hasta 8 años)",
  parental_unpaid: "Permiso parental",
  mudanza: "Mudanza",
  civic_duty: "Deber público",
};

/** Presupuesto legal por defecto en España 2026 para cada tipo. Lo usa
 *  el admin como sugerencia al inicializar a un empleado.
 *
 *  Cambios 2026:
 *   - RD-ley 7/2024 + transposición Directiva UE 2019/1158:
 *     permiso parental 8 semanas hasta 8 años → 2 sem retribuidas +
 *     6 sem no retribuidas.
 *   - Maternidad/paternidad mantiene 16 semanas (6 obligatorias post
 *     parto + 10 flexibles hasta los 12 meses del menor).
 */
export const DEFAULT_BUDGETS_2026: Record<
  AbsenceKind,
  { unit: "days" | "hours" | "weeks" | "months"; value: number }
> = {
  vacation: { unit: "days", value: 22 }, // ET Art. 38: mín 30 naturales ≈ 22 laborables
  sick: { unit: "days", value: 0 },
  personal: { unit: "days", value: 0 },
  training: { unit: "days", value: 0 },
  other: { unit: "days", value: 0 },
  paternity: { unit: "weeks", value: 16 }, // RD-ley 6/2019: 6 obligatorias + 10 flex hasta 12m
  maternity: { unit: "weeks", value: 16 },
  marriage: { unit: "days", value: 15 }, // ET Art. 37.3
  bereavement: { unit: "days", value: 5 }, // RD-ley 5/2023
  lactation: { unit: "months", value: 9 },
  // Permiso parental hasta 8 años: 2 sem retribuidas + 6 sem no
  // retribuidas, sumando 8 semanas totales (Directiva UE 2019/1158
  // transpuesta por RD-ley 7/2024).
  parental_paid_8y: { unit: "weeks", value: 2 },
  parental_unpaid_8y: { unit: "weeks", value: 6 },
  parental_unpaid: { unit: "weeks", value: 0 }, // legacy, ya no se usa
  mudanza: { unit: "days", value: 1 },
  civic_duty: { unit: "days", value: 0 },
};
