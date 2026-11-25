import "server-only";
import { cookies, headers } from "next/headers";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * «Entrar como» del superadmin (pedido por Mario el 25-11-2026, copiando el
 * de Gesdep: D:\GESDEP_CRACKS\src\compartido\auth\entrar-como*.ts).
 *
 * Cómo funciona:
 *  1. Solo un superadmin de verdad (fila en `superadmins`, no solo el JWT).
 *  2. Se guarda el refresh token de su sesión en una cookie httpOnly
 *     (`hm-origen`): es lo que permite volver sin teclear la contraseña.
 *  3. Con el cliente de servicio se genera un enlace mágico del usuario
 *     destino (generateLink NO manda ningún correo) y se canjea aquí mismo con
 *     verifyOtp: eso escribe las cookies de sesión del destino. A partir de
 *     ahí el JWT es el suyo (empresa, roles y RLS de ese usuario).
 *  4. Queda una fila en `superadmin_entradas_como` y una línea en la
 *     auditoría del superadmin.
 *
 * «Volver»: la cookie `hm-como` lleva el id de la fila. Solo se restaura la
 * sesión guardada si la base confirma que la fila está abierta y que su
 * destino es el usuario de la sesión actual. Una cookie vieja que se hubiera
 * quedado en un ordenador compartido no abre la cuenta del superadmin.
 *
 * Una sesión por navegador: Supabase guarda la sesión en cookies del dominio,
 * así que entrar como alguien cambia todas las pestañas.
 *
 * Se llama desde la ruta /api/superadmin/entrar-como y no desde una server
 * action: una action que reescribe cookies hace que Next repinte la página
 * actual con la sesión nueva (lección de Gesdep, 01-11-2026). El navegador
 * hace después una navegación completa.
 */

export const COOKIE_ORIGEN = "hm-origen";
export const COOKIE_COMO = "hm-como";

const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 12, // 12 h: es una herramienta de pruebas, no una sesión larga
};

