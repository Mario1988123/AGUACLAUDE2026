/**
 * Lógica pura de la bandeja (fase 2): convierte los `value` de los webhooks de
 * Meta en mensajes y estados normalizados. Sin base de datos ni red, para
 * poder probarla.
 *
 * Campos (developers.facebook.com, comprobado el 2026-11-27):
 *  · messages → value.messages[] + value.contacts[] (wa_id, user_id, profile.name)
 *    y value.statuses[]
 *  · smb_message_echoes (coexistencia) → value.message_echoes[]: lo que el
 *    negocio escribe en la app del móvil. from = negocio, to/to_user_id = cliente.
 *  · history (coexistencia) → value.history[].threads[].messages[]
 *  · smb_app_state_sync (coexistencia) → value.state_sync[] con contactos
 */

export type TipoMensaje =
  | "plantilla"
  | "texto"
  | "boton"
  | "documento"
  | "imagen"
  | "audio"
  | "video"
  | "sticker"
  | "ubicacion"
  | "contactos"
  | "reaccion"
  | "otro";

export type EstadoMensaje = "recibido" | "enviado" | "entregado" | "leido" | "fallido";

export interface Contacto {
  /** Teléfono tal como lo da Meta: solo dígitos. */
  waId: string | null;
  /** Business-scoped user ID (user_id). */
  bsuid: string | null;
  nombre: string | null;
}

export interface MensajeNormalizado {
  wamid: string;
  direccion: "entrante" | "saliente";
  origen: "api" | "movil" | "historial";
  autor: "contacto" | "humano";
  contacto: Contacto;
  tipo: TipoMensaje;
  cuerpo: string | null;
  payloadBoton: string | null;
  media: { id: string | null; mime: string | null; nombre: string | null } | null;
  respondeA: string | null;
  metaAt: string;
  estado: EstadoMensaje;
}

/** Edición o borrado de un mensaje desde la app del móvil. */
export interface CambioEco {
  accion: "editar" | "borrar";
  wamidOriginal: string;
  cuerpoNuevo: string | null;
}

export interface EstadoNormalizado {
  wamid: string;
  estado: EstadoMensaje;
  errorCodigo: number | null;
  errorTexto: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}
function lista(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
}
function txt(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Solo dígitos (6 a 20). Lo demás se descarta. */
export function waIdValido(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/^\+/, "") : typeof v === "number" ? String(v) : "";
  return /^[0-9]{6,20}$/.test(s) ? s : null;
}

export function e164DesdeWaId(waId: string | null): string | null {
  return waId ? `+${waId}` : null;
}

/** timestamp de Meta (segundos Unix, como texto o número) → ISO. */
export function fechaMeta(v: unknown, porDefecto: Date = new Date()): string {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return porDefecto.toISOString();
  return new Date(n * 1000).toISOString();
}

const TIPOS: Record<string, TipoMensaje> = {
  text: "texto",
  button: "boton",
  interactive: "boton",
  document: "documento",
  image: "imagen",
  audio: "audio",
  voice: "audio",
  video: "video",
  sticker: "sticker",
  location: "ubicacion",
  contacts: "contactos",
  reaction: "reaccion",
  template: "plantilla",
};

/** Tipo, texto visible, carga del botón y adjunto de un mensaje de Meta. */
export function contenidoDe(m: Obj): Pick<MensajeNormalizado, "tipo" | "cuerpo" | "payloadBoton" | "media"> {
  const tipoMeta = typeof m.type === "string" ? m.type : "";
  const tipo = TIPOS[tipoMeta] ?? "otro";
  let cuerpo: string | null = null;
  let payloadBoton: string | null = null;
  let media: MensajeNormalizado["media"] = null;

  switch (tipoMeta) {
    case "text":
      cuerpo = txt(obj(m.text).body);
      break;
    case "button": {
      const b = obj(m.button);
      cuerpo = txt(b.text);
      payloadBoton = txt(b.payload);
      break;
    }
    case "interactive": {
      const i = obj(m.interactive);
      const r = obj(i.button_reply ?? i.list_reply ?? i.nfm_reply);
      cuerpo = txt(r.title) ?? txt(r.body);
      payloadBoton = txt(r.id);
      break;
    }
    case "image":
    case "document":
    case "audio":
    case "voice":
    case "video":
    case "sticker": {
      const a = obj(m[tipoMeta]);
      media = { id: txt(a.id), mime: txt(a.mime_type), nombre: txt(a.filename) };
      cuerpo = txt(a.caption) ?? (tipoMeta === "document" ? txt(a.filename) : null);
      break;
    }
    case "location": {
      const l = obj(m.location);
      const partes = [txt(l.name), txt(l.address)].filter(Boolean);
      cuerpo = partes.length ? partes.join(" · ") : l.latitude != null ? `${l.latitude}, ${l.longitude}` : null;
      break;
    }
    case "contacts": {
      const nombres = lista(m.contacts)
        .map((c) => txt(obj(c.name).formatted_name))
        .filter(Boolean);
      cuerpo = nombres.length ? nombres.join(", ") : null;
      break;
    }
    case "reaction":
      cuerpo = txt(obj(m.reaction).emoji);
      break;
    case "template":
      cuerpo = txt(obj(m.template).name);
      break;
    default:
      cuerpo = null;
  }
  return { tipo, cuerpo, payloadBoton, media };
}

