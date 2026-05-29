"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";

const TECH_PREP_BUCKET = "installation-photos";
const TECH_PREP_CATEGORY = "tech_prep";

const EDIT_ROLES = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
];

export interface TechPrepMedia {
  id: string;
  storage_path: string;
  mime_type: string | null;
  is_video: boolean;
  url: string | null;
}

export interface TechPrepData {
  installationId: string | null;
  notes: string;
  canEdit: boolean;
  media: TechPrepMedia[];
}

interface ContractRow {
  id: string;
  company_id: string;
  assigned_user_id: string | null;
  created_by: string | null;
}

/** Carga el contrato y decide si el usuario puede EDITAR las instrucciones. */
async function loadContractForEdit(
  contractId: string,
): Promise<{ session: SessionClaims; contract: ContractRow; canEdit: boolean } | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("contracts")
    .select("id, company_id, assigned_user_id, created_by")
    .eq("id", contractId)
    .maybeSingle();
  if (!data || data.company_id !== session.company_id) return null;
  const contract = data as ContractRow;
  const isManager =
    session.is_superadmin || session.roles.some((r) => EDIT_ROLES.includes(r));
  const isOwner =
    contract.assigned_user_id === session.user_id ||
    contract.created_by === session.user_id;
  return { session, contract, canEdit: isManager || isOwner };
}

/** Instalación (unscheduled u otra) asociada al contrato. */
async function resolveInstallation(
  contractId: string,
  companyId: string,
): Promise<{ id: string; tech_prep_notes: string | null } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("installations")
    .select("id, tech_prep_notes")
    .eq("contract_id", contractId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; tech_prep_notes: string | null } | null) ?? null;
}

async function signMedia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  installationId: string,
): Promise<TechPrepMedia[]> {
  const { data } = await admin
    .from("installation_photos")
    .select("id, storage_path, mime_type, taken_at")
    .eq("installation_id", installationId)
    .eq("category", TECH_PREP_CATEGORY)
    .order("taken_at", { ascending: false });
  const out: TechPrepMedia[] = [];
  for (const r of (data ?? []) as Array<{
    id: string;
    storage_path: string;
    mime_type: string | null;
  }>) {
    let url: string | null = null;
    try {
      const { data: signed } = await admin.storage
        .from(TECH_PREP_BUCKET)
        .createSignedUrl(r.storage_path, 3600);
      url = (signed as { signedUrl: string } | null)?.signedUrl ?? null;
    } catch {
      /* bucket inexistente → url null */
    }
    out.push({
      id: r.id,
      storage_path: r.storage_path,
      mime_type: r.mime_type,
      is_video: (r.mime_type ?? "").startsWith("video/"),
      url,
    });
  }
  return out;
}

/** Para la tarjeta de la ficha de contrato (comercial). */
export async function getTechPrepByContract(contractId: string): Promise<TechPrepData> {
  const empty: TechPrepData = { installationId: null, notes: "", canEdit: false, media: [] };
  const ctx = await loadContractForEdit(contractId);
  if (!ctx) return empty;
  const inst = await resolveInstallation(contractId, ctx.contract.company_id);
  if (!inst) return { ...empty, canEdit: ctx.canEdit };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const media = await signMedia(admin, inst.id);
  return {
    installationId: inst.id,
    notes: inst.tech_prep_notes ?? "",
    canEdit: ctx.canEdit,
    media,
  };
}

/** Para el wizard del técnico (lectura): media + notas por installationId. */
export async function getTechPrepForInstallation(
  installationId: string,
): Promise<{ notes: string; media: TechPrepMedia[] }> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inst } = await admin
    .from("installations")
    .select("tech_prep_notes")
    .eq("id", installationId)
    .maybeSingle();
  const media = await signMedia(admin, installationId);
  return {
    notes: (inst as { tech_prep_notes: string | null } | null)?.tech_prep_notes ?? "",
    media,
  };
}

export async function saveTechPrepNotes(
  contractId: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadContractForEdit(contractId);
  if (!ctx) return { ok: false, error: "Contrato no encontrado" };
  if (!ctx.canEdit) return { ok: false, error: "Sin permiso para editar" };
  const inst = await resolveInstallation(contractId, ctx.contract.company_id);
  if (!inst) return { ok: false, error: "Aún no hay instalación para este contrato" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin
    .from("installations")
    .update({ tech_prep_notes: notes.slice(0, 5000) })
    .eq("id", inst.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contratos/${contractId}`);
  revalidatePath(`/instalaciones/${inst.id}`);
  return { ok: true };
}

/** URL firmada de SUBIDA directa (el fichero no pasa por el server action). */
export async function createTechPrepUploadUrl(
  contractId: string,
  ext: string,
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const ctx = await loadContractForEdit(contractId);
  if (!ctx) return { ok: false, error: "Contrato no encontrado" };
  if (!ctx.canEdit) return { ok: false, error: "Sin permiso" };
  const inst = await resolveInstallation(contractId, ctx.contract.company_id);
  if (!inst) return { ok: false, error: "Aún no hay instalación para este contrato" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await ensureBucket(admin, TECH_PREP_BUCKET);
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "bin";
  const path = `${ctx.contract.company_id}/${inst.id}/tech_prep/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${safeExt}`;
  const { data, error } = await admin.storage
    .from(TECH_PREP_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? "No se pudo preparar la subida" };
  return { ok: true, path: data.path as string, token: data.token as string };
}

export async function registerTechPrepMedia(
  contractId: string,
  input: { storage_path: string; mime_type: string; size_bytes: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadContractForEdit(contractId);
  if (!ctx) return { ok: false, error: "Contrato no encontrado" };
  if (!ctx.canEdit) return { ok: false, error: "Sin permiso" };
  const inst = await resolveInstallation(contractId, ctx.contract.company_id);
  if (!inst) return { ok: false, error: "Aún no hay instalación" };
  // Defensa: el path debe pertenecer a la empresa + instalación.
  const prefix = `${ctx.contract.company_id}/${inst.id}/tech_prep/`;
  if (!input.storage_path.startsWith(prefix)) {
    return { ok: false, error: "Ruta de archivo no válida" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin.from("installation_photos").insert({
    company_id: ctx.contract.company_id,
    installation_id: inst.id,
    category: TECH_PREP_CATEGORY,
    storage_path: input.storage_path,
    mime_type: input.mime_type,
    size_bytes: input.size_bytes,
    uploaded_by: ctx.session.user_id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contratos/${contractId}`);
  return { ok: true };
}

export async function deleteTechPrepMedia(
  photoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: photo } = await admin
    .from("installation_photos")
    .select("id, company_id, storage_path, category")
    .eq("id", photoId)
    .maybeSingle();
  if (
    !photo ||
    photo.company_id !== session.company_id ||
    photo.category !== TECH_PREP_CATEGORY
  ) {
    return { ok: false, error: "Archivo no encontrado" };
  }
  try {
    await admin.storage.from(TECH_PREP_BUCKET).remove([photo.storage_path]);
  } catch {
    /* fail-soft: borramos la fila igualmente */
  }
  const { error } = await admin.from("installation_photos").delete().eq("id", photoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