export type RespuestaComo = { ok: true; destino: string } | { ok: false; error: string; destino?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export function esUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function borrarCookies() {
  const almacen = await cookies();
  almacen.set(COOKIE_ORIGEN, "", { ...OPCIONES_COOKIE, maxAge: 0 });
  almacen.set(COOKIE_COMO, "", { ...OPCIONES_COOKIE, maxAge: 0 });
}

export interface EntradaActual {
  id: string;
  destinoNombre: string;
  destinoEmail: string | null;
  empresaNombre: string | null;
  companyId: string | null;
  superadminUserId: string;
}

/**
 * ¿La sesión actual es una entrada «como»? Lo decide la base: cookie con el
 * id de una fila abierta cuyo destino es el usuario de esta sesión.
 */
export async function entradaComoActual(userId: string | null | undefined): Promise<EntradaActual | null> {
  if (!userId) return null;
  const id = (await cookies()).get(COOKIE_COMO)?.value;
  if (!esUuid(id)) return null;
  try {
    const db: Admin = createAdminClient();
    const { data } = await db
      .from("superadmin_entradas_como")
      .select("id, superadmin_user_id, destino_user_id, destino_nombre, destino_email, destino_company_id, cerrada_at")
      .eq("id", id)
      .maybeSingle();
    const fila = data as {
      id: string;
      superadmin_user_id: string;
      destino_user_id: string;
      destino_nombre: string | null;
      destino_email: string | null;
      destino_company_id: string | null;
      cerrada_at: string | null;
    } | null;
    if (!fila || fila.cerrada_at || fila.destino_user_id !== userId) return null;
    let empresaNombre: string | null = null;
    if (fila.destino_company_id) {
      const { data: emp } = await db.from("companies").select("name").eq("id", fila.destino_company_id).maybeSingle();
      empresaNombre = (emp as { name: string } | null)?.name?.trim() ?? null;
    }
    return {
      id: fila.id,
      destinoNombre: fila.destino_nombre ?? fila.destino_email ?? "otro usuario",
      destinoEmail: fila.destino_email,
      empresaNombre,
      companyId: fila.destino_company_id,
      superadminUserId: fila.superadmin_user_id,
    };
  } catch {
    return null;
  }
}

async function esSuperadminDeVerdad(userId: string): Promise<boolean> {
  const db: Admin = createAdminClient();
  const { data } = await db.from("superadmins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/**
 * Si ahora mismo se está dentro de otra cuenta, vuelve a la del superadmin.
 * Devuelve true si ha vuelto, null si no había entrada abierta y false si la
 * había pero la sesión guardada ya no vale.
 */
type ClienteSesion = Awaited<ReturnType<typeof createClient>>;

async function restaurarOrigen(supabase: ClienteSesion): Promise<boolean | null> {
  const almacen = await cookies();
  const origen = almacen.get(COOKIE_ORIGEN)?.value;
  const { data: yo } = await supabase.auth.getUser();
  const entrada = await entradaComoActual(yo.user?.id);
  if (!entrada || !origen) {
    if (origen || almacen.get(COOKIE_COMO)) await borrarCookies();
    return null;
  }
  const db: Admin = createAdminClient();
  await db.from("superadmin_entradas_como").update({ cerrada_at: new Date().toISOString() }).eq("id", entrada.id);
  await supabase.auth.signOut({ scope: "local" });
  await borrarCookies();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: origen });
  if (error || !data.session) {
    console.error("[entrar-como] volver:", error?.code, error?.message);
    return false;
  }
  return true;
}

/**
 * El admin con el que se entra en una empresa desde «Cambiar a»:
 *  1. el último con el que entró este superadmin en esa empresa;
 *  2. si no, el admin que se llama como él (el «Mario» que tiene en cada empresa);
 *  3. si no, el admin más antiguo (el «oficial», como getCompanyAdmin).
 * Solo admins activos o invitados, nunca suspendidos ni superadmins.
 */
async function elegirAdmin(companyId: string, superadmin: { id: string; email?: string | null }): Promise<string | null> {
  const db: Admin = createAdminClient();
  const { data: filas } = await db
    .from("user_roles")
    .select("user_id, assigned_at")
    .eq("company_id", companyId)
    .eq("role_key", "company_admin")
    .is("revoked_at", null)
    .order("assigned_at", { ascending: true });
  const ids = ((filas ?? []) as Array<{ user_id: string }>).map((f) => f.user_id).filter((id) => id !== superadmin.id);
  if (ids.length === 0) return null;
  const { data: perfiles } = await db.from("user_profiles").select("user_id, full_name, status").in("user_id", ids);
  const validos = new Map(
    ((perfiles ?? []) as Array<{ user_id: string; full_name: string | null; status: string | null }>)
      .filter((p) => p.status !== "suspended" && p.status !== "inactive")
      .map((p) => [p.user_id, p.full_name ?? ""]),
  );
  const candidatos = ids.filter((id) => validos.has(id));
  if (candidatos.length === 0) return null;

  const { data: ultima } = await db
    .from("superadmin_entradas_como")
    .select("destino_user_id")
    .eq("superadmin_user_id", superadmin.id)
    .eq("destino_company_id", companyId)
    .order("creada_at", { ascending: false })
    .limit(1);
  const ultimo = ((ultima ?? []) as Array<{ destino_user_id: string }>)[0]?.destino_user_id;
  if (ultimo && candidatos.includes(ultimo)) return ultimo;

  const nombre = (superadmin.email ?? "").split("@")[0]!.split(/[._-]/)[0]!.toLowerCase();
  if (nombre.length >= 3) {
    const tocayo = candidatos.find((id) => (validos.get(id) ?? "").toLowerCase().split(/\s+/)[0] === nombre);
    if (tocayo) return tocayo;
  }
  return candidatos[0]!;
}

export interface EmpresaParaCambiar {
  id: string;
  nombre: string;
  conAdmin: boolean;
}

/** Empresas del selector «Cambiar a». Solo se llama con un superadmin delante. */
export async function empresasParaCambiar(): Promise<EmpresaParaCambiar[]> {
  const db: Admin = createAdminClient();
  const [{ data: empresas }, { data: admins }] = await Promise.all([
    db.from("companies").select("id, name, status").order("name").limit(500),
    db.from("user_roles").select("company_id").eq("role_key", "company_admin").is("revoked_at", null),
  ]);
  const conAdmin = new Set(((admins ?? []) as Array<{ company_id: string }>).map((a) => a.company_id));
  return ((empresas ?? []) as Array<{ id: string; name: string; status: string | null }>)
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({ id: e.id, nombre: e.name.trim(), conAdmin: conAdmin.has(e.id) }));
}

