"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type ChatThreadKind = "broadcast" | "team" | "direct";

export interface ChatThreadRow {
  id: string;
  kind: ChatThreadKind;
  name: string | null;
  last_message_at: string | null;
  unread: number;
  /** Para hilos directos: nombre del otro usuario */
  display_name: string;
}

export interface ChatMessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  is_mine: boolean;
}

export interface DirectoryUser {
  user_id: string;
  full_name: string;
  email: string | null;
  role_label: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  technical_director: "Dir. técnico",
  commercial_director: "Dir. comercial",
  telemarketing_director: "Dir. TMK",
  installer: "Instalador",
  sales_rep: "Comercial",
  telemarketer: "TMK",
};

const LEADER_ROLES = new Set([
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
]);

function isAdmin(roles: string[], superadmin: boolean): boolean {
  return superadmin || roles.includes("company_admin");
}
function isLeader(roles: string[], superadmin: boolean): boolean {
  return superadmin || roles.some((r) => LEADER_ROLES.has(r));
}

/**
 * Lista hilos visibles al usuario:
 *  - todos los broadcast de su empresa
 *  - todos los team/direct donde es miembro
 */
export async function listChatThreads(): Promise<ChatThreadRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: broadcasts } = await admin
    .from("chat_threads")
    .select("id, kind, name, last_message_at")
    .eq("company_id", session.company_id)
    .eq("kind", "broadcast")
    .is("deleted_at", null);

  const { data: memberOf } = await admin
    .from("chat_thread_members")
    .select("thread_id, last_read_at")
    .eq("user_id", session.user_id);
  const memberMap = new Map<string, string | null>();
  for (const m of (memberOf ?? []) as Array<{ thread_id: string; last_read_at: string | null }>) {
    memberMap.set(m.thread_id, m.last_read_at);
  }
  const memberIds = Array.from(memberMap.keys());
  let memberThreads: Array<{
    id: string;
    kind: ChatThreadKind;
    name: string | null;
    last_message_at: string | null;
  }> = [];
  if (memberIds.length > 0) {
    const { data } = await admin
      .from("chat_threads")
      .select("id, kind, name, last_message_at")
      .in("id", memberIds)
      .eq("company_id", session.company_id)
      .is("deleted_at", null);
    memberThreads = (data ?? []) as typeof memberThreads;
  }

  // Combinar (broadcast + member) sin duplicados
  type Row = { id: string; kind: ChatThreadKind; name: string | null; last_message_at: string | null };
  const combined = new Map<string, Row>();
  for (const t of ((broadcasts ?? []) as Row[])) combined.set(t.id, t);
  for (const t of memberThreads) combined.set(t.id, t);
  const all = Array.from(combined.values());

  // Para hilos direct → resolver el otro usuario
  const directIds = all.filter((t) => t.kind === "direct").map((t) => t.id);
  const otherUserMap = new Map<string, string>();
  if (directIds.length > 0) {
    const { data: members } = await admin
      .from("chat_thread_members")
      .select("thread_id, user_id")
      .in("thread_id", directIds);
    const byThread = new Map<string, string[]>();
    for (const m of (members ?? []) as Array<{ thread_id: string; user_id: string }>) {
      (byThread.get(m.thread_id) ?? byThread.set(m.thread_id, []).get(m.thread_id)!).push(
        m.user_id,
      );
    }
    const otherIds = new Set<string>();
    byThread.forEach((users, tid) => {
      const other = users.find((u) => u !== session.user_id);
      if (other) {
        otherUserMap.set(tid, other);
        otherIds.add(other);
      }
    });
    if (otherIds.size > 0) {
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("user_id, full_name")
        .in("user_id", Array.from(otherIds));
      const nameMap = new Map<string, string>();
      for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
        nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
      }
      // re-mapear: thread_id → nombre
      for (const [tid, uid] of otherUserMap) {
        otherUserMap.set(tid, nameMap.get(uid) ?? uid.slice(0, 8));
      }
    }
  }

  // No leídos: contar mensajes posteriores a last_read_at de cada hilo
  const result: ChatThreadRow[] = [];
  for (const t of all) {
    const lastRead = memberMap.get(t.id) ?? null;
    let unread = 0;
    if (t.last_message_at && (!lastRead || t.last_message_at > lastRead)) {
      const q = admin
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", t.id)
        .neq("sender_id", session.user_id)
        .is("deleted_at", null);
      const { count } = await (lastRead ? q.gt("created_at", lastRead) : q);
      unread = count ?? 0;
    }
    let display_name = t.name ?? "";
    if (t.kind === "direct") {
      display_name = otherUserMap.get(t.id) ?? "Conversación";
    } else if (t.kind === "broadcast") {
      display_name = t.name ?? "Avisos generales";
    } else if (t.kind === "team") {
      display_name = t.name ?? "Equipo";
    }
    result.push({
      id: t.id,
      kind: t.kind,
      name: t.name,
      last_message_at: t.last_message_at,
      unread,
      display_name,
    });
  }

  result.sort((a, b) => {
    const aT = a.last_message_at ?? "";
    const bT = b.last_message_at ?? "";
    return bT.localeCompare(aT);
  });
  return result;
}

