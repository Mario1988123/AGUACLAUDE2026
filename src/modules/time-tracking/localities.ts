/**
 * Catálogo de provincias y ciudades de España con festivos locales
 * curados para 2026 (capitales de provincia + grandes ciudades).
 *
 * Para pueblos pequeños no listados, el admin añade los festivos a mano.
 *
 * Estructura:
 *  - PROVINCES: provincia ISO → label + lista de ciudades principales
 *  - LOCALITY_HOLIDAYS_2026: city_code → festivos del año
 *
 * Códigos de ciudad: ISO-prov + slug local, p.ej. "ES-V-VALENCIA".
 */

export interface Province {
  code: string; // "ES-M" Madrid, "ES-V" Valencia...
  name: string;
  ccaa: string; // ISO CCAA, ej "ES-MD" Madrid, "ES-VC" Valenciana
  cities: Array<{ code: string; name: string }>;
}

/** CCAA codes (ya existían en regions.ts). Repetimos aquí para tener
 *  un mapa cerrado del catálogo. */
export const CCAA_LABELS: Record<string, string> = {
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

export const PROVINCES: Province[] = [
  // ===== ANDALUCÍA =====
  { code: "ES-AL", name: "Almería", ccaa: "ES-AN", cities: [
    { code: "ES-AL-ALMERIA", name: "Almería" },
  ] },
  { code: "ES-CA", name: "Cádiz", ccaa: "ES-AN", cities: [
    { code: "ES-CA-CADIZ", name: "Cádiz" },
    { code: "ES-CA-JEREZ", name: "Jerez de la Frontera" },
    { code: "ES-CA-ALGECIRAS", name: "Algeciras" },
  ] },
  { code: "ES-CO", name: "Córdoba", ccaa: "ES-AN", cities: [
    { code: "ES-CO-CORDOBA", name: "Córdoba" },
  ] },
  { code: "ES-GR", name: "Granada", ccaa: "ES-AN", cities: [
    { code: "ES-GR-GRANADA", name: "Granada" },
  ] },
  { code: "ES-H", name: "Huelva", ccaa: "ES-AN", cities: [
    { code: "ES-H-HUELVA", name: "Huelva" },
  ] },
  { code: "ES-J", name: "Jaén", ccaa: "ES-AN", cities: [
    { code: "ES-J-JAEN", name: "Jaén" },
  ] },
  { code: "ES-MA", name: "Málaga", ccaa: "ES-AN", cities: [
    { code: "ES-MA-MALAGA", name: "Málaga" },
    { code: "ES-MA-MARBELLA", name: "Marbella" },
  ] },
  { code: "ES-SE", name: "Sevilla", ccaa: "ES-AN", cities: [
    { code: "ES-SE-SEVILLA", name: "Sevilla" },
    { code: "ES-SE-DOSHERMANAS", name: "Dos Hermanas" },
  ] },

  // ===== ARAGÓN =====
  { code: "ES-HU", name: "Huesca", ccaa: "ES-AR", cities: [
    { code: "ES-HU-HUESCA", name: "Huesca" },
  ] },
  { code: "ES-TE", name: "Teruel", ccaa: "ES-AR", cities: [
    { code: "ES-TE-TERUEL", name: "Teruel" },
  ] },
  { code: "ES-Z", name: "Zaragoza", ccaa: "ES-AR", cities: [
    { code: "ES-Z-ZARAGOZA", name: "Zaragoza" },
  ] },

  // ===== ASTURIAS =====
  { code: "ES-O", name: "Asturias", ccaa: "ES-AS", cities: [
    { code: "ES-O-OVIEDO", name: "Oviedo" },
    { code: "ES-O-GIJON", name: "Gijón" },
    { code: "ES-O-AVILES", name: "Avilés" },
  ] },

  // ===== BALEARES =====
  { code: "ES-PM", name: "Baleares", ccaa: "ES-IB", cities: [
    { code: "ES-PM-PALMA", name: "Palma de Mallorca" },
    { code: "ES-PM-IBIZA", name: "Ibiza" },
  ] },

  // ===== CANARIAS =====
  { code: "ES-GC", name: "Las Palmas", ccaa: "ES-CN", cities: [
    { code: "ES-GC-LASPALMAS", name: "Las Palmas de Gran Canaria" },
  ] },
  { code: "ES-TF", name: "Santa Cruz de Tenerife", ccaa: "ES-CN", cities: [
    { code: "ES-TF-SANTACRUZ", name: "Santa Cruz de Tenerife" },
    { code: "ES-TF-LALAGUNA", name: "San Cristóbal de La Laguna" },
  ] },

  // ===== CANTABRIA =====
  { code: "ES-S", name: "Cantabria", ccaa: "ES-CB", cities: [
    { code: "ES-S-SANTANDER", name: "Santander" },
  ] },

  // ===== CASTILLA Y LEÓN =====
  { code: "ES-AV", name: "Ávila", ccaa: "ES-CL", cities: [
    { code: "ES-AV-AVILA", name: "Ávila" },
  ] },
  { code: "ES-BU", name: "Burgos", ccaa: "ES-CL", cities: [
    { code: "ES-BU-BURGOS", name: "Burgos" },
  ] },
  { code: "ES-LE", name: "León", ccaa: "ES-CL", cities: [
    { code: "ES-LE-LEON", name: "León" },
  ] },
  { code: "ES-P", name: "Palencia", ccaa: "ES-CL", cities: [
    { code: "ES-P-PALENCIA", name: "Palencia" },
  ] },
  { code: "ES-SA", name: "Salamanca", ccaa: "ES-CL", cities: [
    { code: "ES-SA-SALAMANCA", name: "Salamanca" },
  ] },
  { code: "ES-SG", name: "Segovia", ccaa: "ES-CL", cities: [
    { code: "ES-SG-SEGOVIA", name: "Segovia" },
  ] },
  { code: "ES-SO", name: "Soria", ccaa: "ES-CL", cities: [
    { code: "ES-SO-SORIA", name: "Soria" },
  ] },
  { code: "ES-VA", name: "Valladolid", ccaa: "ES-CL", cities: [
    { code: "ES-VA-VALLADOLID", name: "Valladolid" },
  ] },
  { code: "ES-ZA", name: "Zamora", ccaa: "ES-CL", cities: [
    { code: "ES-ZA-ZAMORA", name: "Zamora" },
  ] },

  // ===== CASTILLA-LA MANCHA =====
  { code: "ES-AB", name: "Albacete", ccaa: "ES-CM", cities: [
    { code: "ES-AB-ALBACETE", name: "Albacete" },
  ] },
  { code: "ES-CR", name: "Ciudad Real", ccaa: "ES-CM", cities: [
    { code: "ES-CR-CIUDADREAL", name: "Ciudad Real" },
  ] },
  { code: "ES-CU", name: "Cuenca", ccaa: "ES-CM", cities: [
    { code: "ES-CU-CUENCA", name: "Cuenca" },
  ] },
  { code: "ES-GU", name: "Guadalajara", ccaa: "ES-CM", cities: [
    { code: "ES-GU-GUADALAJARA", name: "Guadalajara" },
  ] },
  { code: "ES-TO", name: "Toledo", ccaa: "ES-CM", cities: [
    { code: "ES-TO-TOLEDO", name: "Toledo" },
    { code: "ES-TO-TALAVERA", name: "Talavera de la Reina" },
  ] },

  // ===== CATALUÑA =====
  { code: "ES-B", name: "Barcelona", ccaa: "ES-CT", cities: [
    { code: "ES-B-BARCELONA", name: "Barcelona" },
    { code: "ES-B-HOSPITALET", name: "L'Hospitalet de Llobregat" },
    { code: "ES-B-BADALONA", name: "Badalona" },
    { code: "ES-B-SABADELL", name: "Sabadell" },
    { code: "ES-B-TERRASSA", name: "Terrassa" },
    { code: "ES-B-MATARO", name: "Mataró" },
  ] },
  { code: "ES-GI", name: "Girona", ccaa: "ES-CT", cities: [
    { code: "ES-GI-GIRONA", name: "Girona" },
  ] },
  { code: "ES-L", name: "Lleida", ccaa: "ES-CT", cities: [
    { code: "ES-L-LLEIDA", name: "Lleida" },
  ] },
  { code: "ES-T", name: "Tarragona", ccaa: "ES-CT", cities: [
    { code: "ES-T-TARRAGONA", name: "Tarragona" },
    { code: "ES-T-REUS", name: "Reus" },
  ] },

  // ===== COMUNIDAD VALENCIANA =====
  { code: "ES-A", name: "Alicante", ccaa: "ES-VC", cities: [
    { code: "ES-A-ALICANTE", name: "Alicante" },
    { code: "ES-A-ELCHE", name: "Elche" },
    { code: "ES-A-BENIDORM", name: "Benidorm" },
  ] },
  { code: "ES-CS", name: "Castellón", ccaa: "ES-VC", cities: [
    { code: "ES-CS-CASTELLON", name: "Castellón de la Plana" },
  ] },
  { code: "ES-V", name: "Valencia", ccaa: "ES-VC", cities: [
    { code: "ES-V-VALENCIA", name: "Valencia" },
    { code: "ES-V-GANDIA", name: "Gandía" },
    { code: "ES-V-TORRENT", name: "Torrent" },
    { code: "ES-V-PATERNA", name: "Paterna" },
  ] },

  // ===== EXTREMADURA =====
  { code: "ES-BA", name: "Badajoz", ccaa: "ES-EX", cities: [
    { code: "ES-BA-BADAJOZ", name: "Badajoz" },
    { code: "ES-BA-MERIDA", name: "Mérida" },
  ] },
  { code: "ES-CC", name: "Cáceres", ccaa: "ES-EX", cities: [
    { code: "ES-CC-CACERES", name: "Cáceres" },
  ] },

  // ===== GALICIA =====
  { code: "ES-C", name: "A Coruña", ccaa: "ES-GA", cities: [
    { code: "ES-C-CORUNA", name: "A Coruña" },
    { code: "ES-C-SANTIAGO", name: "Santiago de Compostela" },
    { code: "ES-C-FERROL", name: "Ferrol" },
  ] },
  { code: "ES-LU", name: "Lugo", ccaa: "ES-GA", cities: [
    { code: "ES-LU-LUGO", name: "Lugo" },
  ] },
  { code: "ES-OR", name: "Ourense", ccaa: "ES-GA", cities: [
    { code: "ES-OR-OURENSE", name: "Ourense" },
  ] },
  { code: "ES-PO", name: "Pontevedra", ccaa: "ES-GA", cities: [
    { code: "ES-PO-PONTEVEDRA", name: "Pontevedra" },
    { code: "ES-PO-VIGO", name: "Vigo" },
  ] },

  // ===== LA RIOJA =====
  { code: "ES-LO", name: "La Rioja", ccaa: "ES-RI", cities: [
    { code: "ES-LO-LOGRONO", name: "Logroño" },
  ] },

  // ===== MADRID =====
  { code: "ES-M", name: "Madrid", ccaa: "ES-MD", cities: [
    { code: "ES-M-MADRID", name: "Madrid" },
    { code: "ES-M-MOSTOLES", name: "Móstoles" },
    { code: "ES-M-ALCALA", name: "Alcalá de Henares" },
    { code: "ES-M-FUENLABRADA", name: "Fuenlabrada" },
    { code: "ES-M-LEGANES", name: "Leganés" },
    { code: "ES-M-GETAFE", name: "Getafe" },
    { code: "ES-M-ALCORCON", name: "Alcorcón" },
  ] },

  // ===== MURCIA =====
  { code: "ES-MU", name: "Murcia", ccaa: "ES-MC", cities: [
    { code: "ES-MU-MURCIA", name: "Murcia" },
    { code: "ES-MU-CARTAGENA", name: "Cartagena" },
    { code: "ES-MU-LORCA", name: "Lorca" },
  ] },

  // ===== NAVARRA =====
  { code: "ES-NA-PROV", name: "Navarra", ccaa: "ES-NA", cities: [
    { code: "ES-NA-PAMPLONA", name: "Pamplona" },
  ] },

  // ===== PAÍS VASCO =====
  { code: "ES-VI", name: "Álava", ccaa: "ES-PV", cities: [
    { code: "ES-VI-VITORIA", name: "Vitoria-Gasteiz" },
  ] },
  { code: "ES-BI", name: "Vizcaya", ccaa: "ES-PV", cities: [
    { code: "ES-BI-BILBAO", name: "Bilbao" },
    { code: "ES-BI-BARAKALDO", name: "Barakaldo" },
  ] },
  { code: "ES-SS", name: "Guipúzcoa", ccaa: "ES-PV", cities: [
    { code: "ES-SS-DONOSTIA", name: "Donostia / San Sebastián" },
  ] },

  // ===== CEUTA Y MELILLA =====
  { code: "ES-CE-PROV", name: "Ceuta", ccaa: "ES-CE", cities: [
    { code: "ES-CE-CEUTA", name: "Ceuta" },
  ] },
  { code: "ES-ML-PROV", name: "Melilla", ccaa: "ES-ML", cities: [
    { code: "ES-ML-MELILLA", name: "Melilla" },
  ] },
];

/**
 * Festivos autonómicos + locales 2026, curados.
 * Combinan CCAA + ciudad. Si seleccionas "Valencia ciudad" se le añaden
 * a los nacionales: festivos autonómicos VC + festivos locales de Valencia.
 *
 * Fuentes: BOE 11-10-2025 (calendario laboral 2026), ordenanzas locales.
 * Para fiestas con fecha variable (Semana Santa, Pascua) se usa la fecha
 * concreta de 2026.
 */
export const LOCALITY_HOLIDAYS_2026: Record<
  string,
  Array<{ date: string; name: string }>
> = {
  // ===== CCAA (festivos autonómicos comunes a toda la comunidad) =====
  "ES-MD": [
    { date: "2026-05-02", name: "Día de la Comunidad de Madrid" },
  ],
  "ES-CT": [
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-06-24", name: "San Juan" },
    { date: "2026-09-11", name: "Diada Nacional de Cataluña" },
    { date: "2026-12-26", name: "San Esteban" },
  ],
  "ES-VC": [
    { date: "2026-03-19", name: "San José" },
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-10-09", name: "Día de la Comunidad Valenciana" },
  ],
  "ES-AN": [
    { date: "2026-02-28", name: "Día de Andalucía" },
    { date: "2026-04-02", name: "Jueves Santo" },
  ],
  "ES-PV": [
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-07-25", name: "Santiago Apóstol" },
  ],
  "ES-GA": [
    { date: "2026-07-25", name: "Día Nacional de Galicia" },
    { date: "2026-04-02", name: "Jueves Santo" },
  ],
  "ES-AS": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-09-08", name: "Día de Asturias" },
  ],
  "ES-CN": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-05-30", name: "Día de Canarias" },
  ],
  "ES-CB": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-07-28", name: "Día de las Instituciones de Cantabria" },
    { date: "2026-09-15", name: "Día de Cantabria" },
  ],
  "ES-CL": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-04-23", name: "Día de Castilla y León" },
  ],
  "ES-CM": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-05-31", name: "Día de Castilla-La Mancha" },
    { date: "2026-06-04", name: "Corpus Christi" },
  ],
  "ES-EX": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-09-08", name: "Día de Extremadura" },
  ],
  "ES-IB": [
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-03-01", name: "Día de las Islas Baleares" },
  ],
  "ES-RI": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-06-09", name: "Día de La Rioja" },
  ],
  "ES-MC": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-06-09", name: "Día de la Región de Murcia" },
  ],
  "ES-NA": [
    { date: "2026-04-06", name: "Lunes de Pascua" },
    { date: "2026-07-25", name: "Santiago Apóstol" },
  ],
  "ES-AR": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-04-23", name: "San Jorge — Día de Aragón" },
  ],
  "ES-CE": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-06-17", name: "Pascua del Sacrificio" },
    { date: "2026-09-05", name: "Día de Ceuta" },
  ],
  "ES-ML": [
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-06-17", name: "Pascua del Sacrificio" },
    { date: "2026-09-17", name: "Día de Melilla" },
  ],

  // ===== CIUDADES (festivos locales propios) =====
  "ES-M-MADRID": [
    { date: "2026-05-15", name: "San Isidro" },
    { date: "2026-11-09", name: "Almudena" },
  ],
  "ES-B-BARCELONA": [
    { date: "2026-09-24", name: "La Mercè" },
    { date: "2026-09-21", name: "Lunes Mercè (puente)" },
  ],
  "ES-V-VALENCIA": [
    { date: "2026-03-19", name: "San José (Fallas)" },
    { date: "2026-04-27", name: "San Vicente Ferrer" },
  ],
  "ES-SE-SEVILLA": [
    { date: "2026-05-28", name: "Corpus Christi" },
    { date: "2026-04-13", name: "Lunes de Feria" },
  ],
  "ES-MA-MALAGA": [
    { date: "2026-08-19", name: "Feria de Málaga" },
    { date: "2026-09-08", name: "Virgen de la Victoria" },
  ],
  "ES-Z-ZARAGOZA": [
    { date: "2026-10-13", name: "Lunes Pilar" },
    { date: "2026-01-29", name: "San Valero" },
  ],
  "ES-PM-PALMA": [
    { date: "2026-01-20", name: "San Sebastián" },
    { date: "2026-06-29", name: "San Pedro" },
  ],
  "ES-BI-BILBAO": [
    { date: "2026-08-25", name: "Aste Nagusia — Semana Grande" },
  ],
  "ES-O-OVIEDO": [
    { date: "2026-09-21", name: "San Mateo" },
  ],
  "ES-O-GIJON": [
    { date: "2026-08-15", name: "Begoña (trasladado)" },
  ],
  "ES-VI-VITORIA": [
    { date: "2026-08-05", name: "Virgen Blanca" },
  ],
  "ES-SS-DONOSTIA": [
    { date: "2026-01-20", name: "San Sebastián" },
  ],
  "ES-MU-MURCIA": [
    { date: "2026-04-14", name: "Bando de la Huerta" },
    { date: "2026-09-08", name: "Día de la Fuensanta" },
  ],
  "ES-MU-CARTAGENA": [
    { date: "2026-09-25", name: "Cartagineses y Romanos" },
  ],
  "ES-A-ALICANTE": [
    { date: "2026-06-24", name: "San Juan / Hogueras" },
  ],
  "ES-CS-CASTELLON": [
    { date: "2026-03-21", name: "Magdalena" },
  ],
  "ES-GC-LASPALMAS": [
    { date: "2026-05-30", name: "Día de Canarias" },
  ],
  "ES-TF-SANTACRUZ": [
    { date: "2026-02-13", name: "Carnaval — Lunes" },
  ],
  "ES-S-SANTANDER": [
    { date: "2026-07-25", name: "Santiago Apóstol" },
  ],
  "ES-VA-VALLADOLID": [
    { date: "2026-09-08", name: "Virgen de San Lorenzo" },
  ],
  "ES-SA-SALAMANCA": [
    { date: "2026-06-12", name: "Lunes de Aguas" },
  ],
  "ES-LE-LEON": [
    { date: "2026-06-24", name: "San Juan y San Pedro" },
  ],
  "ES-BU-BURGOS": [
    { date: "2026-06-29", name: "San Pedro y San Pablo" },
  ],
  "ES-LO-LOGRONO": [
    { date: "2026-06-11", name: "San Bernabé" },
  ],
  "ES-TO-TOLEDO": [
    { date: "2026-06-04", name: "Corpus Christi" },
  ],
  "ES-C-CORUNA": [
    { date: "2026-08-16", name: "San Roque" },
  ],
  "ES-C-SANTIAGO": [
    { date: "2026-07-25", name: "Día Nacional de Galicia" },
  ],
  "ES-PO-VIGO": [
    { date: "2026-03-28", name: "Reconquista de Vigo" },
  ],
  // Resto de capitales sin festivos locales curados — el admin las
  // añade a mano. Quedan solo los festivos nacionales + autonómicos.
};