/** ¿Es la sesión actual (o la entrada «como» en curso) de un superadmin de verdad? */
export async function puedeCambiarDeEmpresa(sesion: { user_id: string; is_superadmin: boolean }, entrada: EntradaActual | null): Promise<boolean> {
  if (sesion.is_superadmin) return esSuperadminDeVerdad(sesion.user_id);
  return Boolean(entrada?.superadminUserId && (await esSuperadminDeVerdad(entrada.superadminUserId)));
}

export async function entrarComo(destino: { userId?: unknown; companyId?: unknown }): Promise<RespuestaComo> {
  const porEmpresa = destino.companyId !== undefined;
  if (porEmpresa ? !esUuid(destino.companyId) : !esUuid(destino.userId)) {
    return { ok: false, error: porEmpresa ? "Esa empresa no existe." : "Ese usuario no existe." };
  }
  const supabase = await createClient();
  const db: Admin = createAdminClient();

  // 1) La sesión del superadmin: la actual o, si ya estaba dentro de otra
  //    cuenta, primero se vuelve a la suya (cambiar de una a otra directamente).
  const vuelta = await restaurarOrigen(supabase);
  if (vuelta === false) {
    return { ok: false, error: "Tu sesión de superadmin ha caducado: entra otra vez.", destino: "/login" };
  }
  const { data: yo } = await supabase.auth.getUser();
  const { data: actual } = await supabase.auth.getSession();
  if (!yo.user || !actual.session) return { ok: false, error: "No hay sesión.", destino: "/login" };
  if (!(await esSuperadminDeVerdad(yo.user.id))) {
    return { ok: false, error: "Solo el superadmin puede entrar como otro usuario." };
  }
  const destinoUserId = porEmpresa
    ? await elegirAdmin(destino.companyId as string, { id: yo.user.id, email: yo.user.email })
    : (destino.userId as string);
  if (!destinoUserId) return { ok: false, error: "Esa empresa no tiene ningún admin activo." };
  if (yo.user.id === destinoUserId) return { ok: false, error: "Ya eres tú." };
  const origen = actual.session.refresh_token;

  // 2) El destino: usuario de una empresa, activo, y no superadmin.
  const [{ data: perfil }, { data: destinoAuth, error: eUser }, superDestino] = await Promise.all([
    db.from("user_profiles").select("user_id, company_id, full_name, status").eq("user_id", destinoUserId).maybeSingle(),
    db.auth.admin.getUserById(destinoUserId),
    esSuperadminDeVerdad(destinoUserId),
  ]);
  const p = perfil as { company_id: string | null; full_name: string | null; status: string | null } | null;
  const email = destinoAuth?.user?.email as string | undefined;
  if (eUser || !email || !p?.company_id) return { ok: false, error: "Ese usuario no tiene empresa." };
  if (superDestino) return { ok: false, error: "No se puede entrar como otro superadmin." };
  if (p.status === "suspended" || p.status === "inactive") {
    return { ok: false, error: "Ese usuario está desactivado: no podría entrar." };
  }

  // 3) Enlace de un solo uso del destino (no envía correo) y canje aquí mismo.
  const { data: enlace, error: eLink } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = enlace?.properties?.hashed_token as string | undefined;
  if (eLink || !tokenHash) {
    console.error("[entrar-como] generateLink:", eLink?.message);
    return { ok: false, error: "No se ha podido abrir esa cuenta." };
  }

  // La fila va ANTES del canje: si no se puede apuntar, no se entra.
  const cab = await headers();
  const { data: fila, error: eFila } = await db
    .from("superadmin_entradas_como")
    .insert({
      superadmin_user_id: yo.user.id,
      destino_user_id: destinoUserId,
      destino_company_id: p.company_id,
      destino_email: email,
      destino_nombre: p.full_name,
      ip: (cab.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
      user_agent: cab.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id")
    .single();
  if (eFila || !fila) return { ok: false, error: "No se ha podido registrar la entrada." };

  await db.from("superadmin_audit_log").insert({
    actor_user_id: yo.user.id,
    action: "user.impersonated",
    affected_company_id: p.company_id,
    subject_type: "user",
    subject_id: destinoUserId,
    payload: { email, entrada_id: (fila as { id: string }).id },
  });

  const { data: canje, error: eCanje } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (eCanje || !canje.session) {
    console.error("[entrar-como] verifyOtp:", eCanje?.code, eCanje?.message);
    await db.from("superadmin_entradas_como").update({ cerrada_at: new Date().toISOString() }).eq("id", (fila as { id: string }).id);
    // Se queda en su sesión: el refresh token del superadmin sigue valiendo.
    const { error: eVolver } = await supabase.auth.refreshSession({ refresh_token: origen });
    return { ok: false, error: "No se ha podido abrir esa cuenta.", destino: eVolver ? "/login" : undefined };
  }

  // 4) Lo necesario para volver.
  const almacen = await cookies();
  almacen.set(COOKIE_ORIGEN, origen, OPCIONES_COOKIE);
  almacen.set(COOKIE_COMO, (fila as { id: string }).id, OPCIONES_COOKIE);
  return { ok: true, destino: "/" };
}

/** «Volver a superadmin». */
export async function volverASuperadmin(): Promise<RespuestaComo> {
  const supabase = await createClient();
  const { data: yo } = await supabase.auth.getUser();
  const entrada = await entradaComoActual(yo.user?.id);
  const companyId = entrada?.companyId ?? null;
  const r = await restaurarOrigen(supabase);
  if (r === null) return { ok: false, error: "No hay ninguna cuenta de superadmin a la que volver.", destino: "/" };
  if (r === false) return { ok: false, error: "Tu sesión de superadmin ha caducado: entra otra vez.", destino: "/login" };
  return { ok: true, destino: companyId ? `/superadmin/empresas/${companyId}` : "/superadmin" };
}

export interface UsuarioEntrable {
  user_id: string;
  nombre: string;
  email: string | null;
  roles: string[];
  status: string | null;
}

/** Usuarios de una empresa en los que puede entrar el superadmin. */
export async function usuariosParaEntrar(companyId: string): Promise<UsuarioEntrable[]> {
  if (!esUuid(companyId)) return [];
  const db: Admin = createAdminClient();
  const [{ data: perfiles }, { data: roles }] = await Promise.all([
    db.from("user_profiles").select("user_id, full_name, status").eq("company_id", companyId).limit(200),
    db.from("user_roles").select("user_id, role_key").eq("company_id", companyId).is("revoked_at", null),
  ]);
  const porUsuario = new Map<string, string[]>();
  for (const r of (roles ?? []) as Array<{ user_id: string; role_key: string }>) {
    porUsuario.set(r.user_id, [...(porUsuario.get(r.user_id) ?? []), r.role_key]);
  }
  const lista = (perfiles ?? []) as Array<{ user_id: string; full_name: string | null; status: string | null }>;
  const emails = await Promise.all(
    lista.map(async (u) => {
      const { data } = await db.auth.admin.getUserById(u.user_id);
      return (data?.user?.email as string | undefined) ?? null;
    }),
  );
  return lista
    .map((u, i) => ({
      user_id: u.user_id,
      nombre: u.full_name?.trim() || emails[i] || "Sin nombre",
      email: emails[i] ?? null,
      roles: porUsuario.get(u.user_id) ?? [],
      status: u.status,
    }))
    .sort((a, b) => Number(b.roles.includes("company_admin")) - Number(a.roles.includes("company_admin")) || a.nombre.localeCompare(b.nombre));
}
