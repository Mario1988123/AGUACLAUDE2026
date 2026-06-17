"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { normalizeSpanishPhone } from "@/shared/lib/validations/spanish";
import { addCustomerEquipmentAction } from "./equipment-actions";
import {
  mapSpreadsheetRows,
  normHeader,
  type ImportCustomerRow,
} from "./import-mapping";
import { readXlsxRows } from "@/shared/lib/xlsx/read-xlsx";

export type { ImportCustomerRow };

export interface ImportResult {
  inserted: number; // clientes nuevos creados
  updated: number; // clientes existentes completados (match por código/DNI/email/tel)
  equipment: number; // equipos creados
  banks: number; // cuentas bancarias creadas
  duplicates: number; // (compat) reservado
  errors: Array<{ row: number; message: string }>;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** ¿Está vacío? (null/undefined o solo espacios). Para "rellenar solo huecos". */
function isBlank(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/**
 * Importa clientes del CRM antiguo CON histórico: datos + dirección + equipo(s)
 * + mantenimientos. Formato: 1 fila por EQUIPO; varias filas con el mismo
 * DNI/email/teléfono se agrupan como un solo cliente con varios equipos.
 * Dedupe contra clientes/leads existentes (phone/email/tax_id) → se ignoran.
 */
/** Rellena los huecos de `target` con los valores no vacíos de `src`. */
function mergeRowInto(target: ImportCustomerRow, src: ImportCustomerRow): void {
  const t = target as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null || v === "") continue;
    const cur = t[k];
    if (cur === undefined || cur === null || cur === "") {
      t[k] = v;
    }
  }
}

/**
 * Mapea el tipo de vía (texto libre, posible catalán/mayúsculas) al ENUM
 * app.street_type ('calle','avenida','plaza','camino','carretera',
 * 'urbanizacion','paseo','ronda','travesia','glorieta','poligono','via','otra').
 * Devuelve null si no hay tipo (la columna tiene default 'calle'). CRÍTICO:
 * meter un valor que no esté en el enum hace fallar el INSERT de la dirección.
 */
function toStreetTypeEnum(label?: string | null): string | null {
  if (!label) return null;
  const s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (/^(calle|carrer|c\/|c\b)/.test(s)) return "calle";
  if (/^(aveni|avingu|avda|av)/.test(s)) return "avenida";
  if (/^(paseo|passeig|pº)/.test(s)) return "paseo";
  if (/^(plaza|placa|plaça|pza|plz)/.test(s)) return "plaza";
  if (/^(camino|cami|camí)/.test(s)) return "camino";
  if (/^(carretera|ctra|crta)/.test(s)) return "carretera";
  if (/^ronda/.test(s)) return "ronda";
  if (/^traves/.test(s)) return "travesia";
  if (/^urban/.test(s)) return "urbanizacion";
  if (/^(poligono|pol)/.test(s)) return "poligono";
  if (/^glorieta/.test(s)) return "glorieta";
  if (/^via/.test(s)) return "via";
  return "otra";
}