function contactoEntrante(m: Obj, contactos: Obj[]): Contacto {
  const waId = waIdValido(m.from);
  const bsuid = txt(m.from_user_id);
  const c =
    contactos.find((x) => (bsuid && x.user_id === bsuid) || (waId && waIdValido(x.wa_id) === waId)) ??
    (contactos.length === 1 ? contactos[0] : undefined);
  return {
    waId: waId ?? waIdValido(c?.wa_id),
    bsuid: bsuid ?? txt(c?.user_id),
    nombre: txt(obj(c?.profile).name),
  };
}

/** Webhook `messages`: mensajes que escribe el cliente. */
export function extraerEntrantes(value: unknown, ahora = new Date()): MensajeNormalizado[] {
  const v = obj(value);
  const contactos = lista(v.contacts);
  const out: MensajeNormalizado[] = [];
  for (const m of lista(v.messages)) {
    const wamid = txt(m.id);
    if (!wamid) continue;
    const contacto = contactoEntrante(m, contactos);
    if (!contacto.waId && !contacto.bsuid) continue;
    out.push({
      wamid,
      direccion: "entrante",
      origen: "api",
      autor: "contacto",
      contacto,
      ...contenidoDe(m),
      respondeA: txt(obj(m.context).id),
      metaAt: fechaMeta(m.timestamp, ahora),
      estado: "recibido",
    });
  }
  return out;
}

/** Webhook `smb_message_echoes`: lo que el negocio escribe en la app del móvil. */
export function extraerEcos(
  value: unknown,
  ahora = new Date(),
): { mensajes: MensajeNormalizado[]; cambios: CambioEco[] } {
  const v = obj(value);
  const contactos = lista(v.contacts);
  const mensajes: MensajeNormalizado[] = [];
  const cambios: CambioEco[] = [];
  for (const m of lista(v.message_echoes)) {
    const wamid = txt(m.id);
    if (!wamid) continue;
    if (m.type === "edit" || m.type === "revoke") {
      const e = obj(m[m.type]);
      const original = txt(e.original_message_id) ?? txt(m.original_message_id);
      if (!original) continue;
      const nuevo = m.type === "edit" ? contenidoDe(obj(e.message)).cuerpo : null;
      cambios.push({ accion: m.type === "edit" ? "editar" : "borrar", wamidOriginal: original, cuerpoNuevo: nuevo });
      continue;
    }
    const waTo = waIdValido(m.to);
    const bsuidTo = txt(m.to_user_id);
    const c =
      contactos.find((x) => (bsuidTo && x.user_id === bsuidTo) || (waTo && waIdValido(x.wa_id) === waTo)) ??
      (contactos.length === 1 ? contactos[0] : undefined);
    const contacto: Contacto = {
      waId: waTo ?? waIdValido(c?.wa_id),
      bsuid: bsuidTo ?? txt(c?.user_id),
      nombre: null,
    };
    if (!contacto.waId && !contacto.bsuid) continue;
    mensajes.push({
      wamid,
      direccion: "saliente",
      origen: "movil",
      autor: "humano",
      contacto,
      ...contenidoDe(m),
      respondeA: txt(obj(m.context).id),
      metaAt: fechaMeta(m.timestamp, ahora),
      estado: "enviado",
    });
  }
  return { mensajes, cambios };
}

const ESTADO_HISTORIAL: Record<string, EstadoMensaje> = {
  SENT: "enviado",
  DELIVERED: "entregado",
  READ: "leido",
  PLAYED: "leido",
  FAILED: "fallido",
  ERROR: "fallido",
  PENDING: "enviado",
};

export interface FaseHistorial {
  fase: number | null;
  progreso: number | null;
  errorCodigo: number | null;
}

/**
 * Webhook `history`: chats de la app de los últimos meses. Se distingue quién
 * escribió comparando `from` con el número del negocio; el hilo es el cliente.
 */