export async function getChatTotalUnread(): Promise<number> {
  try {
    const threads = await listChatThreads();
    return threads.reduce((s, t) => s + t.unread, 0);
  } catch {
    return 0;
  }
}

/**
 * Mensajes de un hilo (orden cronológico ascendente). Comprueba acceso:
 *  - broadcast → cualquiera de la empresa
 *  - team/direct → miembro del hilo
 */
export async function getChatMessages(threadId: string): Promise<ChatMessageRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: thread } = await admin
    .from("chat_threads")
    .select("id, kind, company_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return [];
  const t = thread as { id: string; kind: ChatThreadKind; company_id: string };
  if (t.company_id !== session.company_id) return [];

  // Si es broadcast: insertar al usuario como miembro silencioso si no lo es,
  // para llevar last_read_at.
  if (t.kind === "broadcast") {
    await admin
      .from("chat_thread_members")
      .upsert(
        { thread_id: threadId, user_id: session.user_id, role: "member" },
        { onConflict: "thread_id,user_id" },
      );
  } else {
    const { data: m } = await admin
      .from("chat_thread_members")
      .select("user_id")
      .eq("thread_id", threadId)
      .eq("user_id", session.user_id)
      .maybeSingle();
    if (!m) return [];
  }

  const { data: rows } = await admin
    .from("chat_messages")
    .select("id, thread_id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  type R = { id: string; thread_id: string; sender_id: string; body: string; created_at: string };
  const items = (rows ?? []) as R[];
  const senderIds = Array.from(new Set(items.map((r) => r.sender_id)));
  const nameMap = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", senderIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }
  return items.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    sender_id: r.sender_id,
    sender_name: nameMap.get(r.sender_id) ?? r.sender_id.slice(0, 8),
    body: r.body,
    created_at: r.created_at,
    is_mine: r.sender_id === session.user_id,
  }));
}

export async function markChatThreadRead(threadId: string): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("chat_thread_members")
    .upsert(
      {
        thread_id: threadId,
        user_id: session.user_id,
        role: "member",
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "thread_id,user_id" },
    );
  revalidatePath("/chat");
}

export async function sendChatMessageAction(threadId: string, body: string): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const trimmed = body.trim();
  if (!trimmed) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: thread } = await admin
    .from("chat_threads")
    .select("id, kind, company_id, created_by")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) throw new Error("Hilo no encontrado");
  const t = thread as {
    id: string;
    kind: ChatThreadKind;
    company_id: string;
    created_by: string;
  };
  if (t.company_id !== session.company_id) throw new Error("Sin acceso");

  // Permisos de envío:
  //   broadcast → solo admin (o el creador)
  //   team/direct → miembro del hilo
  if (t.kind === "broadcast") {
    if (!isAdmin(session.roles, session.is_superadmin) && t.created_by !== session.user_id) {
      throw new Error("Solo admin puede enviar avisos generales");
    }
  } else {
    const { data: m } = await admin
      .from("chat_thread_members")
      .select("user_id")
      .eq("thread_id", threadId)
      .eq("user_id", session.user_id)
      .maybeSingle();
    if (!m) throw new Error("No eres miembro de este hilo");
  }

  await admin.from("chat_messages").insert({
    thread_id: threadId,
    sender_id: session.user_id,
    body: trimmed,
  });
  // Marcar al remitente como leído hasta ahora
  await admin
    .from("chat_thread_members")
    .upsert(
      {
        thread_id: threadId,
        user_id: session.user_id,
        role: "member",
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "thread_id,user_id" },
    );
  revalidatePath("/chat");
}

