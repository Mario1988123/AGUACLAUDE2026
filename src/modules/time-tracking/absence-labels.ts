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
  parental_unpaid: "permiso parental no remunerado",
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
  parental_unpaid: "Parental no remunerado",
  mudanza: "Mudanza",
  civic_duty: "Deber público",
};

/** Presupuesto legal por defecto en España 2026 para cada tipo. Lo usa
 *  el admin como sugerencia al inicializar a un empleado. */
export const DEFAULT_BUDGETS_2026: Record<
  AbsenceKind,
  { unit: "days" | "hours" | "weeks" | "months"; value: number }
> = {
  vacation: { unit: "days", value: 22 }, // ET Art. 38: mín 30 naturales ≈ 22 laborables
  sick: { unit: "days", value: 0 },
  personal: { unit: "days", value: 0 },
  training: { unit: "days", value: 0 },
  other: { unit: "days", value: 0 },
  paternity: { unit: "weeks", value: 16 }, // RD-ley 6/2019
  maternity: { unit: "weeks", value: 16 },
  marriage: { unit: "days", value: 15 }, // ET Art. 37.3
  bereavement: { unit: "days", value: 5 }, // RD-ley 5/2023
  lactation: { unit: "months", value: 9 },
  parental_unpaid: { unit: "weeks", value: 8 }, // Directiva UE 2019/1158
  mudanza: { unit: "days", value: 1 },
  civic_duty: { unit: "days", value: 0 },
};