export async function importCustomersAction(rows: ImportCustomerRow[]): Promise<ImportResult> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo admin o director puede importar");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const result: ImportResult = { inserted: 0, updated: 0, equipment: 0, banks: 0, duplicates: 0, errors: [] };

  // 1) Agrupar filas por cliente: clave external_code || tax_id || email || phone || idx.
  //    Varias filas con la misma clave = un cliente con varios equipos.
  type Group = { keyRow: ImportCustomerRow; firstIdx: number; equipmentRows: Array<{ r: ImportCustomerRow; idx: number }> };
  const groups = new Map<string, Group>();
  rows.forEach((r, idx) => {
    const key =
      (r.external_code && `c:${norm(r.external_code)}`) ||
      (r.tax_id && `t:${norm(r.tax_id)}`) ||
      (r.email && `e:${norm(r.email)}`) ||
      (r.phone_primary && `p:${(normalizeSpanishPhone(r.phone_primary) ?? r.phone_primary).trim()}`) ||
      `i:${idx}`;
    let g = groups.get(key);
    if (!g) {
      g = { keyRow: { ...r }, firstIdx: idx, equipmentRows: [] };
      groups.set(key, g);
    } else {
      mergeRowInto(g.keyRow, r);
    }
    if (r.equipment_name?.trim()) g.equipmentRows.push({ r, idx });
  });

  // 2) Catálogo de productos propios para emparejar equipo por nombre.
  const { data: prods } = await admin
    .from("products")
    .select("id, name")
    .eq("company_id", session.company_id);
  const productByName = new Map<string, string>();
  for (const p of (prods ?? []) as Array<{ id: string; name: string }>) {
    productByName.set(norm(p.name), p.id);
  }

  // Busca un cliente existente de la empresa por una columna concreta.
  const findExisting = async (col: string, val: string | null): Promise<string | null> => {
    if (!val) return null;
    const { data } = await admin
      .from("customers")
      .select("id")
      .eq("company_id", session.company_id)
      .eq(col, val)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };

  // 3) Procesar cada grupo (cliente).
  for (const g of groups.values()) {
    const r = g.keyRow;
    const rowNum = g.firstIdx + 1;
    try {
      if (r.party_kind === "company" && !r.legal_name?.trim() && !r.trade_name?.trim()) {
        result.errors.push({ row: rowNum, message: "Razón social o nombre comercial obligatorio para empresas" });
        continue;
      }
      if (r.party_kind === "individual" && !r.first_name?.trim()) {
        result.errors.push({ row: rowNum, message: "Nombre obligatorio para particulares" });
        continue;
      }
      const phoneNorm = r.phone_primary ? normalizeSpanishPhone(r.phone_primary) ?? r.phone_primary.trim() : null;
      const emailNorm = r.email?.trim().toLowerCase() ?? null;
      const taxNorm = r.tax_id?.trim().toUpperCase() ?? null;
      const codeNorm = r.external_code?.trim() ?? null;

      // UPSERT: ¿existe ya? Si la fila trae CÓDIGO (caso normal de la plantilla)
      // casamos SOLO por código (es único). NO caemos a email/teléfono porque
      // hay placeholders compartidos (notiene@gmail.com, teléfonos repetidos…)
      // que fusionarían por error clientes DISTINTOS. Sin código, usamos
      // DNI/email/teléfono como antes.
      let customerId: string | null = null;
      if (codeNorm) {
        customerId = await findExisting("external_code", codeNorm);
      } else {
        customerId =
          (await findExisting("tax_id", taxNorm)) ??
          (await findExisting("email", emailNorm)) ??
          (await findExisting("phone_primary", phoneNorm));
      }

      if (customerId) {
        result.updated += 1;
        // REGLA (Mario 2026-06-17): la reimportación NO pisa lo editado en el CRM.
        // Solo RELLENA huecos: si un campo ya tiene valor (sea el original del
        // Excel o uno corregido a mano) se respeta. Excepción: party_kind se
        // PROMOCIONA a empresa (nunca al revés) para sanar imports antiguos en
        // los que una empresa quedó como particular.
        const { data: curRow } = await admin
          .from("customers")
          .select(
            "party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, phone_secondary, tax_id, external_code, notes",
          )
          .eq("id", customerId)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cur = (curRow ?? {}) as any;
        const patch: Record<string, unknown> = {};
        if (r.party_kind === "company" && cur.party_kind !== "company")
          patch.party_kind = "company";
        if (r.legal_name && isBlank(cur.legal_name)) patch.legal_name = r.legal_name;
        if (r.trade_name && isBlank(cur.trade_name)) patch.trade_name = r.trade_name;
        if (r.first_name && isBlank(cur.first_name)) patch.first_name = r.first_name;
        if (r.last_name && isBlank(cur.last_name)) patch.last_name = r.last_name;
        if (emailNorm && isBlank(cur.email)) patch.email = emailNorm;
        if (phoneNorm && isBlank(cur.phone_primary)) patch.phone_primary = phoneNorm;
        if (r.phone_secondary && isBlank(cur.phone_secondary))
          patch.phone_secondary = r.phone_secondary;
        if (taxNorm && isBlank(cur.tax_id)) patch.tax_id = taxNorm;
        if (codeNorm && isBlank(cur.external_code)) patch.external_code = codeNorm;
        if (r.notes && isBlank(cur.notes)) patch.notes = r.notes;
        if (Object.keys(patch).length > 0) {
          let up = await admin
            .from("customers")
            .update(patch)
            .eq("id", customerId)
            .eq("company_id", session.company_id);
          if (up.error && /external_code|schema cache|Could not find/i.test(up.error.message ?? "")) {
            delete patch.external_code;
            up = await admin
              .from("customers")
              .update(patch)
              .eq("id", customerId)
              .eq("company_id", session.company_id);
          }
          if (up.error) console.error("[import] customer update:", up.error.message);
        }
        // REGLA: un cliente importado debe tener dueño. Si quedó sin comercial
        // asignado (imports antiguos), se lo ponemos al admin/director que
        // importa, SIN pisar una asignación previa (.is null) para no robar
        // carteras ya repartidas.
        const owned = await admin
          .from("customers")
          .update({ assigned_user_id: session.user_id, assigned_at: new Date().toISOString() })
          .eq("id", customerId)
          .eq("company_id", session.company_id)
          .is("assigned_user_id", null);
        if (owned.error) console.error("[import] customer assign:", owned.error.message);
      } else {
        const payload: Record<string, unknown> = {
          company_id: session.company_id,
          party_kind: r.party_kind,
          external_code: codeNorm,
          legal_name: r.legal_name || null,
          trade_name: r.trade_name || null,
          first_name: r.first_name || null,
          last_name: r.last_name || null,
          email: emailNorm,
          phone_primary: phoneNorm,
          phone_secondary: r.phone_secondary || null,
          tax_id: taxNorm,
          notes: r.notes || null,
          is_active: true,
          // REGLA: imported nace con dueño = quien importa (admin/director).
          assigned_user_id: session.user_id,
          assigned_at: new Date().toISOString(),
          created_by: session.user_id,
        };
        let ins = await admin.from("customers").insert(payload).select("id").single();
        if (ins.error && /external_code|schema cache|Could not find/i.test(ins.error.message ?? "")) {
          delete payload.external_code;
          ins = await admin.from("customers").insert(payload).select("id").single();
        }
        if (ins.error || !ins.data) {
          result.errors.push({ row: rowNum, message: ins.error?.message ?? "No se pudo crear el cliente" });
          continue;
        }
        customerId = (ins.data as { id: string }).id;
        result.inserted += 1;
      }

      // Dirección: si el cliente ya tiene una, la reutilizamos (no duplicar al
      // reimportar). Si no tiene y hay datos, la creamos troceada.
      let addressId: string | null = null;
      const { data: existAddr } = await admin
        .from("addresses")
        .select(
          "id, street, street_number, portal, floor, door, postal_code, city, province",
        )
        .eq("customer_id", customerId)
        .limit(1);
      if ((existAddr ?? []).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ea = existAddr[0] as any;
        addressId = ea.id as string;
        // REGLA: la reimportación SOLO rellena huecos de la dirección; NO pisa lo
        // editado en el CRM (p. ej. si corriges el número de la calle, se queda).
        const ap: Record<string, unknown> = {};
        if (r.address_street?.trim() && isBlank(ea.street)) ap.street = r.address_street.trim();
        if (r.address_number?.trim() && isBlank(ea.street_number))
          ap.street_number = r.address_number.trim();
        if (r.address_portal?.trim() && isBlank(ea.portal)) ap.portal = r.address_portal.trim();
        if (r.address_floor?.trim() && isBlank(ea.floor)) ap.floor = r.address_floor.trim();
        if (r.address_door?.trim() && isBlank(ea.door)) ap.door = r.address_door.trim();
        if (r.address_postal_code?.trim() && isBlank(ea.postal_code))
          ap.postal_code = r.address_postal_code.trim();
        if (r.address_city?.trim() && isBlank(ea.city)) ap.city = r.address_city.trim();
        if (r.address_province?.trim() && isBlank(ea.province))
          ap.province = r.address_province.trim();
        if (Object.keys(ap).length > 0) {
          const uA = await admin
            .from("addresses")
            .update(ap)
            .eq("id", addressId)
            .eq("company_id", session.company_id);
          if (uA.error) console.error("[import] address update:", uA.error.message);
        }
      } else if (
        r.address_street?.trim() ||
        r.address_city?.trim() ||
        r.address_notes?.trim()
      ) {
        // street es NOT NULL → garantizamos contenido. street_type es un ENUM
        // (calle/avenida/...) → lo mapeamos; meter "Carrer"/"Calle" en mayúscula
        // o catalán hacía fallar el INSERT en silencio (direcciones perdidas).
        const streetSafe =
          r.address_street?.trim() ||
          [r.address_street_type, r.address_number].filter(Boolean).join(" ").trim() ||
          r.address_notes?.trim() ||
          "Dirección importada";
        const stEnum = toStreetTypeEnum(r.address_street_type);
        const addrPayload: Record<string, unknown> = {
          company_id: session.company_id,
          customer_id: customerId,
          label: "Importada",
          is_primary: true,
          street: streetSafe,
          street_number: r.address_number?.trim() || null,
          portal: r.address_portal?.trim() || null,
          floor: r.address_floor?.trim() || null,
          door: r.address_door?.trim() || null,
          postal_code: r.address_postal_code?.trim() || null,
          city: r.address_city?.trim() || null,
          province: r.address_province?.trim() || null,
          notes: r.address_notes?.trim() || null,
        };
        if (stEnum) addrPayload.street_type = stEnum;
        let addrRes = await admin.from("addresses").insert(addrPayload).select("id").maybeSingle();
        if (addrRes.error) {
          // Defensa ROBUSTA: ante CUALQUIER fallo (columna ausente, enum, etc.)
          // reintentamos lo mínimo seguro: todo junto en street + cp/ciudad/prov,
          // sin street_type (usa el default 'calle'). Y dejamos de fallar mudo.
          addrRes = await admin
            .from("addresses")
            .insert({
              company_id: session.company_id,
              customer_id: customerId,
              label: "Importada",
              is_primary: true,
              street:
                [r.address_street_type, r.address_street, r.address_number]
                  .filter(Boolean)
                  .join(" ")
                  .trim() || streetSafe,
              postal_code: r.address_postal_code?.trim() || null,
              city: r.address_city?.trim() || null,
              province: r.address_province?.trim() || null,
            })
            .select("id")
            .maybeSingle();
          if (addrRes.error) console.error("[import] address insert:", addrRes.error.message);
        }
        addressId = (addrRes.data as { id: string } | null)?.id ?? null;
      }

      // Banco: si hay IBAN y no existe ya esa cuenta en el cliente.
      if (r.iban?.trim()) {
        const ibanClean = r.iban.replace(/\s+/g, "").toUpperCase();
        if (ibanClean.length >= 15 && ibanClean.length <= 34) {
          const { data: existBank } = await admin
            .from("customer_bank_accounts")
            .select("id")
            .eq("customer_id", customerId)
            .eq("iban", ibanClean)
            .limit(1);
          if ((existBank ?? []).length === 0) {
            const { error: bErr } = await admin.from("customer_bank_accounts").insert({
              company_id: session.company_id,
              customer_id: customerId,
              account_holder_name: r.account_holder?.trim() || null,
              iban: ibanClean,
              is_primary: true,
              is_validated: !!r.mandate_complete,
            });
            if (!bErr) result.banks += 1;
          }
        }
      }

      // Equipos del cliente (evitando duplicar al reimportar por nº de serie).
      const { data: existEq } = await admin
        .from("customer_equipment")
        .select("serial_number")
        .eq("customer_id", customerId);
      const existSerials = new Set(
        ((existEq ?? []) as Array<{ serial_number: string | null }>)
          .map((e) => (e.serial_number ?? "").trim().toUpperCase())
          .filter(Boolean),
      );
      for (const { r: er } of g.equipmentRows) {
        const name = er.equipment_name!.trim();
        const serial = er.serial_number?.trim() ?? "";
        if (serial && existSerials.has(serial.toUpperCase())) {
          // REGLA: el equipo ya existe (por nº serie). NO se pisa la modalidad
          // editada en el CRM: solo se RELLENAN los campos de modalidad vacíos.
          if (er.acquisition_type || er.acquisition_amount_eur != null || er.acquisition_started_at) {
            try {
              const { data: curEq } = await admin
                .from("customer_equipment")
                .select("acquisition_type, acquisition_amount_cents, acquisition_started_at")
                .eq("customer_id", customerId)
                .eq("company_id", session.company_id)
                .eq("serial_number", serial)
                .maybeSingle();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ce = (curEq ?? {}) as any;
              const eqPatch: Record<string, unknown> = {};
              if (er.acquisition_type && isBlank(ce.acquisition_type))
                eqPatch.acquisition_type = er.acquisition_type;
              if (er.acquisition_amount_eur != null && ce.acquisition_amount_cents == null)
                eqPatch.acquisition_amount_cents = Math.round(er.acquisition_amount_eur * 100);
              if (er.acquisition_started_at?.trim() && isBlank(ce.acquisition_started_at))
                eqPatch.acquisition_started_at = er.acquisition_started_at.trim();
              if (Object.keys(eqPatch).length > 0) {
                await admin
                  .from("customer_equipment")
                  .update(eqPatch)
                  .eq("customer_id", customerId)
                  .eq("company_id", session.company_id)
                  .eq("serial_number", serial);
              }
            } catch {
              /* columnas nuevas no en cache: se ignora */
            }
          }
          continue;
        }
        const ownId = productByName.get(norm(name)) ?? null;
        try {
          await addCustomerEquipmentAction({
            customer_id: customerId,
            product_id: ownId,
            external_brand: ownId ? undefined : (er.equipment_brand?.trim() || "Sin marca"),
            external_model: ownId ? undefined : name,
            serial_number: serial || null,
            installed_at: er.installed_at?.trim() || null,
            last_maintenance_at: er.last_maintenance_at?.trim() || null,
            next_maintenance_at: er.next_maintenance_at?.trim() || null,
            maintenance_periodicity_months: er.maintenance_periodicity_months ?? null,
            address_id: addressId,
            acquisition_type: er.acquisition_type ?? null,
            acquisition_amount_cents:
              er.acquisition_amount_eur != null ? Math.round(er.acquisition_amount_eur * 100) : null,
            acquisition_started_at: er.acquisition_started_at?.trim() || null,
          });
          if (serial) existSerials.add(serial.toUpperCase());
          result.equipment += 1;
        } catch (eqErr) {
          result.errors.push({
            row: rowNum,
            message: `Equipo "${name}": ${eqErr instanceof Error ? eqErr.message : String(eqErr)}`,
          });
        }
      }
    } catch (err) {
      result.errors.push({ row: rowNum, message: err instanceof Error ? err.message : String(err) });
    }
  }

  revalidatePath("/clientes");
  return result;
}

/**
 * Lee un .xlsx (base64) en el SERVIDOR y lo mapea a ImportCustomerRow[] para
 * previsualizar e importar. Sin dependencias (lector propio). Solo admin/dir.
 */
export async function parseImportXlsxAction(
  base64: string,
): Promise<{ ok: true; rows: ImportCustomerRow[] } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("telemarketing_director");
    if (!isUpper) return { ok: false, error: "Solo admin o director puede importar" };

    const buf = Buffer.from(base64, "base64");
    const matrix = readXlsxRows(buf);
    if (matrix.length < 2) return { ok: false, error: "El Excel no tiene filas de datos" };

    // Detectar la fila de cabecera (la 1ª que contenga alguna columna conocida).
    let headerIdx = matrix.findIndex((row) =>
      row.some((c) => /^(codigo|tipo|nombre|dni_cif|dni|razon_social|email)$/.test(normHeader(c))),
    );
    if (headerIdx < 0) headerIdx = 0;
    const rows = mapSpreadsheetRows(matrix[headerIdx] ?? [], matrix.slice(headerIdx + 1));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer el Excel" };
  }
}

export async function importCustomersSafeAction(
  rows: ImportCustomerRow[],
): Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }> {
  try {
    const result = await importCustomersAction(rows);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