export async function createBroadcastThreadAction(name: string): Promise<string> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isAdmin(session.roles, session.is_superadmin))
    throw new Error("Solo admin puede crear avisos generales");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("chat_threads")
    .insert({
      company_id: session.company_id,
      kind: "broadcast",
      name: name.trim() || "Avisos generales",
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/chat");
  return (data as { id: string }).id;
}

export async function createTeamThreadAction(
  name: string,
  userIds: string[],
): Promise<string> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isLeader(session.roles, session.is_superadmin))
    throw new Error("Solo líderes de equipo pueden crear hilos de equipo");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("chat_threads")
    .insert({
      company_id: session.company_id,
      kind: "team",
      name: name.trim() || "Equipo",
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const threadId = (data as { id: string }).id;
  const members = Array.from(new Set([session.user_id, ...userIds]));
  await admin.from("chat_thread_members").insert(
    members.map((uid) => ({
      thread_id: threadId,
      user_id: uid,
      role: uid === session.user_id ? "owner" : "member",
    })),
  );
  revalidatePath("/chat");
  return threadId;
}

/**
 * Encuentra (o crea) un hilo direct con `otherUserId`. Si ya existe uno
 * entre los dos, lo reutiliza para no duplicar.
 */
export async function getOrCreateDirectThreadAction(otherUserId: string): Promise<string> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (otherUserId === session.user_id) throw new Error("No puedes hablarte a ti mismo");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Buscar hilos direct donde el usuario es miembro
  const { data: myMember } = await admin
    .from("chat_thread_members")
    .select("thread_id")
    .eq("user_id", session.user_id);
  const myIds = Array.from(
    new Set(((myMember ?? []) as Array<{ thread_id: string }>).map((r) => r.thread_id)),
  );
  if (myIds.length > 0) {
    // Filtrar a hilos direct
    const { data: directs } = await admin
      .from("chat_threads")
      .select("id")
      .in("id", myIds)
      .eq("kind", "direct")
      .eq("company_id", session.company_id);
    const directIds = ((directs ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (directIds.length > 0) {
      const { data: theirs } = await admin
        .from("chat_thread_members")
        .select("thread_id")
        .eq("user_id", otherUserId)
        .in("thread_id", directIds);
      const match = ((theirs ?? []) as Array<{ thread_id: string }>)[0]?.thread_id;
      if (match) return match;
    }
  }

  // Crear nuevo
  const { data, error } = await admin
    .from("chat_threads")
    .insert({
      company_id: session.company_id,
      kind: "direct",
      name: null,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const threadId = (data as { id: string }).id;
  await admin.from("chat_thread_members").insert([
    { thread_id: threadId, user_id: session.user_id, role: "owner" },
    { thread_id: threadId, user_id: otherUserId, role: "member" },
  ]);
  revalidatePath("/chat");
  return threadId;
}

/**
 * Directorio de usuarios de la empresa (excluye al actual). Para selectores
 * de "iniciar conversación con…" o "añadir al equipo".
 */
export async function listCompanyDirectory(): Promise<DirectoryUser[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: roles } = await admin
    .from("user_roles")
    .select("user_id, role_key")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  type R = { user_id: string; role_key: string };
  const rolesByUser = new Map<string, string>();
  for (const r of (roles ?? []) as R[]) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, r.role_key);
  }
  const ids = Array.from(rolesByUser.keys()).filter((id) => id !== session.user_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", ids);
  type P = { user_id: string; full_name: string | null };
  return ((profiles ?? []) as P[])
    .map((p) => {
      const role = rolesByUser.get(p.user_id) ?? null;
      return {
        user_id: p.user_id,
        full_name: p.full_name ?? p.user_id.slice(0, 8),
        email: null,
        role_label: role ? (ROLE_LABEL[role] ?? role) : null,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
