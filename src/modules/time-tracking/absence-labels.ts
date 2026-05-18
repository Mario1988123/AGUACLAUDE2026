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
  // Permiso parental hasta los 8 años del menor (Directiva UE 2019/1158).
  // RD-ley 9/2025 reordena: las 2 semanas retribuidas pasan a formar
  // parte del permiso de nacimiento (Art. 48.4 ET, total 19 sem). Las
  // 6 semanas no retribuidas siguen como permiso independiente (Art.
  // 48 bis ET). Mantenemos ambos kinds para que el sistema separe el
  // disfrute fraccionado hasta 8 años del bloque inmediato post-parto.
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
 *  Cambios 2026 (RD-ley 9/2025, BOE 30/07/2025, en vigor 31/07/2025):
 *   - Art. 48.4 ET: permiso de nacimiento y cuidado de menor pasa de
 *     16 a **19 semanas** por progenitor. Estructura:
 *       · 6 semanas obligatorias e ininterrumpidas tras el parto
 *       · 11 semanas flexibles hasta los 12 meses del menor
 *       · 2 semanas flexibles hasta que el menor cumpla 8 años (las
 *         que antes estaban como permiso parental retribuido aparte)
 *     Total retribuido al 100% de la base reguladora.
 *   - Familias monoparentales: **32 semanas** (6 obligatorias + 22
 *     hasta 12m + 4 hasta 8 años). Aquí dejamos el budget biparental
 *     por defecto; admin sube a 32 si aplica.
 *   - Art. 48 bis ET: permiso parental no retribuido se queda en 6
 *     semanas (de las 8 originales, las 2 retribuidas pasaron al 48.4).
 *
 *  Estructura interna en el sistema:
 *   - paternity/maternity = 17 semanas (las que se gastan típicamente
 *     en el primer año post-parto: 6 obl + 11 flex hasta 12m).
 *   - parental_paid_8y = 2 semanas (las nuevas retribuidas hasta 8 años,
 *     incluidas en el cómputo total de 19 del Art. 48.4).
 *   - parental_unpaid_8y = 6 semanas (Art. 48 bis ET, sin sueldo).
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
  paternity: { unit: "weeks", value: 17 }, // RD-ley 9/2025: 6 obl + 11 flex hasta 12m
  maternity: { unit: "weeks", value: 17 },
  marriage: { unit: "days", value: 15 }, // ET Art. 37.3
  bereavement: { unit: "days", value: 5 }, // RD-ley 5/2023
  lactation: { unit: "months", value: 9 },
  // RD-ley 9/2025: las 2 sem retribuidas hasta 8 años se contabilizan
  // dentro del permiso de nacimiento (Art. 48.4 ET), pero el sistema
  // las separa para poder gestionar el disfrute fraccionado hasta 8
  // años con independencia de las 17 inmediatas post-parto.
  parental_paid_8y: { unit: "weeks", value: 2 },
  // Art. 48 bis ET: 6 sem no retribuidas hasta 8 años (antes 8 sem;
  // RD-ley 9/2025 transfirió 2 al permiso de nacimiento).
  parental_unpaid_8y: { unit: "weeks", value: 6 },
  parental_unpaid: { unit: "weeks", value: 0 }, // legacy, ya no se usa
  mudanza: { unit: "days", value: 1 },
  civic_duty: { unit: "days", value: 0 },
};
