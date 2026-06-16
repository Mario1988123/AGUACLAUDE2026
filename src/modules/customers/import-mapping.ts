// Mapeo de columnas de la plantilla de importación → ImportCustomerRow.
// Módulo PLANO (sin "use server"/"use client"): lo usan el parser CSV del
// cliente y el parser XLSX del servidor, para que ambos produzcan lo mismo.

export interface ImportCustomerRow {
  party_kind: "individual" | "company";
  /** Nº de cliente del sistema antiguo (ej. "CL-121374"). Respetado + dedupe. */
  external_code?: string;
  legal_name?: string;
  trade_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_primary?: string;
  phone_secondary?: string;
  tax_id?: string;
  notes?: string;
  // Dirección (troceada)
  address_street_type?: string;
  address_street?: string;
  address_number?: string;
  address_portal?: string;
  address_floor?: string;
  address_door?: string;
  address_notes?: string;
  address_postal_code?: string;
  address_city?: string;
  address_province?: string;
  // Banco
  iban?: string;
  account_holder?: string;
  mandate_complete?: boolean;
  // Equipo (1 fila = 1 equipo)
  equipment_name?: string;
  equipment_brand?: string;
  serial_number?: string;
  installed_at?: string;
  maintenance_periodicity_months?: number | null;
  last_maintenance_at?: string;
  next_maintenance_at?: string;
  // Modalidad heredada (Fase 1: se guarda como dato en el equipo)
  acquisition_type?: "cash" | "rental" | "renting";
  acquisition_amount_eur?: number | null;
  acquisition_started_at?: string;
}

type Field = keyof ImportCustomerRow;

const HEADER_MAP: Record<string, Field> = {
  codigo: "external_code",
  codigo_cliente: "external_code",
  n_cliente: "external_code",
  external_code: "external_code",
  tipo: "party_kind",
  party_kind: "party_kind",
  razon_social: "legal_name",
  legal_name: "legal_name",
  empresa: "legal_name",
  nombre_comercial: "trade_name",
  trade_name: "trade_name",
  nombre: "first_name",
  first_name: "first_name",
  apellidos: "last_name",
  apellido: "last_name",
  last_name: "last_name",
  dni_cif: "tax_id",
  dni: "tax_id",
  cif: "tax_id",
  nif: "tax_id",
  tax_id: "tax_id",
  telefono_1: "phone_primary",
  telefono: "phone_primary",
  movil: "phone_primary",
  phone: "phone_primary",
  phone_primary: "phone_primary",
  telefono_2: "phone_secondary",
  telefono_secundario: "phone_secondary",
  phone_secondary: "phone_secondary",
  email: "email",
  e_mail: "email",
  correo: "email",
  tipo_via: "address_street_type",
  tipo_de_via: "address_street_type",
  via: "address_street_type",
  calle: "address_street",
  direccion: "address_street",
  address_street: "address_street",
  numero: "address_number",
  num: "address_number",
  portal: "address_portal",
  bloque: "address_portal",
  piso: "address_floor",
  planta: "address_floor",
  puerta: "address_door",
  resto_direccion: "address_notes",
  resto: "address_notes",
  cp: "address_postal_code",
  codigo_postal: "address_postal_code",
  cod_postal: "address_postal_code",
  poblacion: "address_city",
  ciudad: "address_city",
  localidad: "address_city",
  provincia: "address_province",
  titular: "account_holder",
  titular_iban: "account_holder",
  iban: "iban",
  cuenta: "iban",
  mandato_completo: "mandate_complete",
  mandato: "mandate_complete",
  equipo: "equipment_name",
  equipo_nombre: "equipment_name",
  modelo: "equipment_name",
  marca: "equipment_brand",
  equipo_marca: "equipment_brand",
  numero_serie: "serial_number",
  n_serie: "serial_number",
  serial: "serial_number",
  fecha_instalacion: "installed_at",
  instalado_el: "installed_at",
  ultimo_mantenimiento: "last_maintenance_at",
  proximo_mantenimiento: "next_maintenance_at",
  periodicidad_meses: "maintenance_periodicity_months",
  periodicidad: "maintenance_periodicity_months",
  plan: "acquisition_type",
  modalidad: "acquisition_type",
  importe_eur: "acquisition_amount_eur",
  importe: "acquisition_amount_eur",
  cuota: "acquisition_amount_eur",
  fecha_inicio: "acquisition_started_at",
  inicio: "acquisition_started_at",
  notas: "notes",
  notes: "notes",
  observaciones: "notes",
};

export function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Excel guarda fechas como nº de serie; lo pasamos a AAAA-MM-DD. Si ya es
 *  texto (2024-03-15 / 15/03/2024) lo dejamos tal cual. */
function normDate(v: string): string {
  const s = v.trim();
  if (!s) return "";
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 59 && serial < 80000) {
      const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  return s;
}

function parseEuro(v: string): number | null {
  const cleaned = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");
  const n = parseFloat(cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function applyField(row: ImportCustomerRow, key: Field, val: string): void {
  if (key === "party_kind") {
    const v = val.toLowerCase();
    row.party_kind = v === "company" || v === "empresa" ? "company" : "individual";
  } else if (key === "maintenance_periodicity_months") {
    const n = parseInt(val.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) row.maintenance_periodicity_months = n;
  } else if (key === "acquisition_type") {
    const v = val.toLowerCase();
    row.acquisition_type =
      v === "venta" || v === "cash" || v === "contado"
        ? "cash"
        : v === "renting"
          ? "renting"
          : v === "alquiler" || v === "rental"
            ? "rental"
            : undefined;
  } else if (key === "acquisition_amount_eur") {
    row.acquisition_amount_eur = parseEuro(val);
  } else if (key === "mandate_complete") {
    row.mandate_complete = /^(si|sí|s|yes|y|true|1|completo)$/i.test(val.trim());
  } else if (
    key === "installed_at" ||
    key === "last_maintenance_at" ||
    key === "next_maintenance_at" ||
    key === "acquisition_started_at"
  ) {
    const d = normDate(val);
    if (d) (row as unknown as Record<string, unknown>)[key] = d;
  } else {
    (row as unknown as Record<string, unknown>)[key] = val;
  }
}

/**
 * Mapea una cabecera + filas (matriz de strings) a ImportCustomerRow[].
 * Ignora columnas desconocidas (ej. cliente_original / direccion_original).
 */
export function mapSpreadsheetRows(
  headerRow: string[],
  dataRows: string[][],
): ImportCustomerRow[] {
  const keys = headerRow.map((h) => HEADER_MAP[normHeader(h)]);
  const out: ImportCustomerRow[] = [];
  for (const cols of dataRows) {
    if (!cols || cols.every((c) => !c || !String(c).trim())) continue;
    const row: ImportCustomerRow = { party_kind: "individual" };
    keys.forEach((key, j) => {
      if (!key) return;
      const raw = (cols[j] ?? "").toString().trim();
      if (!raw) return;
      applyField(row, key, raw);
    });
    out.push(row);
  }
  return out;
}
