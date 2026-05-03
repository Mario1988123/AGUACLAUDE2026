/**
 * Sugerencias de festivos por provincia. Curado parcialmente para 2026.
 * El admin puede aceptarlos uno a uno con addHolidayAction.
 */
export const REGION_HOLIDAYS_2026: Record<
  string,
  Array<{ date: string; name: string }>
> = {
  "ES-MD": [
    { date: "2026-05-02", name: "Día de la Comunidad de Madrid" },
    { date: "2026-05-15", name: "San Isidro" },
    { date: "2026-11-09", name: "Almudena" },
  ],
  "ES-CT": [
    { date: "2026-04-06", name: "Lunes de Pascua Granada" },
    { date: "2026-09-11", name: "Diada Nacional" },
    { date: "2026-09-24", name: "La Mercè" },
  ],
  "ES-VC": [
    { date: "2026-03-19", name: "San José" },
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-10-09", name: "Día Comunidad Valenciana" },
  ],
  "ES-AN": [
    { date: "2026-02-28", name: "Día de Andalucía" },
    { date: "2026-04-02", name: "Jueves Santo" },
  ],
  "ES-PV": [
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-07-25", name: "Santiago Apóstol" },
  ],
  "ES-GA": [{ date: "2026-07-25", name: "Día Nacional de Galicia" }],
};

export const REGION_LABELS: Record<string, string> = {
  "ES-MD": "Madrid",
  "ES-CT": "Cataluña",
  "ES-VC": "Comunidad Valenciana",
  "ES-AN": "Andalucía",
  "ES-PV": "País Vasco",
  "ES-GA": "Galicia",
  "ES-AS": "Asturias",
  "ES-CN": "Canarias",
  "ES-CB": "Cantabria",
  "ES-CL": "Castilla y León",
  "ES-CM": "Castilla-La Mancha",
  "ES-EX": "Extremadura",
  "ES-IB": "Baleares",
  "ES-RI": "La Rioja",
  "ES-MC": "Murcia",
  "ES-NA": "Navarra",
  "ES-AR": "Aragón",
  "ES-CE": "Ceuta",
  "ES-ML": "Melilla",
};
