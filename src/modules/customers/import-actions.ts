"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { normalizeSpanishPhone } from "@/shared/lib/validations/spanish";
import { addCustomerEquipmentAction } from "./equipment-actions";

export interface ImportCustomerRow {
  party_kind: "individual" | "company";
  legal_name?: string;
  trade_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_primary?: string;
  phone_secondary?: string;
  tax_id?: string;
  notes?: string;
  // Dirección (opcional)
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_province?: string;
  // Equipo (1 fila = 1 equipo). Varias filas con el mismo DNI/email/teléfono =
  // varios equipos del MISMO cliente (se agrupan).
  equipment_name?: string; // si coincide con un producto del catálogo → propio; si no → externo
  equipment_brand?: string;
  serial_number?: string;
  installed_at?: string;
  maintenance_periodicity_months?: number | null;
  last_maintenance_at?: string;
  next_maintenance_at?: string;
}

export interface ImportResult {
  inserted: number; // clientes creados
  equipment: number; // equipos creados
  duplicates: number; // clientes ignorados por duplicado
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
  const result: ImportResult = { inserted: 0, equipment: 0, duplicates: 0, errors: [] };

  // 1) Agrupar filas por cliente (clave: tax_id || email || phone || índice).
  type Group = { keyRow: ImportCustomerRow; firstIdx: number; equipmentRows: Array<{ r: ImportCustomerRow; idx: number }> };
  const groups = new Map<string, Group>();
  rows.forEach((r, idx) => {
    const key =
      (r.tax_id && `t:${norm(r.tax_id)}`) ||
      (r.email && `e:${norm(r.email)}`) ||
      (r.phone_primary && `p:${(normalizeSpanishPhone(r.phone_primary) ?? r.phone_primary).trim()}`) ||
      `i:${idx}`;
    let g = groups.get(key);
    if (!g) {
      g = { keyRow: r, firstIdx: idx, equipmentRows: [] };
      groups.set(key, g);
    }
    if (r.equipment_name?.trim()) g.equipmentRows.push({ r, idx });
  });

  // 2) Dedupe contra BD (phone/email/tax_id existentes en clientes/leads).
  const phones = new Set<string>();
  const emails = new Set<string>();
  const taxIds = new Set<string>();
  for (const g of groups.values()) {
    const r = g.keyRow;
    if (r.phone_primary) phones.add(normalizeSpanishPhone(r.phone_primary) ?? r.phone_primary.trim());
    if (r.email) emails.add(r.email.trim().toLowerCase());
    if (r.tax_id) taxIds.add(r.tax_id.trim().toUpperCase());
  }
  const dupedPhones = new Set<string>();
  const dupedEmails = new Set<string>();
  const dupedTaxIds = new Set<string>();
  for (const table of ["leads", "customers"] as const) {
    if (phones.size > 0) {
      const { data } = await admin.from(table).select("phone_primary").eq("company_id", session.company_id).in("phone_primary", Array.from(phones)).is("deleted_at", null);
      for (const r of (data ?? []) as Array<{ phone_primary: string | null }>) if (r.phone_primary) dupedPhones.add(r.phone_primary);
    }
    if (emails.size > 0) {
      const { data } = await admin.from(table).select("email").eq("company_id", session.company_id).in("email", Array.from(emails)).is("deleted_at", null);
      for (const r of (data ?? []) as Array<{ email: string | null }>) if (r.email) dupedEmails.add(r.email.toLowerCase());
    }
    if (taxIds.size > 0) {
      const { data } = await admin.from(table).select("tax_id").eq("company_id", session.company_id).in("tax_id", Array.from(taxIds)).is("deleted_at", null);
      for (const r of (data ?? []) as Array<{ tax_id: string | null }>) if (r.tax_id) dupedTaxIds.add(r.tax_id.toUpperCase());
    }
  }

  // 3) Catálogo de productos propios para emparejar equipo por nombre.
  const { data: prods } = await admin
    .from("products")
    .select("id, name")
    .eq("company_id", session.company_id);
  const productByName = new Map<string, string>();
  for (const p of (prods ?? []) as Array<{ id: string; name: string }>) {
    productByName.set(norm(p.name), p.id);
  }

  // 4) Procesar cada grupo (cliente).
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
      if ((phoneNorm && dupedPhones.has(phoneNorm)) || (emailNorm && dupedEmails.has(emailNorm)) || (taxNorm && dupedTaxIds.has(taxNorm))) {
        result.duplicates += 1;
        continue;
      }

      // Crear cliente.
      const { data: created, error } = await admin
        .from("customers")
        .insert({
          company_id: session.company_id,
          party_kind: r.party_kind,
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
        })
        .select("id")
        .single();
      if (error || !created) {
        result.errors.push({ row: rowNum, message: error?.message ?? "No se pudo crear el cliente" });
        continue;
      }
      const customerId = (created as { id: string }).id;
      if (phoneNorm) dupedPhones.add(phoneNorm);
      if (emailNorm) dupedEmails.add(emailNorm);
      if (taxNorm) dupedTaxIds.add(taxNorm);
      result.inserted += 1;

      // Dirección (si hay calle).
      let addressId: string | null = null;
      if (r.address_street?.trim()) {
        const { data: addr } = await admin
          .from("addresses")
          .insert({
            company_id: session.company_id,
            customer_id: customerId,
            label: "Importada",
            is_primary: true,
            street: r.address_street.trim(),
            postal_code: r.address_postal_code?.trim() || null,
            city: r.address_city?.trim() || null,
            province: r.address_province?.trim() || null,
          })
          .select("id")
          .maybeSingle();
        addressId = (addr as { id: string } | null)?.id ?? null;
      }

      // Equipos del cliente (reusa addCustomerEquipmentAction → genera mantenimientos).
      for (const { r: er } of g.equipmentRows) {
        const name = er.equipment_name!.trim();
        const ownId = productByName.get(norm(name)) ?? null;
        try {
          await addCustomerEquipmentAction({
            customer_id: customerId,
            product_id: ownId,
            external_brand: ownId ? undefined : (er.equipment_brand?.trim() || "Sin marca"),
            external_model: ownId ? undefined : name,
            serial_number: er.serial_number?.trim() || null,
            installed_at: er.installed_at?.trim() || null,
            last_maintenance_at: er.last_maintenance_at?.trim() || null,
            next_maintenance_at: er.next_maintenance_at?.trim() || null,
            maintenance_periodicity_months: er.maintenance_periodicity_months ?? null,
            address_id: addressId,
          });
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