/** Devuelve los festivos sugeridos combinando CCAA + ciudad (si se
 *  seleccionó una). Los nacionales NO se incluyen aquí — esos vienen
 *  ya cargados en la BD por la migración seed. */
export function suggestedHolidaysFor(
  ccaa: string | null,
  cityCode: string | null,
): Array<{ date: string; name: string }> {
  const out: Array<{ date: string; name: string }> = [];
  if (ccaa && LOCALITY_HOLIDAYS_2026[ccaa]) {
    out.push(...LOCALITY_HOLIDAYS_2026[ccaa]);
  }
  if (cityCode && LOCALITY_HOLIDAYS_2026[cityCode]) {
    out.push(...LOCALITY_HOLIDAYS_2026[cityCode]);
  }
  // Dedup por fecha (puede repetirse "Jueves Santo" si CCAA + ciudad
  // ambos lo declaran).
  const seen = new Set<string>();
  return out.filter((h) => {
    const key = `${h.date}::${h.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Para el selector: lista plana de provincias agrupadas por CCAA. */
export function provincesByCCAA(): Array<{ ccaa: string; provinces: Province[] }> {
  const grouped = new Map<string, Province[]>();
  for (const p of PROVINCES) {
    if (!grouped.has(p.ccaa)) grouped.set(p.ccaa, []);
    grouped.get(p.ccaa)!.push(p);
  }
  return Array.from(grouped.entries()).map(([ccaa, provinces]) => ({
    ccaa,
    provinces,
  }));
}
