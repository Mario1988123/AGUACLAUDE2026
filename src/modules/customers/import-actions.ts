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
      if (r.party_kind === "company" && !r.legal_name?.trim()) {
        result.errors.push({ row: rowNum, message: "Razón social obligatoria para empresas" });
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
        // VARIACIONES: sobrescribir con los valores NO vacíos del Excel (es la
        // fuente durante la migración). No tocamos party_kind para no voltear
        // empresa↔particular por error.
        const patch: Record<string, unknown> = {};
        if (r.legal_name) patch.legal_name = r.legal_name;
        if (r.trade_name) patch.trade_name = r.trade_name;
        if (r.first_name) patch.first_name = r.first_name;
        if (r.last_name) patch.last_name = r.last_name;
        if (emailNorm) patch.email = emailNorm;
        if (phoneNorm) patch.phone_primary = phoneNorm;
        if (r.phone_secondary) patch.phone_secondary = r.phone_secondary;
        if (taxNorm) patch.tax_id = taxNorm;
        if (codeNorm) patch.external_code = codeNorm;
        if (r.notes) patch.notes = r.notes;
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
        .select("id")
        .eq("customer_id", customerId)
        .limit(1);
      if ((existAddr ?? []).length > 0) {
        addressId = (existAddr[0] as { id: string }).id;
        // VARIACIÓN: completar/actualizar la dirección existente con lo no vacío.
        const ap: Record<string, unknown> = {};
        if (r.address_street_type?.trim()) ap.street_type = r.address_street_type.trim();
        if (r.address_street?.trim()) ap.street = r.address_street.trim();
        if (r.address_number?.trim()) ap.street_number = r.address_number.trim();
        if (r.address_portal?.trim()) ap.portal = r.address_portal.trim();
        if (r.address_floor?.trim()) ap.floor = r.address_floor.trim();
        if (r.address_door?.trim()) ap.door = r.address_door.trim();
        if (r.address_postal_code?.trim()) ap.postal_code = r.address_postal_code.trim();
        if (r.address_city?.trim()) ap.city = r.address_city.trim();
        if (r.address_province?.trim()) ap.province = r.address_province.trim();
        if (Object.keys(ap).length > 0) {
          const uA = await admin
            .from("addresses")
            .update(ap)
            .eq("id", addressId)
            .eq("company_id", session.company_id);
          if (uA.error) console.error("[import] address update:", uA.error.message);
        }
      } else if (r.address_street?.trim() || r.address_city?.trim()) {
        const addrPayload: Record<string, unknown> = {
          company_id: session.company_id,
          customer_id: customerId,
          label: "Importada",
          is_primary: true,
          street_type: r.address_street_type?.trim() || null,
          street: r.address_street?.trim() || null,
          street_number: r.address_number?.trim() || null,
          portal: r.address_portal?.trim() || null,
          floor: r.address_floor?.trim() || null,
          door: r.address_door?.trim() || null,
          postal_code: r.address_postal_code?.trim() || null,
          city: r.address_city?.trim() || null,
          province: r.address_province?.trim() || null,
          notes: r.address_notes?.trim() || null,
        };
        let addrRes = await admin.from("addresses").insert(addrPayload).select("id").maybeSingle();
        if (addrRes.error && /schema cache|Could not find|column/i.test(addrRes.error.message ?? "")) {
          // Defensa: si algún campo troceado no existe en el cache, caemos a lo básico.
          addrRes = await admin
            .from("addresses")
            .insert({
              company_id: session.company_id,
              customer_id: customerId,
              label: "Importada",
              is_primary: true,
              street: [r.address_street_type, r.address_street, r.address_number].filter(Boolean).join(" ").trim() || null,
              postal_code: r.address_postal_code?.trim() || null,
              city: r.address_city?.trim() || null,
              province: r.address_province?.trim() || null,
            })
            .select("id")
            .maybeSingle();
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
          // VARIACIÓN: el equipo ya existe (por nº serie) → actualizar modalidad.
          if (er.acquisition_type || er.acquisition_amount_eur != null || er.acquisition_started_at) {
            try {
              await admin
                .from("customer_equipment")
                .update({
                  acquisition_type: er.acquisition_type ?? null,
                  acquisition_amount_cents:
                    er.acquisition_amount_eur != null ? Math.round(er.acquisition_amount_eur * 100) : null,
                  acquisition_started_at: er.acquisition_started_at?.trim() || null,
                })
                .eq("customer_id", customerId)
                .eq("company_id", session.company_id)
                .eq("serial_number", serial);
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
