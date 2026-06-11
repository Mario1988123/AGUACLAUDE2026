"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface ContractSignature {
  id: string;
  contract_id: string;
  signer_role: "representative" | "customer";
  signer_name: string;
  signer_tax_id: string | null;
  signature_data_url: string | null;
  signed_at: string;
}

export async function listContractSignatures(
  contractId: string,
): Promise<ContractSignature[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // SEGURIDAD: admin client salta RLS → filtrar por company_id (las firmas
    // incluyen imagen + nombre + DNI del firmante).
    const { data, error } = await admin
      .from("contract_signatures")
      .select(
        "id, contract_id, signer_role, signer_name, signer_tax_id, signature_data_url, signed_at",
      )
      .eq("contract_id", contractId)
      .eq("company_id", session.company_id)
      .order("signed_at");
    if (error) return [];
    return (data ?? []) as ContractSignature[];
  } catch {
    return [];
  }
}

export async function saveContractSignatureAction(input: {
  contract_id: string;
  signer_role: "representative" | "customer";
  signer_name: string;
  signer_tax_id: string | null;
  signature_data_url: string;
}): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // SEGURIDAD: admin client salta RLS → verificar que el contrato es de tu
  // empresa antes de firmarlo (si no, se podrían insertar firmas en contratos ajenos).
  const { data: ownContract } = await admin
    .from("contracts")
    .select("id")
    .eq("id", input.contract_id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!ownContract) throw new Error("Contrato no encontrado o no pertenece a tu empresa");

  // Upsert manual: si ya existe firma de ese rol, la actualiza.
  const { data: existing } = await admin
    .from("contract_signatures")
    .select("id")
    .eq("contract_id", input.contract_id)
    .eq("signer_role", input.signer_role)
    .eq("company_id", session.company_id)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    company_id: session.company_id,
    contract_id: input.contract_id,
    signer_role: input.signer_role,
    signer_name: input.signer_name,
    signer_tax_id: input.signer_tax_id,
    signature_data_url: input.signature_data_url,
    signed_at: new Date().toISOString(),
  };

  // signature_image_path es NOT NULL en la migración original; lo ponemos
  // como string vacío hasta que se aplique 20260504100000 que la hace nullable.
  payload.signature_image_path = "";

  let err: { message?: string } | null = null;
  if (existing) {
    const r = await admin
      .from("contract_signatures")
      .update(payload)
      .eq("id", (existing as { id: string }).id);
    err = r.error as { message?: string } | null;
  } else {
    const r = await admin.from("contract_signatures").insert(payload);
    err = r.error as { message?: string } | null;
  }
  // Retry sin signature_data_url si la columna no existe (migración no aplicada)
  if (err && /signature_data_url/i.test(err.message ?? "")) {
    delete payload.signature_data_url;
    if (existing) {
      const r = await admin
        .from("contract_signatures")
        .update(payload)
        .eq("id", (existing as { id: string }).id)
        .eq("company_id", session.company_id);
      err = r.error as { message?: string } | null;
    } else {
      const r = await admin.from("contract_signatures").insert(payload);
      err = r.error as { message?: string } | null;
    }
  }
  if (err) throw new Error(err.message);

  revalidatePath(`/contratos/${input.contract_id}`);
}

export async function saveContractSignatureSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saveContractSignatureAction(input as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