export function extraerHistorial(
  value: unknown,
  numeroNegocio: string | null,
  ahora = new Date(),
): { mensajes: MensajeNormalizado[]; fases: FaseHistorial[] } {
  const v = obj(value);
  const negocio = waIdValido(numeroNegocio ?? "");
  const mensajes: MensajeNormalizado[] = [];
  const fases: FaseHistorial[] = [];
  for (const h of lista(v.history)) {
    const md = obj(h.metadata);
    const err = lista(h.errors)[0];
    fases.push({
      fase: typeof md.phase === "number" ? md.phase : null,
      progreso: typeof md.progress === "number" ? md.progress : null,
      errorCodigo: typeof err?.code === "number" ? err.code : null,
    });
    for (const t of lista(h.threads)) {
      // El hilo es el cliente: id (teléfono, puede faltar) y context.{wa_id, user_id}.
      const ctx = obj(t.context);
      const hiloWa = waIdValido(t.id) ?? waIdValido(ctx.wa_id);
      const hiloBsuid = txt(ctx.user_id);
      for (const m of lista(t.messages)) {
        const wamid = txt(m.id);
        if (!wamid) continue;
        // Si from es el número del negocio, lo escribió el negocio (y no trae
        // from_user_id). Si from es el cliente, o falta y viene from_user_id, el cliente.
        const from = waIdValido(m.from);
        const esNegocio = negocio != null && from === negocio;
        const contacto: Contacto = esNegocio
          ? { waId: waIdValido(m.to) ?? hiloWa, bsuid: txt(m.to_user_id) ?? hiloBsuid, nombre: null }
          : { waId: from ?? hiloWa, bsuid: txt(m.from_user_id) ?? hiloBsuid, nombre: null };
        if (!contacto.waId && !contacto.bsuid) continue;
        const st = String(obj(m.history_context).status ?? "").toUpperCase();
        mensajes.push({
          wamid,
          direccion: esNegocio ? "saliente" : "entrante",
          origen: "historial",
          autor: esNegocio ? "humano" : "contacto",
          contacto,
          ...contenidoDe(m),
          respondeA: txt(obj(m.context).id),
          metaAt: fechaMeta(m.timestamp, ahora),
          estado: esNegocio ? (ESTADO_HISTORIAL[st] ?? "enviado") : "recibido",
        });
      }
    }
  }
  return { mensajes, fases };
}

/** Webhook `smb_app_state_sync`: contactos de la app (nombre guardado en el móvil). */
export function extraerContactosApp(value: unknown): Array<Contacto & { accion: "add" | "remove" }> {
  const out: Array<Contacto & { accion: "add" | "remove" }> = [];
  for (const s of lista(obj(value).state_sync)) {
    if (s.type !== "contact") continue;
    const c = obj(s.contact);
    const contacto: Contacto = {
      waId: waIdValido(c.phone_number),
      bsuid: txt(c.user_id),
      nombre: txt(c.full_name) ?? txt(c.first_name),
    };
    if (!contacto.waId && !contacto.bsuid) continue;
    out.push({ ...contacto, accion: s.action === "remove" ? "remove" : "add" });
  }
  return out;
}

const ESTADOS_META: Record<string, EstadoMensaje> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  played: "leido",
  failed: "fallido",
};

/** Webhook `messages` → value.statuses[]. */
export function extraerEstados(value: unknown): EstadoNormalizado[] {
  const out: EstadoNormalizado[] = [];
  for (const s of lista(obj(value).statuses)) {
    const wamid = txt(s.id);
    const estado = ESTADOS_META[String(s.status ?? "").toLowerCase()];
    if (!wamid || !estado) continue;
    const e = lista(s.errors)[0];
    out.push({
      wamid,
      estado,
      errorCodigo: typeof e?.code === "number" ? e.code : null,
      errorTexto: e ? (txt(obj(e.error_data).details) ?? txt(e.message) ?? txt(e.title)) : null,
    });
  }
  return out;
}

const RANGO: Record<EstadoMensaje, number> = { recibido: 0, enviado: 1, entregado: 2, leido: 3, fallido: 4 };

/**
 * Estados desde los que se puede pasar a `nuevo` (solo hacia delante; fallido
 * cierra, pero un «leído» no se pisa con un «fallido» tardío).
 */
export function estadosAnteriores(nuevo: EstadoMensaje): EstadoMensaje[] {
  if (nuevo === "fallido") return ["recibido", "enviado", "entregado"];
  return (Object.keys(RANGO) as EstadoMensaje[]).filter((e) => e !== "fallido" && RANGO[e] < RANGO[nuevo]);
}

export const MAX_TEXTO_SALIENTE = 4096;

export function validarTextoSaliente(texto: string): { ok: true; texto: string } | { ok: false; error: string } {
  const t = texto.replace(/\r\n/g, "\n").trim();
  if (!t) return { ok: false, error: "Escribe algo antes de enviar." };
  if (t.length > MAX_TEXTO_SALIENTE) {
    return { ok: false, error: `WhatsApp admite hasta ${MAX_TEXTO_SALIENTE} caracteres por mensaje.` };
  }
  return { ok: true, texto: t };
}

export function ventanaAbierta(ventanaHasta: string | null, ahora = new Date()): boolean {
  return ventanaHasta != null && new Date(ventanaHasta).getTime() > ahora.getTime();
}

/**
 * Fase 8: una conversación `cerrada` se reabre (pasa a `humano`) si el
 * contacto vuelve a escribir y NO está bloqueado (p. ej. el admin le quitó el
 * bloqueo, o se cerró sin bloqueo). Nunca con el propio mensaje que la cierra
 * (un «No» o una baja de campaña) ni si no se ha podido comprobar el bloqueo
 * (quien llama pasa `bloqueado: true` en ese caso).
 */
export function debeReabrirConversacion(a: {
  modo: string | null;
  bloqueado: boolean;
  cierraEsteMensaje: boolean;
}): boolean {
  return a.modo === "cerrada" && !a.bloqueado && !a.cierraEsteMensaje;
}
